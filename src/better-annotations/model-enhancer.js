"use strict";

const cds = require("@sap/cds");

const { OPERATIONS, analyzeRestrictions, analyzeActionRestrictions, determineStrategy } = require("./analyzer");

const log = cds.log("/cap-js-community-common/better-annotations");
const SINGLETON_NAME = "BetterAnnotationsConfig";

const ANNO_ROLES = "@BetterAnnotations.roles"; // on singleton element: list of roles that grant the operation
const ANNO_UNCONDITIONAL = "@BetterAnnotations.unconditionalRoles"; // on virtual __fc_ element
const ANNO_CONDITIONAL = "@BetterAnnotations.conditionalGrants"; // on virtual __fc_ element: [{role, where}]

const UI_HIDDEN_MAP = {
  CREATE: "@UI.CreateHidden",
  UPDATE: "@UI.UpdateHidden",
  DELETE: "@UI.DeleteHidden",
};

const CAPABILITIES_MAP = {
  CREATE: "@Capabilities.InsertRestrictions.Insertable",
  UPDATE: "@Capabilities.UpdateRestrictions.Updatable",
  DELETE: "@Capabilities.DeleteRestrictions.Deletable",
};

function hasUIAnnotations(def) {
  return Object.keys(def).some((k) => k.startsWith("@UI."));
}

/**
 * Add a virtual Boolean element to an entity definition with metadata annotations.
 * Handles both plain entities and projection entities (adds to projection.columns too).
 */
function addVirtualElement(def, fieldName, unconditionalRoles, conditionalGrants) {
  if (!def.elements) {
    def.elements = {};
  }
  def.elements[fieldName] = {
    "@Core.Computed": true,
    virtual: true,
    type: "cds.Boolean",
    "@UI.Hidden": true,
    [ANNO_UNCONDITIONAL]: [...unconditionalRoles],
    [ANNO_CONDITIONAL]: conditionalGrants.map((g) => ({ role: g.role, where: g.where })),
  };

  if (def.projection) {
    if (!def.projection.columns) {
      def.projection.columns = ["*"];
    }
    def.projection.columns.push({
      virtual: true,
      as: fieldName,
      cast: { type: "cds.Boolean" },
    });
  }
}

function shortName(fqn) {
  const parts = fqn.split(".");
  return parts[parts.length - 1];
}

function serviceName(fqn) {
  const idx = fqn.lastIndexOf(".");
  return idx > 0 ? fqn.substring(0, idx) : null;
}

/**
 * Find the single "parent" association on a child entity, meaning: an Association
 * (or composition backlink) whose target is another entity in the same service
 * that composes this child (Composition of many <Child> on <backlink> = $self).
 * Returns { assocName, parentDef } or null when unresolvable / ambiguous.
 */
function findParentAssociation(childFqn, childDef, model) {
  if (!childDef.elements) {
    return null;
  }

  const candidates = [];
  for (const [name, element] of Object.entries(childDef.elements)) {
    if (!element?.target) {
      continue;
    }
    const parentDef = model.definitions[element.target];
    if (!parentDef?.elements) {
      continue;
    }

    // Look for a Composition on the parent that targets this child via `on child.<assocName> = $self`
    for (const parentElement of Object.values(parentDef.elements)) {
      if (parentElement?.target !== childFqn) {
        continue;
      }
      const onCondition = parentElement.on;
      if (!Array.isArray(onCondition)) {
        continue;
      }
      // Structure: [{ref:['<compositionAlias>','<assocName>']}, '=', {ref:['$self']}] (or reversed)
      const referencesChildBacklink = onCondition.some((token) => {
        return (
          typeof token === "object" &&
          Array.isArray(token?.ref) &&
          token.ref.length >= 2 &&
          token.ref[token.ref.length - 1] === name
        );
      });
      if (referencesChildBacklink) {
        candidates.push({ assocName: name, parentDef });
        break;
      }
    }
  }

  if (candidates.length !== 1) {
    return null; // 0 or multiple → cannot decide unambiguously
  }
  return candidates[0];
}

/**
 * Rewrite a parsed where clause so that all path refs prefixed by `parentAssocName`
 * are re-rooted relative to the parent entity (drop the leading segment).
 *
 * Returns a deep-cloned CQN expression with the same shape but re-rooted refs.
 */
function rewriteWhereForParent(parsedWhere, parentAssocName) {
  if (!parsedWhere?.xpr) {
    return parsedWhere;
  }
  return { xpr: parsedWhere.xpr.map((token) => rewriteToken(token, parentAssocName)) };
}

