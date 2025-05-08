"use strict";

const cds = require("@sap/cds");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const COMPONENT_NAME = "migrationCheck";
const STRING_DEFAULT_LENGTH = 5000;

const Checks = [releasedEntityCheck, newEntityCheck, uniqueIndexCheck, journalModeCheck];
const Messages = {
  ReleasedEntityCannotBeRemoved: "A released entity cannot be removed",
  ReleasedEntityDraftEnablementCannotBeChanged: "The draft enablement state of a released entity cannot be changed",
  ReleasedElementCannotBeRemoved: "A released element cannot be removed",
  ReleasedElementKeyCannotBeChanged: "The key of a released element cannot be changed",
  ReleasedElementManagedUnmanagedCannotBeChanged: "The managed/unmanaged state of a released element cannot be changed",
  ReleasedElementVirtualCannotBeChanged: "The virtual state of a released element cannot be changed",
  ReleasedElementLocalizationCannotBeChanged: "The localization state of a released element cannot be changed",
  ReleasedElementNullableCannotBeChanged: "A released element cannot be changed to not-nullable",
  ReleasedElementTypeCannotBeChanged: "The data type of a released element cannot be changed",
  ReleasedElementTypeCannotBeShortened: "The data type of a released element cannot be shortened",
  ReleasedElementScalePrecisionCannotBeLower: "The scale or precision of a released element cannot be reduced",
  ReleasedElementTargetCannotBeChanged: "The target of a released element cannot be changed",
  ReleasedElementCardinalityCannotBeChanged: "The cardinality of a released element cannot be changed",
  ReleasedElementOnConditionCannotBeChanged: "The ON condition of a released element cannot be changed",
  ReleasedElementKeysConditionCannotBeChanged: "The keys condition of a released element cannot be changed",
  ReleasedEntityJournalModeAndEntityChangeIsNotAllowed:
    "Enabling journal mode and changing entity in same cycle is not allowed",
  ReleasedEntityIndexChangeIsNotAllowed: "Changes to the index of a released entity are not allowed",
  ReleasedEntityIndexChangeIsNotWhitelisted: "Changes to the index of a released entity must be whitelisted",
  ReleasedElementTypeExtensionIsNotWhitelisted: "Extending the type of a released element requires whitelisting",
  ReleasedElementScalePrecisionExtensionIsNotWhitelisted:
    "Extending the scale or precision of a released element requires whitelisting",

  NewEntityIsNotWhitelisted: "The new entity is not whitelisted",
  NewEntityElementIsNotWhitelisted: "The new entity element is not whitelisted",
  NewEntityElementNotNullableDefault: "A new entity element must have a default value if it is not nullable",
  NewEntityIndexIsNotWhitelisted: "The new entity index is not whitelisted",
};
const MessagesCodes = Object.keys(Messages).reduce((codes, key) => {
  codes[key] = key;
  return codes;
}, {});

class MigrationCheck {
  constructor(options) {
    this.log = cds.log(COMPONENT_NAME);
    this.options = {
      ...(cds.env.migrationCheck || {}),
      ...options,
    };
    const basePath = path.join(process.cwd(), this.options.baseDir);
    this.paths = {
      basePath,
      buildNodePath: path.join(process.cwd(), "./gen/srv/srv/csn.json"),
      buildJavaPath: path.join(process.cwd(), "./srv/src/main/resources/edmx/csn.json"),
      buildCustomPath: this.options.buildPath,
      prodPath: path.join(basePath, "./csn-prod.json"),
      prodHashPath: path.join(basePath, "./csn-prod-hash.json"),
      prodWhitelistPath: path.join(basePath, "./migration-extension-whitelist.json"),
      prodWhitelistHashPath: path.join(basePath, "./migration-extension-whitelist-hash.json"),
      prodFreeze: path.join(basePath, "./csn-prod.freeze"),
    };
    this.setup();
  }

