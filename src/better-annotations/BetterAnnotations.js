"use strict";

const cds = require("@sap/cds");
const { enhanceModel } = require("./model-enhancer");
const { registerHandlers } = require("./handler-registrar");
const LOG = cds.log("/cap-js-community-common/better-annotations");

class BetterAnnotations {
  attach() {
    cds.on("loaded", (model) => {
      enhanceModel(model);
    });

    cds.on("serving", (service) => {
      registerHandlers(service);
      LOG.debug("Registered handlers for", service.name);
    });
  }
}

module.exports = BetterAnnotations;
