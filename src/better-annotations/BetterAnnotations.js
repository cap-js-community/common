"use strict";

const cds = require("@sap/cds");
const { enhanceModel } = require("./model-enhancer");
const { registerHandlers } = require("./handler-registrar");

const COMPONENT = "/cap-js-community-common/better-annotations";

class BetterAnnotations {
  constructor() {
    this.log = cds.log(COMPONENT);
  }

  attach() {
    cds.on("loaded", (model) => {
      const metadata = enhanceModel(model);
      cds.betterAnnotations = metadata;
      const serviceCount = Object.keys(metadata.services).length;
      if (serviceCount > 0) {
        this.log.info("Enhanced model for", serviceCount, "service(s)");
      }
    });

    cds.on("serving", (service) => {
      registerHandlers(service);
      this.log.info("Registered handlers for", service.name);
    });
  }
}

module.exports = BetterAnnotations;
