"use strict";

/* eslint-disable no-console */
/* eslint-disable n/no-process-exit */

// Suppress deprecation warning in Node 22 due to http-proxy using util._extend()
require("util")._extend = Object.assign;

const fs = require("fs");
const path = require("path");
const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const PORT = process.env.PORT || 3001;
const DEFAULT_ENV_PATH = path.join(process.cwd(), "approuter/default-env.json");
const APP_ROOT = path.join(process.cwd(), "app");

const COMPONENT_NAME = "/cap-js-community-common/localHTML5Repo";

class LocalHTML5Repo {
  constructor(options) {
    this.component = COMPONENT_NAME;
    this.port = options?.port || PORT;
    this.path = options?.path || DEFAULT_ENV_PATH;

    try {
      this.defaultEnv = require(this.path);
    } catch (err) {
      console.error(`Cannot read default-env.json at ${this.path}`);
      throw err;
    }
  }

  start() {
    return new Promise((resolve) => {
      this.adjustDefaultEnv();

      console.log("Registering apps:");
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

          console.log(`- ${name} [${type}] -> ${path.join(APP_ROOT, appDirectory)}`);
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
          console.error("HTML5 Repo proxy error:", err.message);
          res.status(502).end("Bad Gateway");
        },
      });

      // Catch-all proxy (must be last)
      app.use("/", html5RepoProxy);

      this.server = app.listen(this.port, () => {
        console.log(`Local HTML5 repository running on port ${this.port}`);
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

    console.log(`Rewriting HTML5 Repo URL in default-env.json of approuter: ${url}`);

    fs.writeFileSync(DEFAULT_ENV_PATH, JSON.stringify(this.defaultEnv, null, 2) + "\n");
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
