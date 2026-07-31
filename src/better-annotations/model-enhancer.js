"use strict";

const cds = require("@sap/cds");

const { OPERATIONS, analyzeRestrictions, analyzeActionRestrictions, determineStrategy } = require("./analyzer");

const COMPONENT = "/cap-js-community-common/better-annotations";
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

/**
 * Check if entity has at least one @UI annotation.
 */
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

  // For projection entities, also add to projection.columns
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

/**
 * Get short entity name from fully qualified name.
 * e.g., "MyService.Orders" → "Orders"
 */
function shortName(fqn) {
  const parts = fqn.split(".");
  return parts[parts.length - 1];
}

/**
 * Determine service name from entity FQN.
 * e.g., "MyService.Orders" → "MyService"
 */
function serviceName(fqn) {
  const idx = fqn.lastIndexOf(".");
  return idx > 0 ? fqn.substring(0, idx) : null;
}

/**
 * Enhance the CSN model in-place:
 * - Add __fc_ virtual fields with metadata annotations on the element
 * - Add BetterAnnotationsConfig singleton per service; each field annotated with @fc.ba.roles
 * - Set @UI.*Hidden, @Capabilities, @Core.OperationAvailable annotations
 *
 * All metadata needed at runtime is stored as CSN annotations. No side channels.
 */
function enhanceModel(model) {
  const log = cds.log(COMPONENT);

  // Collect qualifying entities grouped by service
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

    // Check service exists
    const svcDef = model.definitions[svcName];
    if (!svcDef || svcDef.kind !== "service") {
      continue;
    }

    if (!serviceEntities[svcName]) {
      serviceEntities[svcName] = [];
    }
    serviceEntities[svcName].push({ fqn, def, entityName: shortName(fqn) });
  }

  // Process each service
  for (const [svcName, entities] of Object.entries(serviceEntities)) {
    const singletonFields = {}; // fieldName → roles[]
    let needsSingleton = false;

    for (const { fqn, def, entityName } of entities) {
      const isReadonly = def["@readonly"] === true;
      const analysis = analyzeRestrictions(def["@restrict"]);

      // Process CRUD operations
      for (const op of OPERATIONS) {
        const uiAnno = UI_HIDDEN_MAP[op];
        const capAnno = CAPABILITIES_MAP[op];

        // Skip if already annotated
        if (def[uiAnno] !== undefined) {
          log.debug(`Skipping ${uiAnno} for ${fqn} — already annotated`);
          continue;
        }

        // @readonly → static hidden for CREATE/UPDATE/DELETE
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
            // Everyone can do it — no annotation needed
            log.debug(`${fqn}: ${op} allowed for all — skipping`);
            break;
          }

          case "singleton": {
            const fieldName = `can${op.charAt(0)}${op.slice(1).toLowerCase()}_${entityName}`;
            singletonFields[fieldName] = strategy.roles;
            needsSingleton = true;

            def[uiAnno] = { $edmJson: { $Not: { $Path: `/${SINGLETON_NAME}/${fieldName}` } } };
            def[capAnno] = { $edmJson: { $Path: `/${SINGLETON_NAME}/${fieldName}` } };
            log.debug(`${fqn}: ${op} singleton-based (roles: ${strategy.roles.join(", ")})`);
            break;
          }

          case "virtual": {
            const fcField = `__fc_can${op.charAt(0)}${op.slice(1).toLowerCase()}`;
            addVirtualElement(def, fcField, strategy.unconditionalRoles, strategy.conditionalGrants);
            def[uiAnno] = { xpr: ["not", { ref: [fcField] }] };
            def[capAnno] = { "=": fcField };
            log.debug(`${fqn}: ${op} virtual field ${fcField}`);
            break;
          }
        }
      }

      // Process action restrictions → @Core.OperationAvailable
      const knownActions = def.actions ? Object.keys(def.actions) : [];
      const actionRestrictions = analyzeActionRestrictions(def["@restrict"], knownActions);
      if (def.actions) {
        for (const [actionName, actionDef] of Object.entries(def.actions)) {
          // Skip if already annotated
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
              needsSingleton = true;

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
              actionDef["@Core.OperationAvailable"] = { "=": `$self.${fcField}` };
              log.debug(`${fqn}/${actionName}: Core.OperationAvailable virtual ${fcField}`);
              break;
            }
          }
        }
      }
    }

    // Generate BetterAnnotationsConfig singleton if needed
    if (needsSingleton) {
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
        // Singleton already exists — add our fields with role annotations
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
};
