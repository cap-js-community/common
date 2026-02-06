"use strict";

const path = require("path");
const fs = require("fs");
const cds = require("@sap/cds");

const COMPONENT_NAME = "/cap-js-community-common/cdm-build";

const DEFAULT_ICON = "sap-icon://activity-2";
const DEFAULT_VERSION = "3.2.0";

const regexLanguageFile = /.*\.properties$/;
const regexLanguageSuffixFile = /.*?_([a-z]{2}(?:_[a-z]{2})?)\.properties/i;

class CDMBuilder {
  constructor(options = {}) {
    this.component = COMPONENT_NAME;

    this.options = options;
    this.rootPath = options.root || process.cwd();

    const project = this.deriveProject();

    this.appPath = options.app || path.join(this.rootPath, "app");
    this.portalSitePath = options.portalSite || path.join(this.appPath, "portal", "portal-site");
    this.cdmPath = options.cdm || path.join(this.portalSitePath, "CommonDataModel.json");
    this.targetPath = options.target || path.join(this.appPath, "cdm.json");
    this.xsSecurityPath = options.xsSecurity || path.join(this.rootPath, "xs-security.json");

    this.icon = options.icon || DEFAULT_ICON;
    this.version = options.version || DEFAULT_VERSION;
    this.namespace = options.namespace || project.name;
    this.description = options.description || project.description;
    this.defaultLanguage = cds.env.i18n?.default_language || options.language || "en";
    this.i18nPath = options.i18n || "i18n";
    this.i18nData = this.loadI18n(path.join(this.portalSitePath, this.i18nPath));
    this.i18nBundle = options.i18nBundle || false;
  }

  async build() {
    if (!this.options.skipWrite && !this.options.force && fs.existsSync(this.targetPath)) {
      cds.log(this.component).info("Generation is skipped. CDM file already exists", this.targetPath);
      return;
    }
    const cdm = fs.existsSync(this.cdmPath)
      ? require(this.cdmPath)
      : {
          _version: this.version,
          identification: {
            id: `${this.namespace}-flp`,
            title: this.namespace,
            entityType: "bundle",
          },
          payload: {},
        };
    const apps = this.lookupApps(this.appPath);
    const roles = this.lookupRoles(apps);
    this.enhanceExisting(cdm);
    this.addCatalogsAndGroups(cdm, apps);
    this.addSitesAndPages(cdm);
    this.addHomepageApp(cdm);
    this.addBusinessApps(cdm, apps);
    this.addUrlTemplates(cdm);
    this.addRoles(cdm, roles);
    if (!this.options.skipWrite) {
      fs.mkdirSync(path.dirname(this.targetPath), { recursive: true });
      fs.writeFileSync(this.targetPath, JSON.stringify(Object.values(cdm.payload).flat(), null, 2));
    }
    return cdm;
  }

  deriveProject() {
    const packageJSON = require(path.join(this.rootPath, "package.json"));
    const rawName = packageJSON.name.split("/").pop();
    const parts = rawName.split(/[-.]/);
    const name = parts.join(".");
    return {
      name,
      description: packageJSON.description || name,
    };
  }

  enhanceExisting(cdm) {
    cdm._version = this.version;
    cdm.payload.catalogs ||= [];
    let index = 1;
    for (const catalog of cdm.payload.catalogs) {
      catalog._version = this.version;
      catalog.identification.id = `${this.namespace}-catalog${cdm.payload.catalogs.length > 1 ? `-${index++}` : ""}`;
      for (const viz of catalog.payload.viz || []) {
        viz.appId ??= viz.id;
      }
      if (!this.i18nBundle) {
        delete catalog.identification.i18n;
        catalog.texts = this.buildTexts(this.i18nData);
      }
    }
    cdm.payload.groups ||= [];
    index = 1;
    for (const group of cdm.payload.groups) {
      group._version = this.version;
      group.identification.id = `${this.namespace}-group${cdm.payload.groups.length > 1 ? `-${index++}` : ""}`;
      if (!this.i18nBundle) {
        delete group.identification.i18n;
        group.texts = this.buildTexts(this.i18nData);
      }
    }
    delete cdm.payload.sites;
  }

