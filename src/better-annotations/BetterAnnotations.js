"use strict";

const cds = require("@sap/cds");
const { enhanceModel } = require("./model-enhancer");
const { registerHandlers } = require("./handler-registrar");

const COMPONENT = "/cap-js-community-common/better-annotations";

class BetterAnnotations {
  constructor() {
    this.log = cds.log(COMPONENT);
    this.metadata = null;
  }

  attach() {
    cds.on("loaded", (model) => {
      this.metadata = enhanceModel(model);
      const serviceCount = Object.keys(this.metadata.services).length;
      if (serviceCount > 0) {
        this.log.info("Enhanced model for", serviceCount, "service(s)");
      }
    });

    cds.on("serving", (service) => {
      if (!this.metadata) {
        return;
      }
      const svcMeta = this.metadata.services[service.name];
      if (!svcMeta) {
        return;
      }

      const hasSingleton = Object.keys(svcMeta.singletonFields).length > 0;
      const hasVirtual = Object.keys(svcMeta.virtualFields).length > 0;
      if (!hasSingleton && !hasVirtual) {
        return;
      }

      registerHandlers(service, svcMeta);
      this.log.info("Registered handlers for", service.name);
    });
  }
}

module.exports = BetterAnnotations;
