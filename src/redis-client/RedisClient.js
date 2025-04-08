"use strict";

const redis = require("redis");

const COMPONENT_NAME = "redisClient";
const LOG_AFTER_SEC = 5;

class RedisClient {
  constructor(name) {
    this.name = name;
    this.log = cds.log(COMPONENT_NAME);
    this.mainClientPromise = null;
    this.additionalClientPromise = null;
    this.subscriberClientPromise = null;
    this.subscribedChannels = {};
    this.lastErrorLog = Date.now();
  }

  createMainClientAndConnect(options) {
    if (this.mainClientPromise) {
      return this.mainClientPromise;
    }

    const errorHandlerCreateClient = (err) => {
      this.mainClientPromise?.then?.(this.resilientClientClose);
      this.log.error("Error from main redis client", err);
      this.mainClientPromise = null;
      setTimeout(() => this.createMainClientAndConnect(options), LOG_AFTER_SEC * 1000).unref();
    };

    this.mainClientPromise = this.createClientAndConnect(options, errorHandlerCreateClient);
    return this.mainClientPromise;
  }

  createAdditionalClientAndConnect(options) {
    if (this.additionalClientPromise) {
      return this.additionalClientPromise;
    }

    const errorHandlerCreateClient = (err) => {
      this.additionalClientPromise?.then?.(this.resilientClientClose);
      this.log.error("Error from additional redis client", err);
      this.additionalClientPromise = null;
      setTimeout(() => this.createAdditionalClientAndConnect(options), LOG_AFTER_SEC * 1000).unref();
    };

    this.additionalClientPromise = this.createClientAndConnect(options, errorHandlerCreateClient);
    return this.additionalClientPromise;
  }

  async createClientAndConnect(options, errorHandlerCreateClient, isConnectionCheck) {
    try {
      const client = this.createClientBase(options);
      if (!client) {
        return;
      }
      if (!isConnectionCheck) {
        client.on("error", (err) => {
          const dateNow = Date.now();
          if (dateNow - this.lastErrorLog > LOG_AFTER_SEC * 1000) {
            this.log.error("Error from redis client", err);
            this.lastErrorLog = dateNow;
          }
        });

        client.on("reconnecting", () => {
          const dateNow = Date.now();
          if (dateNow - this.lastErrorLog > LOG_AFTER_SEC * 1000) {
            this.log.info("Redis client trying reconnect...");
            this.lastErrorLog = dateNow;
          }
        });
      }
      await client.connect();
      return client;
    } catch (err) {
      errorHandlerCreateClient(err);
    }
  }

  async connectionCheck(options) {
    let error;
    try {
      const client = await this.createClientAndConnect(
        options,
        (err) => {
          error = err;
        },
        true,
      );
      if (error) {
        throw error;
      }
      if (client) {
        await this.resilientClientClose(client);
        return true;
      }
    } catch (err) {
      this.log.warn("Falling back to no redis mode. Redis connection could not be established: ", err.message);
    }
    return false;
  }

  createClientBase(redisOptions = {}) {
    const { credentials, options } =
      (this.name ? cds.requires[`redis-${this.name}`] : undefined) || cds.requires["redis"] || {};
    const socket = {
      host: credentials?.hostname ?? "127.0.0.1",
      tls: !!credentials?.tls,
      port: credentials?.port ?? 6379,
      ...options?.socket,
      ...redisOptions.socket,
    };
    const socketOptions = {
      ...options,
      ...redisOptions,
      password: options?.password ?? options?.password ?? credentials?.password,
      socket,
    };
    try {
      if (credentials?.cluster_mode) {
        return redis.createCluster({
          rootNodes: [socketOptions],
          defaults: socketOptions,
        });
      }
      return redis.createClient(socketOptions);
    } catch (err) {
      throw new Error("Error during create client with redis-cache service" + err);
    }
  }

  subscribeChannel(options, channel, subscribeHandler) {
    this.subscribedChannels[channel] = subscribeHandler;
    const errorHandlerCreateClient = (err) => {
      this.log.error(`Error from redis client for for channel ${channel}`, err);
      this.subscriberClientPromise?.then?.(this.resilientClientClose);
      this.subscriberClientPromise = null;
      setTimeout(
        () => this.subscribeChannels(options, this.subscribedChannels, subscribeHandler),
        LOG_AFTER_SEC * 1000,
      ).unref();
    };
    this.subscribeChannels(options, { [channel]: subscribeHandler }, errorHandlerCreateClient);
  }

  subscribeChannels(options, subscribedChannels, errorHandlerCreateClient) {
    this.subscriberClientPromise = this.createClientAndConnect(options, errorHandlerCreateClient)
      .then((client) => {
        for (const channel in this.subscribedChannels) {
          const fn = subscribedChannels[channel];
          client._subscribedChannels ??= {};
          if (client._subscribedChannels[channel]) {
            continue;
          }
          this.log.info("Subscribe redis client connected channel", { channel });
          client
            .subscribe(channel, fn)
            .then(() => {
              client._subscribedChannels ??= {};
              client._subscribedChannels[channel] = 1;
            })
            .catch(() => {
              this.log.error("Error subscribe to channel - retrying...");
              setTimeout(() => this.subscribeChannels(options, [channel], fn), LOG_AFTER_SEC * 1000).unref();
            });
        }
      })
      .catch((err) => {
        cds
          .log(COMPONENT_NAME)
          .error(
            `Error from redis client during startup - trying to reconnect - ${Object.keys(this.subscribedChannels).join(
              ", ",
            )}`,
            err,
          );
      });
  }

  async publishMessage(options, channel, message) {
    const client = await this.createMainClientAndConnect(options);
    return await client.publish(channel, message);
  }

  async closeMainClient() {
    const client = this.mainClientPromise;
    this.mainClientPromise = null;
    await this.resilientClientClose(await client);
    this.log.info("Main redis client closed!");
  }

  async closeAdditionalClient() {
    const client = this.additionalClientPromise;
    this.additionalClientPromise = null;
    await this.resilientClientClose(await client);
    this.log.info("Additional redis client closed!");
  }

  async closeSubscribeClient() {
    const client = this.subscriberClientPromise;
    this.subscriberClientPromise = null;
    await this.resilientClientClose(await client);
    this.log.info("Subscribe redis client closed!");
  }

  async closeClients() {
    await this.closeMainClient();
    await this.closeAdditionalClient();
    await this.closeSubscribeClient();
  }

  async resilientClientClose(client) {
    try {
      if (client?.quit) {
        await client.quit();
      }
    } catch (err) {
      this.log.info("Error during redis close - continuing...", err);
    }
  }

  static default(name = "default") {
    RedisClient._default ??= {};
    if (!RedisClient._default[name]) {
      RedisClient._default[name] = new RedisClient(name);
    }
    return RedisClient._default[name];
  }

  static async closeAllClients() {
    for (const entry of Object.values(RedisClient._default || {})) {
      await entry.closeClients();
    }
  }
}

module.exports = RedisClient;
