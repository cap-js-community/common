"use strict";

const cds = require("@sap/cds");

const redis = require("redis");
require("../mocks/redis");
jest.mock("redis", () => require("../mocks/redis"));

const { test } = cds.test(__dirname + "/../..");

const { RedisClient } = require("../../src/redis-client");

process.env.PORT = 0; // Random

describe("Redis Client (Sentinel)", () => {
  beforeEach(async () => {
    await test.data.reset();
    await RedisClient.closeAllClients();
  });

  describe("Sentinel Mode", () => {
    it("prioritizes sentinel over cluster mode", async () => {
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

    it("prefers master_name field over URI fragment", async () => {
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

    it("uses default port 26379 when not specified", async () => {
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

    it("returns undefined if master name not found", async () => {
      cds.env.requires.redis = {
        credentials: {
          sentinel_nodes: [{ hostname: "sentinel.local" }],
        },
      };

      const redisClient = RedisClient.create("no-master-test");
      const client = await redisClient.createMainClientAndConnect();
      expect(client).toBeUndefined();
    });
  });
});
