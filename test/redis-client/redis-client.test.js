"use strict";

const cds = require("@sap/cds");

const redis = require("redis");
const redisMock = require("../mocks/redis");
jest.mock("redis", () => require("../mocks/redis"));

const { test } = cds.test(__dirname + "/../..");

const { RedisClient } = require("../../src/redis-client");

process.env.PORT = 0; // Random

describe("Redis Client", () => {
  beforeEach(async () => {
    await test.data.reset();
    await RedisClient.closeAllClients();
  });

  it("Default", async () => {
    const redisClient1 = RedisClient.create("first");
    expect(redisClient1).toBeDefined();
    const redisClient2 = RedisClient.create("second");
    expect(redisClient2).toBeDefined();
    expect(redisClient1).not.toBe(redisClient2);
  });

  it("Main Client", async () => {
    const redisClient = RedisClient.create();
    const mainClient = await redisClient.createMainClientAndConnect();
    expect(mainClient).toBeDefined();
    await redisClient.closeMainClient();
  });

  it("Additional Client", async () => {
    const redisClient = RedisClient.create();
    const additionalClient = await redisClient.createAdditionalClientAndConnect();
    expect(additionalClient).toBeDefined();
    await redisClient.closeMainClient();
  });

  it("Close Client", async () => {
    const redisClient = RedisClient.create();
    const mainClient = await redisClient.createMainClientAndConnect();
    expect(mainClient).toBeDefined();
    await RedisClient.closeAllClients();
  });

  it("Subscribe Client", async () => {
    const redisClient = RedisClient.create();
    await redisClient.subscribeChannel({}, "test", () => {});
    expect(redisClient.subscribedChannels["test"]).toBeDefined();
    const result = await redisClient.publishMessage({}, "test", "message");
    expect(result).toBeUndefined();
  });

  it("Connection Check", async () => {
    const redisClient = RedisClient.create();
    const result = await redisClient.connectionCheck();
    expect(result).toBe(true);
  });

  it("Options", async () => {
    cds.env.requires.redis ??= {};
    cds.env.requires.redis.options = { b: 1 };
    cds.env.requires.redis.credentials = {
      hostname: "localhost",
      tls: true,
      port: 6379,
      password: "1234",
    };
    const redisClient = RedisClient.create();
    const result = await redisClient.createMainClientAndConnect({
      a: 1,
      password: "12345",
      socket: {
        port: 6380,
        rejectUnauthorized: false,
      },
    });
    expect(result).toBeDefined();
    expect(redis.createClient).toHaveBeenCalledWith({
      a: 1,
      b: 1,
      password: "12345",
      socket: {
        host: "localhost",
        port: 6380,
        rejectUnauthorized: false,
        tls: true,
      },
    });
  });

  it("Error - Create Client", async () => {
    redisMock.throwError("createClient");
    const redisClient = RedisClient.create();
    const mainClient = await redisClient.createMainClientAndConnect();
    expect(mainClient).toBeUndefined();
  });

  it("Error - Connect Client", async () => {
    redisMock.throwError("connect");
    const redisClient = RedisClient.create();
    const mainClient = await redisClient.createMainClientAndConnect();
    expect(mainClient).toBeUndefined();
  });

  it("Error - Connection Check", async () => {
    redisMock.throwError("createClient");
    const redisClient = RedisClient.create();
    const result = await redisClient.connectionCheck();
    expect(result).toBe(false);
  });

  it("Error - Subscribe Channel", async () => {
    redisMock.throwError("createClient");
    const redisClient = RedisClient.create();
    const subscribeHandler = () => {};
    await redisClient.subscribeChannel({}, "test", subscribeHandler);
    expect(await redisClient.subscribedChannels["test"]).toBe(subscribeHandler);
    const result = await redisClient.publishMessage({}, "test", "message");
    expect(result).toBeUndefined();
  });

  describe("Sentinel Mode", () => {
    beforeEach(async () => {
      jest.clearAllMocks();
      await RedisClient.closeAllClients();
    });

    it("creates Sentinel client when sentinel_nodes configured", async () => {
      cds.env.requires.redis = {
        credentials: {
          sentinel_nodes: [
            { hostname: "sentinel1.example.com", port: 26379 },
            { hostname: "sentinel2.example.com", port: 26379 },
          ],
          uri: "redis://:secret@sentinel1.example.com:26379#mymaster",
          password: "secret",
          tls: true,
        },
      };

      const redisClient = RedisClient.create("sentinel-test");
      const client = await redisClient.createMainClientAndConnect();

      expect(client).toBeDefined();
      expect(redis.createSentinel).toHaveBeenCalledWith({
        name: "mymaster",
        sentinelRootNodes: [
          { host: "sentinel1.example.com", port: 26379 },
          { host: "sentinel2.example.com", port: 26379 },
        ],
        nodeClientOptions: expect.objectContaining({
          password: "secret",
          socket: expect.objectContaining({ tls: true }),
        }),
        sentinelClientOptions: expect.objectContaining({
          password: "secret",
        }),
        passthroughClientErrorEvents: true,
      });
      expect(redisClient.isSentinel).toBe(true);
      expect(redisClient.isCluster).toBe(false);
    });

    it.skip("prefers master_name field over URI fragment", async () => {
      cds.env.requires.redis = {
        credentials: {
          sentinel_nodes: [{ host: "sentinel.local", port: 26379 }],
          master_name: "explicit-master",
          uri: "redis://sentinel.local#uri-master",
        },
      };

      const redisClient = RedisClient.create("master-name-test");
      await redisClient.createMainClientAndConnect();

      expect(redis.createSentinel).toHaveBeenCalledWith(expect.objectContaining({ name: "explicit-master" }));
    });

    it.skip("uses default port 26379 when not specified", async () => {
      cds.env.requires.redis = {
        credentials: {
          sentinel_nodes: [{ hostname: "sentinel.local" }],
          master_name: "mymaster",
        },
      };

      const redisClient = RedisClient.create("default-port-test");
      await redisClient.createMainClientAndConnect();

      expect(redis.createSentinel).toHaveBeenCalledWith(
        expect.objectContaining({
          sentinelRootNodes: [{ host: "sentinel.local", port: 26379 }],
        }),
      );
    });

    it.skip("returns undefined if master name not found", async () => {
      cds.env.requires.redis = {
        credentials: {
          sentinel_nodes: [{ hostname: "sentinel.local" }],
        },
      };

      const redisClient = RedisClient.create("no-master-test");
      const client = await redisClient.createMainClientAndConnect();
      expect(client).toBeUndefined();
    });

    it.skip("prioritizes sentinel over cluster mode", async () => {
      cds.env.requires.redis = {
        credentials: {
          sentinel_nodes: [{ hostname: "sentinel.local" }],
          master_name: "mymaster",
          cluster_mode: true,
        },
      };

      const redisClient = RedisClient.create("priority-test");
      await redisClient.createMainClientAndConnect();

      expect(redis.createSentinel).toHaveBeenCalled();
      expect(redis.createCluster).not.toHaveBeenCalled();
      expect(redisClient.isSentinel).toBe(true);
    });
  });
});