  setup() {
    this.buildPath();
    this.freeze();
  }

  buildPath() {
    this.paths.buildPath = this.paths.buildCustomPath;
    if (!this.paths.buildPath && fs.existsSync(this.paths.buildNodePath)) {
      this.paths.buildPath = this.paths.buildNodePath;
    }
    if (!this.paths.buildPath && fs.existsSync(this.paths.buildJavaPath)) {
      this.paths.buildPath = this.paths.buildJavaPath;
    }
    this.paths.buildPath ??= this.paths.buildNodePath;
    return this.paths.buildPath;
  }

  freeze() {
    return this.options.freeze || fs.existsSync(this.paths.prodFreeze);
  }

  check(admin) {
    let checkMessages = [];
    let csnBuild;
    try {
      csnBuild = JSON.parse(fs.readFileSync(this.buildPath()));
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw err;
      }
      return {
        success: false,
        messages: [
          {
            code: "NoValidBuildCSN",
            text: `No valid build CSN found for CSN build path. Migration check cannot be started. Execute 'cds build --production' before`,
            severity: "error",
          },
        ],
      };
    }
    let csnProd;
    let csnProdChecksum;
    try {
      csnProd = JSON.parse(fs.readFileSync(this.paths.prodPath));
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw err;
      }
      return {
        success: true,
        messages: [
          {
            code: "NoProdCSNMigrationSkipped",
            text: `No valid production CSN found for path '${this.paths.prodPath}'. Execute 'cdsmc -u' to update production CSN. Migration check is skipped.`,
            severity: "info",
          },
        ],
      };
    }
    try {
      csnProdChecksum = JSON.parse(fs.readFileSync(this.paths.prodHashPath)).checksum;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw err;
      }
    }
    const prodData = fs.readFileSync(this.paths.prodPath);
    const prodDataHash = hash(prodData);
    if (prodDataHash !== csnProdChecksum) {
      return {
        success: false,
        messages: [
          {
            code: "HashMismatch",
            text: `Hash mismatch. Production CSN is protected: ${prodDataHash} <> ${csnProdChecksum}`,
            severity: "error",
          },
        ],
      };
    }

    let whitelist = { definitions: {} };
    try {
      whitelist = JSON.parse(fs.readFileSync(this.paths.prodWhitelistPath));
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw err;
      }
    }
    let whitelistChecksum;
    try {
      whitelistChecksum = JSON.parse(fs.readFileSync(this.paths.prodWhitelistHashPath)).checksum;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw err;
      }
    }
    if (this.freeze()) {
      if (whitelistChecksum) {
        const whiteListData = fs.readFileSync(this.paths.prodWhitelistPath);
        const whiteListDataHash = hash(whiteListData);
        if (whiteListDataHash !== whitelistChecksum) {
          return {
            success: false,
            messages: [
              {
                code: "HashMismatch",
                text: `Hash mismatch. Production CSN Whitelist is protected (Persistence Freeze): ${whiteListDataHash} <> ${whitelistChecksum}`,
                severity: "error",
              },
            ],
          };
        }
      } else {
        checkMessages.push({
          code: "PersistenceFreezeCheckSkipped",
          text: `No Production CSN Whitelist Checksum file found for path '${this.paths.prodWhitelistHashPath}'. Persistence Freeze check skipped.`,
          severity: "info",
        });
      }
    }
    const messages = Checks.reduce((messages, check) => {
      messages.push(...check(csnBuild, csnProd, whitelist, this.options));
      return messages;
    }, []);
    messages.push(...checkMessages);
    const result = {
      success: true,
      messages,
      adminHash: null,
    };
    if (messages.length > 0) {
      const messageHash = hash(JSON.stringify(messages));
      if (admin) {
        result.adminHash = messageHash;
      }
      if (this.options.adminHash) {
        if (this.options.adminHash === messageHash) {
          for (const message of result.messages) {
            message.severity = message.severity === "error" ? "warning" : message.severity;
          }
          messages.push({
            code: "AcceptedByAdmin",
            text: "Migration check errors accepted by admin",
            severity: "info",
          });
          result.success = true;
        } else {
          messages.push({
            code: "AdminHashInvalid",
            text: "Admin hash is not valid for current migration check state",
            severity: "error",
          });
          result.success = false;
        }
      } else {
        result.success = false;
      }
    }
    return result;
  }

  update(admin) {
    if (fs.existsSync(this.paths.prodPath)) {
      const checkResult = this.check(admin);
      if (!checkResult?.success) {
        return checkResult;
      }
    }
    try {
      JSON.parse(fs.readFileSync(this.buildPath()));
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw err;
      }
      return {
        success: false,
        messages: [
          {
            code: "NoValidBuildCSN",
            text: `No valid build CSN found for CSN build path. Migration update cannot be started. Execute 'cds build --production' before`,
            severity: "error",
          },
        ],
      };
    }
    fs.mkdirSync(this.paths.basePath, { recursive: true });
    fs.copyFileSync(this.buildPath(), this.paths.prodPath);
    let description = new Date().toISOString();
    if (this.options.label) {
      description = `${this.options.label} (${description})`;
    }
    const prodData = fs.readFileSync(this.paths.prodPath);
    fs.writeFileSync(
      this.paths.prodHashPath,
      JSON.stringify(
        {
          description,
          checksum: hash(prodData),
          "checksum-sha1": hash(prodData, "sha1"),
        },
        null,
        2,
      ) + "\n",
    );
    if (!fs.existsSync(this.paths.prodWhitelistPath) || !this.options.keep) {
      fs.writeFileSync(
        this.paths.prodWhitelistPath,
        JSON.stringify(
          {
            definitions: {},
          },
          null,
          2,
        ) + "\n",
      );
    }
    const whitelistData = fs.readFileSync(this.paths.prodWhitelistPath);
    fs.writeFileSync(
      this.paths.prodWhitelistHashPath,
      JSON.stringify(
        {
          description,
          checksum: hash(whitelistData),
          "checksum-sha1": hash(whitelistData, "sha1"),
        },
        null,
        2,
      ) + "\n",
    );
    if (admin && this.options.freeze) {
      fs.writeFileSync(this.paths.prodFreeze, "");
    } else {
      if (fs.existsSync(this.paths.prodFreeze)) {
        fs.rmSync(this.paths.prodFreeze);
      }
    }
    return {
      success: true,
      messages: [],
    };
  }
}