  addCatalogsAndGroups(cdm, apps) {
    cdm.payload.catalogs ||= [];
    if (!cdm.payload.catalogs.length) {
      const catalog = {
        _version: this.version,
        identification: {
          id: `${this.namespace}-catalog`,
          title: "{{title}}",
          entityType: "catalog",
          ...(this.i18nBundle ? { i18n: "i18n/catalog.properties" } : {}),
        },
        payload: { viz: [] },
        ...(!this.i18nBundle ? { texts: this.buildTexts(this.i18nData, ["title"], this.description) } : {}),
      };
      for (const app of apps) {
        catalog.payload.viz.push({
          appId: app.appId,
          vizId: app.defaultViz,
        });
      }
      cdm.payload.catalogs.push(catalog);
    }
    cdm.payload.groups ||= [];
    if (!cdm.payload.groups.length) {
      const group = {
        _version: this.version,
        identification: {
          id: `${this.namespace}-group`,
          title: "{{title}}",
          entityType: "group",
          ...(this.i18nBundle ? { i18n: "i18n/group.properties" } : {}),
        },
        payload: { viz: [] },
        ...(!this.i18nBundle ? { texts: this.buildTexts(this.i18nData, ["title"], this.description) } : {}),
      };
      for (const app of apps) {
        group.payload.viz.push({
          id: app.id,
          appId: app.appId,
          vizId: app.defaultViz,
        });
      }
      cdm.payload.groups.push(group);
    }
  }

  addSitesAndPages(cdm) {
    cdm.payload.spaces ||= [];
    cdm.payload.pages ||= [];
    const space = {
      _version: this.version,
      identification: {
        id: `${this.namespace}-space`,
        title: "{{title}}",
        entityType: "space",
        ...(this.i18nBundle ? { i18n: "i18n/space.properties" } : {}),
      },
      payload: { contentNodes: [] },
      ...(!this.i18nBundle ? { texts: this.buildTexts(this.i18nData, ["title"], this.description) } : {}),
    };
    cdm.payload.spaces.push(space);
    let index = 1;
    for (const group of cdm.payload.groups || []) {
      const pageId = `${this.namespace}-page${cdm.payload.groups.length > 1 ? `-${index++}` : ""}`;
      cdm.payload.pages.push({
        _version: this.version,
        identification: {
          id: pageId,
          title: "{{title}}",
          entityType: "page",
          ...(this.i18nBundle ? { i18n: "i18n/page.properties" } : {}),
        },
        payload: {
          sections: [
            {
              id: `${this.namespace}-section`,
              title: "{{title}}",
              viz: group.payload.viz,
            },
          ],
        },
        ...(!this.i18nBundle ? { texts: this.buildTexts(this.i18nData, ["title"], this.description) } : {}),
      });
      space.payload.contentNodes.push({
        type: "page",
        id: pageId,
      });
    }
  }

  addHomepageApp(cdm) {
    cdm.payload.apps ||= [];
    cdm.payload.apps.push({
      _version: this.version,
      identification: {
        id: `${this.namespace}-shell-home`,
        entityType: "businessapp",
        title: "{{title}}",
        ...(this.i18nBundle ? { i18n: "i18n/businessapp.properties" } : {}),
      },
      payload: {
        targetAppConfig: {
          "sap.app": {
            crossNavigation: {
              inbounds: {
                default: {
                  semanticObject: "Shell",
                  action: "home",
                  signature: {},
                },
              },
            },
            tags: {
              keywords: [],
              technicalAttributes: ["APPTYPE_HOMEPAGE"],
            },
          },
          "sap.integration": {
            urlTemplateId: `${this.namespace}-urltemplate-home`,
            urlTemplateParams: { path: "" },
          },
          "sap.ui": {
            icons: { icon: this.icon },
          },
        },
        visualizations: {
          default: {
            vizType: "sap.ushell.StaticAppLauncher",
            vizConfig: {
              "sap.app": { title: "{{title}}" },
              "sap.flp": {
                target: { type: "IBN", inboundId: "default" },
              },
            },
          },
        },
        defaultViz: "default",
      },
      ...(!this.i18nBundle ? { texts: this.buildTexts(this.i18nData, ["title"], this.description) } : {}),
    });
  }

