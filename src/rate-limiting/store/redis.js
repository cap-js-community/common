"use strict";

const cds = require("@sap/cds");

const { RedisClient } = require("../../redis-client");

const COMPONENT_NAME = "/cap-js-community-common/rate-limiting";

const KIND = "redis";

async function connectionCheck() {
  return await RedisClient.create(COMPONENT_NAME).connectionCheck();
}

async function perform(key, cb, retry = cds.env.rateLimiting.retry) {
  const client = await RedisClient.create("rateLimiting").createMainClientAndConnect();
  const value = await cb(client, key);
  if (value === undefined) {
    if (retry > 0) {
      return await perform(key, cb, retry - 1);
    }
    cds.log(COMPONENT_NAME).error("Retry limit reached", { key });
    throw new Error("Rate limiting retry limit reached");
  }
  return value;
}

module.exports = ({ name = "default", window } = {}) => {
  const resetTimeKey = `${name}:resetTime`;
  const countsName = `${name}:inWindowCounts`;

  async function setResetTime() {
    const date = new Date();
    date.setMilliseconds(date.getMilliseconds() + window);
    return await perform(resetTimeKey, async (client, key) => {
      const status = await client.set(key, date.toISOString(), { NX: true, PX: window });
      if (status === "OK") {
        return date;
      }
      const value = await client.get(key);
      return value ? new Date(value) : date;
    });
  }

  async function clearResetTime() {
    // no-op as reset time expires
  }

  async function increment(tenant) {
    return await perform(`${countsName}/${tenant}`, async (client, key) => {
      const value = await client.incr(key);
      if (value === 1) {
        await client.pExpireAt(key, (await setResetTime()).getTime());
      }
      return value;
    });
  }

  async function reset(tenant) {
    return await perform(`${countsName}/${tenant}`, async (client, key) => {
      await client.del(key);
      return 0;
    });
  }

  return {
    kind: KIND,
    expires: true,
    setResetTime,
    clearResetTime,
    increment,
    reset,
  };
};

module.exports.KIND = KIND;
module.exports.connectionCheck = connectionCheck;
