"use strict";

/* eslint-disable n/no-process-exit */

// Suppress deprecation warning in Node 22 due to http-proxy using util._extend()
require("util")._extend = Object.assign;

const fs = require("fs");
const path = require("path");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const cds = require("@sap/cds");

const DEFAULT_ENV_NAME = "default-env.json";
const DEFAULT_ENV_PATHS = [
  path.join(process.cwd(), "app", "router", DEFAULT_ENV_NAME),
  path.join(process.cwd(), "approuter", DEFAULT_ENV_NAME),
];
const APP_ROOT = path.join(process.cwd(), "app");
const PORT = process.env.PORT || 3001;

const COMPONENT_NAME = "/cap-js-community-common/local-html5-repo";

class LocalHTML5Repo {
  constructor(options) {
    this.component = COMPONENT_NAME;
    this.port = options?.port || PORT;
    this.path = options?.path;
    if (!this.path) {
      for (const path of DEFAULT_ENV_PATHS) {
        if (fs.existsSync(path)) {
          this.path = path;
          break;
        }
      }
    }
    try {
      this.defaultEnv = require(this.path);
    } catch (err) {
      cds.log(this.component).error(`Cannot read default-env.json at ${this.path}`);
      throw err;
    }
  }

  start() {
    return new Promise((resolve) => {
      this.adjustDefaultEnv();

      cds.log(this.component).info("Registering apps:");
      const app = express();

      // Serve every webapp
      const appDirectories = fs
        .readdirSync(APP_ROOT, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);

      for (const appDirectory of appDirectories) {
        const ui5ConfigPath = path.join(APP_ROOT, appDirectory, "ui5.yaml");
        if (!fs.existsSync(ui5ConfigPath)) {
          continue;
        }

        const ui5Config = fs.readFileSync(ui5ConfigPath, "utf-8");
        const { name, type } = this.extractNameAndType(ui5Config);
        const appId = name?.replace(/\./g, "");

        if (appId) {
          app.use(
            [`/${appId}`, `/${appId}-:version`],
            express.static(path.join(APP_ROOT, appDirectory, type === "application" ? "webapp" : "src")),
            // Serve xs-app.json and other non-webapp files
            express.static(path.join(APP_ROOT, appDirectory), {
              fallthrough: false,
            }),
          );

          cds.log(this.component).info(`- ${name} [${type}] -> ${path.join(APP_ROOT, appDirectory)}`);
        }
      }

      process.on("SIGINT", () => {
        this.stop();
        process.exit(0);
      });

      // Forward everything else to the original HTML5 Apps Repo
      const html5RepoProxy = createProxyMiddleware({
        target: this.originalHtmlRepoUrl,
        changeOrigin: true,
        ws: true,
        logLevel: "warn",
        onError(err, req, res) {
          cds.log(this.component).error("HTML5 Repo proxy error:", err.message);
          res.status(502).end("Bad Gateway");
        },
      });

      // Catch-all proxy (must be last)
      app.use("/", html5RepoProxy);

      this.server = app.listen(this.port, () => {
        cds.log(this.component).info(`Local HTML5 repository running on port ${this.port}`);
        resolve(this.server);
      });
    });
  }

  async stop() {
    if (this.server) {
      this.server.close();
    }
    this.restoreDefaultEnv();
  }

  adjustDefaultEnv() {
    this.originalHtmlRepoUrl = this.defaultEnv.VCAP_SERVICES["html5-apps-repo"][0].credentials.uri;

    this.defaultEnv.VCAP_SERVICES["html5-apps-repo"][0].credentials.uri = `http://localhost:${this.port}`;

    this.writeDefaultEnv();
  }

  restoreDefaultEnv() {
    this.defaultEnv.VCAP_SERVICES["html5-apps-repo"][0].credentials.uri = this.originalHtmlRepoUrl;

    this.writeDefaultEnv();
  }

  writeDefaultEnv() {
    const url = this.defaultEnv.VCAP_SERVICES["html5-apps-repo"][0].credentials.uri;
    cds.log(this.component).info(`Rewriting HTML5 Repo URL in default-env.json of approuter: ${url}`);
    fs.writeFileSync(this.path, JSON.stringify(this.defaultEnv, null, 2) + "\n");
  }

  extractNameAndType(content) {
    const result = { name: "", type: "" };

    for (const line of content.split("\n")) {
      const trimmed = line.trim();

      if (trimmed.startsWith("name:")) {
        result.name = trimmed.split(" ")[1];
      }

      if (trimmed.startsWith("type:")) {
        result.type = trimmed.split(" ")[1];
      }

      if (result.name && result.type) {
        break;
      }
    }

    return result;
  }
}

module.exports = LocalHTML5Repo;
