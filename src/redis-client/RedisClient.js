"use strict";

const redis = require("redis");
const cds = require("@sap/cds");

const COMPONENT_NAME = "/cap-js-community-common/redisClient";
const LOG_AFTER_SEC = 5;
const TIMEOUT_SHUTDOWN = 2500;

class RedisClient {
  #clusterClient = false;
  #beforeCloseHandler;
  constructor(name, env) {
    this.name = name;
    this.env = env || this.name;
    this.log = cds.log(COMPONENT_NAME);
    this.mainClientPromise = null;
    this.subscriberClientPromise = null;
    this.subscribedChannels = {};
    this.lastErrorLog = Date.now();

    if (!RedisClient._shutdownRegistered) {
      RedisClient._shutdownRegistered = true;
      cds.on("shutdown", async () => {
        await this.closeRedisClients();
      });
    }
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
    const redisClient = RedisClient.create(this.name + "-2", this.env);
    return redisClient.createMainClientAndConnect(options);
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
        // NOTE: ignore promise: client should not wait + fn can't throw
        this.resilientClientClose(client);
        return true;
      }
    } catch (err) {
      this.log.warn("Falling back to no redis mode. Redis connection could not be established: ", err.message);
    }
    return false;
  }

  createClientBase(redisOptions = {}) {
    const { credentials, options } =
      (this.env ? cds.env.requires[`redis-${this.env}`] : undefined) || cds.env.requires["redis"] || {};
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
      password: redisOptions?.password ?? options?.password ?? credentials?.password,
      socket,
    };
    try {
      if (credentials?.cluster_mode) {
        this.#clusterClient = true;
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
    this.subscribeChannels(options, errorHandlerCreateClient);
  }

  subscribeChannels(options, errorHandlerCreateClient) {
    this.subscriberClientPromise = this.createClientAndConnect(options, errorHandlerCreateClient)
      .then((client) => {
        for (const channel in this.subscribedChannels) {
          const fn = this.subscribedChannels[channel];
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
    if (!this.mainClientPromise) {
      return;
    }
    const client = this.mainClientPromise;
    this.mainClientPromise = null;
    await this.resilientClientClose(await client);
    this.log.info("Main redis client closed!");
  }

  async closeSubscribeClient() {
    if (!this.subscriberClientPromise) {
      return;
    }
    const client = this.subscriberClientPromise;
    this.subscriberClientPromise = null;
    await this.resilientClientClose(await client);
    this.log.info("Subscribe redis client closed!");
  }

  async closeClients() {
    if (this.#beforeCloseHandler) {
      await this.#beforeCloseHandler();
    }
    await Promise.allSettled([this.closeMainClient(), this.closeSubscribeClient()]);
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

  async closeRedisClients() {
    return await new Promise((resolve, reject) => {
      const timeoutRef = setTimeout(() => {
        clearTimeout(timeoutRef);
        resolve();
      }, TIMEOUT_SHUTDOWN);
      RedisClient.closeAllClients()
        .then((result) => {
          clearTimeout(timeoutRef);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timeoutRef);
          reject(err);
        });
    });
  }

  set beforeCloseHandler(cb) {
    this.#beforeCloseHandler = cb;
  }

  get isCluster() {
    return this.#clusterClient;
  }

  static create(name = "default", env) {
    env ??= name;
    RedisClient._create ??= {};
    if (!RedisClient._create[name]) {
      RedisClient._create[name] = new RedisClient(name, env);
    }
    return RedisClient._create[name];
  }

  static default(name) {
    return RedisClient.create(name);
  }

  static async closeAllClients() {
    for (const entry of Object.values(RedisClient._create || {})) {
      await entry.closeClients();
    }
  }
}

module.exports = RedisClient;
