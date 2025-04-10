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
    const redisClient1 = RedisClient.default("first");
    expect(redisClient1).toBeDefined();
    const redisClient2 = RedisClient.default("second");
    expect(redisClient2).toBeDefined();
    expect(redisClient1).not.toBe(redisClient2);
  });

  it("Main Client", async () => {
    const redisClient = RedisClient.default();
    const mainClient = await redisClient.createMainClientAndConnect();
    expect(mainClient).toBeDefined();
    await redisClient.closeMainClient();
  });

  it("Additional Client", async () => {
    const redisClient = RedisClient.default();
    const additionalClient = await redisClient.createAdditionalClientAndConnect();
    expect(additionalClient).toBeDefined();
    await redisClient.closeMainClient();
  });

  it("Close Client", async () => {
    const redisClient = RedisClient.default();
    const mainClient = await redisClient.createMainClientAndConnect();
    expect(mainClient).toBeDefined();
    await RedisClient.closeAllClients();
  });

  it("Subscribe Client", async () => {
    const redisClient = RedisClient.default();
    await redisClient.subscribeChannel({}, "test", () => {});
    expect(redisClient.subscribedChannels["test"]).toBeDefined();
    const result = await redisClient.publishMessage({}, "test", "message");
    expect(result).toBeUndefined();
  });

  it("Connection Check", async () => {
    const redisClient = RedisClient.default();
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
    const redisClient = RedisClient.default();
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
    const redisClient = RedisClient.default();
    const mainClient = await redisClient.createMainClientAndConnect();
    expect(mainClient).toBeUndefined();
  });

  it("Error - Connect Client", async () => {
    redisMock.throwError("connect");
    const redisClient = RedisClient.default();
    const mainClient = await redisClient.createMainClientAndConnect();
    expect(mainClient).toBeUndefined();
  });

  it("Error - Connection Check", async () => {
    redisMock.throwError("createClient");
    const redisClient = RedisClient.default();
    const result = await redisClient.connectionCheck();
    expect(result).toBe(false);
  });

  it("Error - Subscribe Channel", async () => {
    redisMock.throwError("createClient");
    const redisClient = RedisClient.default();
    const subscribeHandler = () => {};
    await redisClient.subscribeChannel({}, "test", subscribeHandler);
    expect(await redisClient.subscribedChannels["test"]).toBe(subscribeHandler);
    const result = await redisClient.publishMessage({}, "test", "message");
    expect(result).toBeUndefined();
  });
});