  addBusinessApps(cdm, apps) {
    cdm.payload.apps ||= [];
    for (const app of apps) {
      const defaultViz = app.defaultViz;
      if (!defaultViz) {
        continue;
      }
      const icon = app.crossNavigation.inbounds[defaultViz].icon || this.icon;
      const texts = this.buildAppTexts(app.i18n, app.id);
      cdm.payload.apps.push({
        _version: this.version,
        identification: {
          id: app.id,
          entityType: "businessapp",
          title: "{{title}}",
          ...(this.i18nBundle ? { i18n: "i18n/app.properties" } : {}),
        },
        payload: {
          targetAppConfig: {
            "sap.app": { crossNavigation: app.crossNavigation },
            "sap.integrations": [
              {
                navMode: "explace",
                urlTemplateId: `${this.namespace}-urltemplate`,
                urlTemplateParams: { path: "" },
              },
            ],
            "sap.ui": { icons: { icon } },
          },
          visualizations: {
            [defaultViz]: {
              vizType: "sap.ushell.StaticAppLauncher",
              vizConfig: {
                "sap.app": { title: "{{title}}" },
                "sap.flp": {
                  target: { type: "IBN", inboundId: defaultViz },
                },
              },
            },
          },
          defaultViz,
        },
        ...(!this.i18nBundle ? { texts } : {}),
      });
    }
  }

  addUrlTemplates(cdm) {
    cdm.payload.urlTemplates ||= [];
    const templates = [
      {
        id: `${this.namespace}-urltemplate-home`,
        template: "{+_baseUrl}{+path}#Shell-home{?intentParameters*}",
      },
      {
        id: `${this.namespace}-urltemplate`,
        template: "{+_baseUrl}{+path}#{+semanticObject}-{+action}{?intentParameters*}",
      },
    ];
    for (const template of templates) {
      cdm.payload.urlTemplates.push({
        _version: this.version,
        identification: {
          id: template.id,
          entityType: "urltemplate",
          title: "{{title}}",
          ...(this.i18nBundle ? { i18n: "i18n/urltemplate.properties" } : {}),
        },
        payload: {
          urlTemplate: template.template,
          parameters: {
            mergeWith: "/urlTemplates/urltemplate.base/payload/parameters/names",
            names: {
              path: "{./sap.integration/urlTemplateParams/path}",
              intentParameters: "{*}",
            },
          },
          capabilities: { navigationMode: "standalone" },
        },
        ...(!this.i18nBundle ? { texts: this.buildTexts(this.i18nData) } : {}),
      });
    }
  }

  addRoles(cdm, roles) {
    cdm.payload.roles ||= [];
    let scopes = {};
    if (fs.existsSync(this.xsSecurityPath)) {
      const xsSecurity = require(this.xsSecurityPath);
      scopes = Object.fromEntries(xsSecurity.scopes.map((scope) => [this.localScope(scope.name), scope]));
    }
    for (const role of Object.keys(roles)) {
      const scope = scopes[role];
      cdm.payload.roles.push({
        _version: this.version,
        identification: {
          id: role,
          entityType: "role",
          title: "{{title}}",
          ...(this.i18nBundle ? { i18n: "i18n/role.properties" } : {}),
        },
        payload: {
          catalogs: [{ id: `${this.namespace}-catalog` }],
          groups: [{ id: `${this.namespace}-group` }],
          spaces: [{ id: `${this.namespace}-space` }],
          apps: [...roles[role].map((app) => ({ id: app.id })), { id: `${this.namespace}-shell-home` }],
        },
        ...(!this.i18nBundle
          ? {
              texts: [
                {
                  locale: "",
                  textDictionary: {
                    title: scope?.description || role,
                  },
                },
              ],
            }
          : {}),
      });
    }
  }

