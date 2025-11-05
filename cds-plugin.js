"use strict";

const cds = require("@sap/cds");
require("./src/common/promise");

const { ReplicationCache, RateLimiting } = require("./src");

if (cds.env.rateLimiting.plugin) {
  cds.on("serving", async (service) => {
    if (
      service.definition["@cds.rateLimiting"] ||
      Object.keys(service.definition).find((name) => {
        return name.startsWith("@cds.rateLimiting.");
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