function releasedEntityCheck(csnBuild, csnProd, whitelist, options) {
  const messages = [];
  visitPersistenceEntities(
    csnProd,
    (definitionProd) => {
      let lookupName = definitionProd.name;
      if (lookupName.startsWith("cds.xt.") && !options.checkMtx) {
        return;
      }
      const definitionBuild = csnBuild.definitions[lookupName];
      if (!definitionBuild) {
        report(messages, MessagesCodes.ReleasedEntityCannotBeRemoved, definitionProd.name);
        return;
      }
      if (definitionProd["@odata.draft.enabled"] !== definitionBuild["@odata.draft.enabled"]) {
        report(messages, MessagesCodes.ReleasedEntityDraftEnablementCannotBeChanged, definitionProd.name);
      }
      const definitionWhitelist = whitelist.definitions && whitelist.definitions[definitionProd.name];
      Object.keys(definitionProd.elements || {}).forEach((elementProdName) => {
        const elementProd = definitionProd.elements[elementProdName];
        const elementBuild = definitionBuild.elements[elementProdName];
        const elementWhitelist =
          definitionWhitelist && definitionWhitelist.elements && definitionWhitelist.elements[elementProdName];
        if (elementBuild) {
          if (["cds.Association", "cds.Composition"].includes(elementProd.type)) {
            if (!((elementProd.on && elementBuild.on) || (elementProd.keys && elementBuild.keys))) {
              report(
                messages,
                MessagesCodes.ReleasedElementManagedUnmanagedCannotBeChanged,
                definitionProd.name,
                elementProdName,
              );
              return;
            }
          }
        }
        if (elementProd.on) {
          return; // Skip unmanaged association / composition
        }
        if (!elementBuild) {
          if (!elementProd.virtual) {
            report(messages, MessagesCodes.ReleasedElementCannotBeRemoved, definitionProd.name, elementProdName);
          }
        } else if (elementProd.key !== elementBuild.key) {
          report(messages, MessagesCodes.ReleasedElementKeyCannotBeChanged, definitionProd.name, elementProdName);
        } else if (elementProd.virtual !== elementBuild.virtual) {
          report(messages, MessagesCodes.ReleasedElementVirtualCannotBeChanged, definitionProd.name, elementProdName);
        } else if (elementProd.localized && !elementBuild.localized) {
          report(
            messages,
            MessagesCodes.ReleasedElementLocalizationCannotBeChanged,
            definitionProd.name,
            elementProdName,
          );
        } else if (!elementProd.notNull && elementBuild.notNull) {
          report(messages, MessagesCodes.ReleasedElementNullableCannotBeChanged, definitionProd.name, elementProdName);
        } else if (normalizeType(csnProd, elementProd.type) !== normalizeType(csnBuild, elementBuild.type)) {
          report(messages, MessagesCodes.ReleasedElementTypeCannotBeChanged, definitionProd.name, elementProdName);
        } else if ((elementProd.length || STRING_DEFAULT_LENGTH) > (elementBuild.length || STRING_DEFAULT_LENGTH)) {
          report(messages, MessagesCodes.ReleasedElementTypeCannotBeShortened, definitionProd.name, elementProdName);
        } else if ((elementProd.length || STRING_DEFAULT_LENGTH) < (elementBuild.length || STRING_DEFAULT_LENGTH)) {
          if (!elementWhitelist && options.whitelist) {
            report(
              messages,
              MessagesCodes.ReleasedElementTypeExtensionIsNotWhitelisted,
              definitionProd.name,
              elementProdName,
            );
          }
        } else if (elementProd.scale > elementBuild.scale || elementProd.precision > elementBuild.precision) {
          report(
            messages,
            MessagesCodes.ReleasedElementScalePrecisionCannotBeLower,
            definitionProd.name,
            elementProdName,
          );
        } else if (elementProd.scale < elementBuild.scale || elementProd.precision < elementBuild.precision) {
          if (!elementWhitelist && options.whitelist) {
            report(
              messages,
              MessagesCodes.ReleasedElementScalePrecisionExtensionIsNotWhitelisted,
              definitionProd.name,
              elementProdName,
            );
          }
        } else if (elementProd.target !== elementBuild.target) {
          if (
            isPersistenceEntity(csnProd, elementProd.target) ||
            isPersistenceEntity(csnBuild, elementBuild.target) ||
            JSON.stringify(entityKeyInfo(csnProd, elementProd.target)) !==
              JSON.stringify(entityKeyInfo(csnBuild, elementBuild.target))
          ) {
            report(messages, MessagesCodes.ReleasedElementTargetCannotBeChanged, definitionProd.name, elementProdName);
          }
        } else if (
          (elementProd.cardinality && elementProd.cardinality.max) !==
          (elementBuild.cardinality && elementBuild.cardinality.max)
        ) {
          report(
            messages,
            MessagesCodes.ReleasedElementCardinalityCannotBeChanged,
            definitionProd.name,
            elementProdName,
          );
        } else if (JSON.stringify(elementProd.on) !== JSON.stringify(elementBuild.on)) {
          if (isPersistenceEntity(csnProd, elementProd.target) || isPersistenceEntity(csnBuild, elementBuild.target)) {
            report(
              messages,
              MessagesCodes.ReleasedElementOnConditionCannotBeChanged,
              definitionProd.name,
              elementProdName,
            );
          }
        } else if (JSON.stringify(elementProd.keys) !== JSON.stringify(elementBuild.keys)) {
          if (isPersistenceEntity(csnProd, elementProd.target) || isPersistenceEntity(csnBuild, elementBuild.target)) {
            report(
              messages,
              MessagesCodes.ReleasedElementKeysConditionCannotBeChanged,
              definitionProd.name,
              elementProdName,
            );
          }
        }
      });
    },
    options.filter,
  );
  return messages;
}

