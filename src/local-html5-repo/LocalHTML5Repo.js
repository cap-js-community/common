"use strict";

/* eslint-disable no-console */
/* eslint-disable n/no-process-exit */

const fs = require("fs");
const path = require("path");
const express = require("express");
const proxy = require("express-request-proxy");

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
            // Serve xs-app.json as well which is not in webapp
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

      // Forward rest to the html5 apps repo
      const html5RepoProxy = proxy({
        url: `${this.originalHtmlRepoUrl}/*`,
      });
      app.use("/*", html5RepoProxy);
      this.server = app.listen(this.port, () => {
        console.log("Local HTML5 repository running on port " + this.port);
        resolve(this.server);
      });
    });
  }

  async stop() {
    this.server.close();
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
      if (line.trim().startsWith("name:")) {
        result.name = line.trim().split(" ")[1];
      }
      if (line.startsWith("type:")) {
        result.type = line.split(" ")[1];
      }
      if (result.type && result.name) {
        break;
      }
    }
    return result;
  }
}

module.exports = LocalHTML5Repo;
