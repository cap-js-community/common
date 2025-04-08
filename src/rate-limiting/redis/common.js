"use strict";

const cds = require("@sap/cds");

const { RedisClient } = require("../../redis-client");

const COMPONENT_NAME = "rateLimiting";

async function connectionCheck() {
  return await RedisClient.default(COMPONENT_NAME).connectionCheck();
}

async function perform(key, cb, cbFallback, retry = cds.env.rateLimiting.retry) {
  const client = cds.env.rateLimiting.redis && (await RedisClient.default(COMPONENT_NAME).createMainClientAndConnect());
  if (client) {
    const value = await cb(client, key);
    if (value === undefined) {
      if (retry > 0) {
        return await perform(key, cb, cbFallback, retry - 1);
      } else {
        cds.log(COMPONENT_NAME).error("Retry limit reached", { key });
        throw new Error("Rate limiting retry limit reached");
      }
    }
    return value;
  }
  return cbFallback(key);
}

module.exports = {
  connectionCheck,
  perform,
};