function newEntityCheck(csnBuild, csnProd, whitelist, options) {
  const messages = [];
  visitPersistenceEntities(
    csnBuild,
    (definitionBuild, { draft } = {}) => {
      let lookupName = definitionBuild.name;
      const definitionProd = csnProd.definitions[lookupName];
      const definitionWhitelist = whitelist.definitions && whitelist.definitions[definitionBuild.name];
      if (!definitionProd && !definitionWhitelist && options.whitelist) {
        report(messages, MessagesCodes.NewEntityIsNotWhitelisted, definitionBuild.name);
        return;
      }
      if (definitionProd) {
        Object.keys(definitionBuild.elements || {}).forEach((elementBuildName) => {
          const elementBuild = definitionBuild.elements[elementBuildName];
          if (elementBuild.virtual) {
            return;
          }
          const elementProd = definitionProd.elements[elementBuildName];
          const elementWhitelist =
            definitionWhitelist && definitionWhitelist.elements && definitionWhitelist.elements[elementBuildName];
          if (!elementProd) {
            if (!elementWhitelist && options.whitelist) {
              report(messages, MessagesCodes.NewEntityElementIsNotWhitelisted, definitionBuild.name, elementBuildName);
            }
            if (
              !draft &&
              elementBuild.notNull &&
              (elementBuild.default === undefined || elementBuild.default?.val === null)
            ) {
              report(
                messages,
                MessagesCodes.NewEntityElementNotNullableDefault,
                definitionBuild.name,
                elementBuildName,
              );
            }
          }
        });
      }
    },
    options.filter,
  );
  return messages;
}

