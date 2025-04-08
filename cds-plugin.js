"use strict";

const cds = require("@sap/cds");
require("./src/common/promise");

const { ReplicationCache, RateLimiting, RedisClient } = require("./src");

const TIMEOUT_SHUTDOWN = 2500;

if (cds.env.rateLimiting.plugin) {
  cds.on("serving", async (service) => {
    if (
      service.definition["@cds.rateLimit"] ||
      Object.keys(service.definition).find((name) => {
        return name.startsWith("@cds.rateLimit.");
      })
    ) {
      const rateLimiting = new RateLimiting(service);
      await rateLimiting.setup();
    }
  });
}

if (cds.env.replicationCache.plugin) {
  cds.replicationCache = new ReplicationCache();
}

cds.on("shutdown", async () => {
  await shutdownWebSocketServer();
});

async function shutdownWebSocketServer() {
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
