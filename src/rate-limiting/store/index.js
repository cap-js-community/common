"use strict";

const cds = require("@sap/cds");

const localStore = require("./local");
const redisStore = require("./redis");

async function createStore({ name, window } = {}) {
  let kind = localStore.KIND;
  if (cds.env.rateLimiting.redis && (await redisStore.connectionCheck())) {
    kind = redisStore.KIND;
  }
  switch (kind) {
    case redisStore.KIND:
      return redisStore({ name, window });
    default:
      return localStore({ window });
  }
}

module.exports = createStore;