function uniqueIndexCheck(csnBuild, csnProd, whitelist, options) {
  const messages = [];
  visitPersistenceEntities(
    csnBuild,
    (definitionBuild) => {
      const definitionWhitelist = whitelist.definitions && whitelist.definitions[definitionBuild.name];
      const definitionProd = csnProd.definitions[definitionBuild.name];
      if (definitionProd) {
        Object.keys(definitionBuild).forEach((key) => {
          if (key.startsWith("@assert.unique.")) {
            const uniqueIndexAnnotationBuild = definitionBuild[key];
            const uniqueIndexAnnotationProd = definitionProd[key];
            if (uniqueIndexAnnotationBuild && !uniqueIndexAnnotationProd && !definitionWhitelist && options.whitelist) {
              report(messages, MessagesCodes.NewEntityIndexIsNotWhitelisted, definitionBuild.name);
            } else if (uniqueIndexAnnotationBuild && uniqueIndexAnnotationProd) {
              const checkProd = uniqueIndexAnnotationProd.every((indexPartProd) => {
                return uniqueIndexAnnotationBuild.find((indexPartBuild) => {
                  return (indexPartProd["="] || indexPartProd) === (indexPartBuild["="] || indexPartBuild);
                });
              });
              if (!checkProd) {
                report(messages, MessagesCodes.ReleasedEntityIndexChangeIsNotAllowed, definitionBuild.name);
              }
              const checkBuild = uniqueIndexAnnotationBuild.every((indexPartBuild) => {
                return uniqueIndexAnnotationProd.find((indexPartProd) => {
                  return (indexPartBuild["="] || indexPartBuild) === (indexPartProd["="] || indexPartProd);
                });
              });
              if (!checkBuild && !definitionWhitelist && options.whitelist) {
                report(messages, MessagesCodes.ReleasedEntityIndexChangeIsNotWhitelisted, definitionBuild.name);
              }
            }
          }
        });
      }
    },
    options.filter,
  );
  return messages;
}