function rewriteToken(token, parentAssocName) {
  if (token === null || typeof token !== "object") {
    return token;
  }
  if (Array.isArray(token.ref)) {
    const firstSegment = token.ref[0];
    if (typeof firstSegment === "string" && firstSegment === parentAssocName) {
      const remainder = token.ref.slice(1);
      if (remainder.length === 0) {
        return { ref: ["$self"] };
      }
      return { ...token, ref: remainder };
    }
    return token;
  }
  if (Array.isArray(token.xpr)) {
    return { ...token, xpr: token.xpr.map((t) => rewriteToken(t, parentAssocName)) };
  }
  if (Array.isArray(token.args)) {
    return { ...token, args: token.args.map((t) => rewriteToken(t, parentAssocName)) };
  }
  return token;
}

/**
 * Enhance the CSN model in-place:
 * - Add __fc_ virtual fields with metadata annotations on the element
 * - Add BetterAnnotationsConfig singleton per service; each field annotated with @BetterAnnotations.roles
 * - Set @UI.*Hidden, @Capabilities, @Core.OperationAvailable annotations
 *
 * All metadata needed at runtime is stored as CSN annotations. No side channels.
 */
function enhanceModel(model) {
  const serviceEntities = {};

  for (const [fqn, def] of Object.entries(model.definitions)) {
    if (def.kind !== "entity") {
      continue;
    }
    if (!def["@restrict"]) {
      continue;
    }
    if (!hasUIAnnotations(def)) {
      continue;
    }

    const svcName = serviceName(fqn);
    if (!svcName) {
      continue;
    }
    const svcDef = model.definitions[svcName];
    if (!svcDef || svcDef.kind !== "service") {
      continue;
    }

    if (!serviceEntities[svcName]) {
      serviceEntities[svcName] = [];
    }
    serviceEntities[svcName].push({ fqn, def, entityName: shortName(fqn) });
  }

  for (const [svcName, entities] of Object.entries(serviceEntities)) {
    const singletonFields = {}; // fieldName → roles[]

    for (const { fqn, def, entityName } of entities) {
      const isReadonly = def["@readonly"] === true;
      const analysis = analyzeRestrictions(def["@restrict"]);

      for (const op of OPERATIONS) {
        const uiAnno = UI_HIDDEN_MAP[op];
        const capAnno = CAPABILITIES_MAP[op];

        if (def[uiAnno] !== undefined) {
          log.debug(`Skipping ${uiAnno} for ${fqn} — already annotated`);
          continue;
        }

        if (isReadonly) {
          def[uiAnno] = true;
          def[capAnno] = false;
          log.debug(`${fqn}: ${op} static hidden (readonly)`);
          continue;
        }

        const strategy = determineStrategy(analysis[op]);

        switch (strategy.strategy) {
          case "static": {
            def[uiAnno] = true;
            def[capAnno] = false;
            log.debug(`${fqn}: ${op} static hidden (no grant)`);
            break;
          }

          case "none": {
            log.debug(`${fqn}: ${op} allowed for all — skipping`);
            break;
          }

          case "singleton": {
            const fieldName = `can${op.charAt(0)}${op.slice(1).toLowerCase()}_${entityName}`;
            singletonFields[fieldName] = strategy.roles;
            def[uiAnno] = { $edmJson: { $Not: { $Path: `/${SINGLETON_NAME}/${fieldName}` } } };
            def[capAnno] = { $edmJson: { $Path: `/${SINGLETON_NAME}/${fieldName}` } };
            log.debug(`${fqn}: ${op} singleton-based (roles: ${strategy.roles.join(", ")})`);
            break;
          }

          case "virtual": {
            if (op === "CREATE") {
              // CreateHidden cannot depend on properties of the row being created
              // (the row does not exist yet). Route it via the parent association
              // when one is present, otherwise fall back to a singleton with the
              // set of roles involved in the grants.
              const parent = findParentAssociation(fqn, def, model);
              if (parent) {
                const parentField = `__fc_canCreate_${entityName}`;
                const rewrittenGrants = strategy.conditionalGrants.map((grant) => ({
                  role: grant.role,
                  where: rewriteWhereForParent(grant.where, parent.assocName),
                }));
                addVirtualElement(parent.parentDef, parentField, strategy.unconditionalRoles, rewrittenGrants);
                def[uiAnno] = { xpr: ["not", { ref: [parent.assocName, parentField] }] };
                def[capAnno] = { "=": `${parent.assocName}.${parentField}` };
                log.debug(`${fqn}: CREATE via parent association ${parent.assocName}.${parentField}`);
              } else {
                // Root entity — fall back to a singleton over all involved roles.
                const roles = [
                  ...strategy.unconditionalRoles,
                  ...strategy.conditionalGrants.map((g) => g.role).filter(Boolean),
                ];
                const uniqueRoles = [...new Set(roles)];
                const fieldName = `can${op.charAt(0)}${op.slice(1).toLowerCase()}_${entityName}`;
                singletonFields[fieldName] = uniqueRoles;
                def[uiAnno] = { $edmJson: { $Not: { $Path: `/${SINGLETON_NAME}/${fieldName}` } } };
                def[capAnno] = { $edmJson: { $Path: `/${SINGLETON_NAME}/${fieldName}` } };
                log.debug(`${fqn}: CREATE root-entity singleton fallback (roles: ${uniqueRoles.join(", ")})`);
              }
              break;
            }

            const fcField = `__fc_can${op.charAt(0)}${op.slice(1).toLowerCase()}`;
            addVirtualElement(def, fcField, strategy.unconditionalRoles, strategy.conditionalGrants);
            def[uiAnno] = { xpr: ["not", { ref: [fcField] }] };
            def[capAnno] = { "=": fcField };
            log.debug(`${fqn}: ${op} virtual field ${fcField}`);
            break;
          }
        }
      }

      const knownActions = def.actions ? Object.keys(def.actions) : [];
      const actionRestrictions = analyzeActionRestrictions(def["@restrict"], knownActions);
      if (def.actions) {
        for (const [actionName, actionDef] of Object.entries(def.actions)) {
          if (actionDef["@Core.OperationAvailable"] !== undefined) {
            log.debug(`Skipping @Core.OperationAvailable for ${fqn}/${actionName} — already annotated`);
            continue;
          }

          const actionAnalysis = actionRestrictions[actionName];
          if (!actionAnalysis) {
            continue;
          }

          const strategy = determineStrategy(actionAnalysis);

          switch (strategy.strategy) {
            case "static": {
              actionDef["@Core.OperationAvailable"] = false;
              log.debug(`${fqn}/${actionName}: Core.OperationAvailable = false (no grant)`);
              break;
            }

            case "none": {
              log.debug(`${fqn}/${actionName}: Core.OperationAvailable — all allowed, skipping`);
              break;
            }

            case "singleton": {
              const fieldName = `can_${entityName}_${actionName}`;
              singletonFields[fieldName] = strategy.roles;
              actionDef["@Core.OperationAvailable"] = {
                $edmJson: { $Path: `/${SINGLETON_NAME}/${fieldName}` },
              };
              log.debug(
                `${fqn}/${actionName}: Core.OperationAvailable singleton (roles: ${strategy.roles.join(", ")})`,
              );
              break;
            }

            case "virtual": {
              const fcField = `__fc_can_${actionName}`;
              addVirtualElement(def, fcField, strategy.unconditionalRoles, strategy.conditionalGrants);
              actionDef["@Core.OperationAvailable"] = { "=": fcField };
              log.debug(`${fqn}/${actionName}: Core.OperationAvailable virtual ${fcField}`);
              break;
            }
          }
        }
      }
    }

    if (Object.keys(singletonFields).length) {
      const singletonFqn = `${svcName}.${SINGLETON_NAME}`;

      if (!model.definitions[singletonFqn]) {
        const elements = {
          ID: { type: "cds.String", key: true },
        };

        for (const [fieldName, roles] of Object.entries(singletonFields)) {
          elements[fieldName] = { type: "cds.Boolean", [ANNO_ROLES]: [...roles] };
        }

        model.definitions[singletonFqn] = {
          kind: "entity",
          "@odata.singleton": true,
          "@cds.persistence.skip": true,
          "@readonly": true,
          "@UI.Hidden": true,
          elements,
        };

        log.debug(`Generated ${singletonFqn} with fields: ${Object.keys(singletonFields).join(", ")}`);
      } else {
        const existing = model.definitions[singletonFqn];
        if (!existing.elements) {
          existing.elements = {};
        }
        for (const [fieldName, roles] of Object.entries(singletonFields)) {
          if (!existing.elements[fieldName]) {
            existing.elements[fieldName] = { type: "cds.Boolean", [ANNO_ROLES]: [...roles] };
          }
        }
        log.debug(`Extended existing ${singletonFqn} with fields: ${Object.keys(singletonFields).join(", ")}`);
      }
    }
  }
}

module.exports = {
  enhanceModel,
  SINGLETON_NAME,
  ANNO_ROLES,
  ANNO_UNCONDITIONAL,
  ANNO_CONDITIONAL,
  findParentAssociation,
  rewriteWhereForParent,
};
