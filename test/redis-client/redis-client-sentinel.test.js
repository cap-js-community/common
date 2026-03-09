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
  });
});