function journalModeCheck(csnBuild, csnProd, whitelist, options) {
  const messages = [];
  if (options.check === "journalModeCheck") {
    // Recursion
    return messages;
  }
  visitPersistenceEntities(
    csnBuild,
    (definitionBuild) => {
      const definitionProd = csnProd.definitions[definitionBuild.name];
      if (definitionProd) {
        if (definitionBuild["@cds.persistence.journal"] && !definitionProd["@cds.persistence.journal"]) {
          const entityMessages = Checks.reduce((messages, check) => {
            messages.push(...check(csnBuild, csnProd, {}, { ...options, filter: [definitionBuild.name], check: "journalModeCheck" }));
            return messages;
          }, []);
          if (entityMessages.length > 0) {
            report(messages, MessagesCodes.ReleasedEntityJournalModeAndEntityChangeIsNotAllowed, definitionBuild.name);
          }
        }
      }
    },
    options.filter,
  );
  return messages;
}

function visitPersistenceEntities(csn, onEntity, filter) {
  if (!onEntity) {
    return;
  }
  const services = Object.keys(csn.definitions).filter((name) => {
    return csn.definitions[name].kind === "service";
  });
  return Object.keys(csn.definitions).forEach((name) => {
    if (filter && !filter.includes(name)) {
      return;
    }
    // Normal persistence entity
    const definition = csn.definitions[name];
    if (
      definition.kind === "entity" &&
      !definition.query &&
      !definition.projection &&
      !definition["@cds.persistence.skip"]
    ) {
      definition.name = name;
      onEntity(definition);
    }

    // Draft persistence entity
    if (definition.kind === "entity" && definition["@odata.draft.enabled"]) {
      const partOfService = services.find((service) => {
        return name.startsWith(`${service}.`);
      });
      if (partOfService) {
        const _compositeEntities = compositeEntities(csn.definitions, name);
        _compositeEntities.forEach((name) => {
          const definition = csn.definitions[name];
          definition.name = name;
          onEntity(definition, { draft: true });
        });
      }
    }
  });
}

function compositeEntities(csn, name, result = []) {
  result.push(name);
  const entity = csn[name];
  if (entity && entity.elements) {
    Object.keys(entity.elements).forEach((elementName) => {
      const element = entity.elements[elementName];
      if (element.type === "cds.Composition") {
        compositeEntities(csn, element.target, result);
      }
    });
  }
  return result;
}

function isPersistenceEntity(csn, entity) {
  return !(csn.definitions[entity].query || csn.definitions[entity].projection);
}

function entityKeyInfo(csn, entity) {
  return Object.keys(csn.definitions[entity].elements)
    .filter((name) => {
      return !!csn.definitions[entity].elements[name].key;
    })
    .map((name) => {
      return {
        name,
        type: csn.definitions[entity].elements[name].type,
      };
    }, [])
    .sort((a, b) => a.name.localeCompare(b.name));
}

function report(messages, code, entity, element, severity = "error") {
  const text = Messages[code];
  const message = {
    code,
    text: `${text}: ${entity}${element ? "." + element : ""}`,
    entity,
    element,
    severity,
  };
  messages.push(message);
  return message;
}

function normalizeType(csn, type) {
  while (csn.definitions[type]) {
    type = csn.definitions[type].type;
  }
  return typeof type === "object" ? JSON.stringify(type) : type;
}

const hash = (buffer, algorithm = "sha256") => crypto.createHash(algorithm).update(buffer).digest("hex");

module.exports = MigrationCheck;