  lookupApps(appRoot) {
    const apps = [];
    const dirs = fs
      .readdirSync(appRoot, { withFileTypes: true })
      .filter((dir) => dir.isDirectory())
      .map((dir) => dir.name);
    for (const dir of dirs) {
      const ui5Yaml = path.join(appRoot, dir, "ui5.yaml");
      if (!fs.existsSync(ui5Yaml)) {
        continue;
      }
      const manifestPath = path.join(appRoot, dir, "webapp", "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        continue;
      }
      const manifest = require(manifestPath);
      if (manifest["sap.flp"]?.type === "plugin") {
        continue;
      }
      const appId = manifest["sap.app"]?.id;
      if (!appId || appId.endsWith(".extension")) {
        continue;
      }
      const crossNavigation = manifest["sap.app"]?.crossNavigation || {};
      const defaultViz = Object.keys(crossNavigation.inbounds || {})[0];
      const scopes = manifest["sap.platform.cf"]?.oAuthScopes?.map((s) => this.localScope(s)) || [];
      const i18n = this.loadI18n(path.join(appRoot, dir, "webapp", "i18n"));
      apps.push({
        id: appId,
        appId,
        defaultViz,
        crossNavigation,
        scopes,
        i18n,
      });
    }
    return apps;
  }

  lookupRoles(apps) {
    const roles = {};
    for (const app of apps) {
      for (const scope of app.scopes) {
        roles[scope] ||= [];
        roles[scope].push(app);
      }
    }
    return roles;
  }

  localScope(scope) {
    return scope.startsWith("$XSAPPNAME.") ? scope.slice(11) : scope;
  }

  loadI18n(dir) {
    const result = {
      [this.defaultLanguage]: {},
    };
    try {
      for (const file of fs.readdirSync(dir)) {
        if (!regexLanguageFile.test(file)) {
          continue;
        }
        const texts = cds.load.properties(path.join(dir, file));
        const match = file.match(regexLanguageSuffixFile);
        const lang = match?.[1] || this.defaultLanguage;
        result[lang] ||= {};
        Object.assign(result[lang], texts);
      }
    } catch {
      /* ignore */
    }
    return result;
  }

  buildTexts(i18n, keys, defaultText = "") {
    const texts = [];
    for (const locale of Object.keys(i18n)) {
      texts.push({
        locale,
        textDictionary: keys
          ? Object.fromEntries(keys.map((key) => [key, i18n[locale][key] || defaultText]))
          : i18n[locale],
      });
    }
    texts.push({
      locale: "",
      textDictionary: keys
        ? Object.fromEntries(keys.map((key) => [key, i18n[this.defaultLanguage][key] || defaultText]))
        : i18n[this.defaultLanguage],
    });
    return texts;
  }

  buildAppTexts(i18n, app) {
    const texts = [];
    for (const locale of Object.keys(i18n)) {
      const title =
        i18n[locale].fioriAppTitle || i18n[locale].appTitle || i18n[locale].app_title || i18n[locale].appTitleReworked;
      if (!title) {
        throw new Error(`Missing title for locale ${locale} in app "${app}"`);
      }
      texts.push({
        locale,
        textDictionary: { title },
      });
    }
    texts.push({
      locale: "",
      textDictionary: {
        title:
          i18n[this.defaultLanguage]?.fioriAppTitle ||
          i18n[this.defaultLanguage]?.appTitle ||
          i18n[this.defaultLanguage]?.app_title ||
          i18n[this.defaultLanguage]?.appTitleReworked,
      },
    });
    return texts;
  }
}

module.exports = CDMBuilder;
