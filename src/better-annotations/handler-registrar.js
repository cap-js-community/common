"use strict";

const cds = require("@sap/cds");
const { parseWhere } = require("./analyzer");
const { SINGLETON_NAME } = require("./model-enhancer");

const COMPONENT = "/cap-js-community-common/better-annotations";

/**
 * Check if a field path requires association traversal.
 * Returns { associationName, targetField } or null if it's a local field.
 */
function analyzeFieldPath(field, entityDef) {
  const parts = field.split(".");
  if (parts.length < 2) {return null;}

  // Check if first segment is an association/composition on the entity
  const firstPart = parts[0];
  const element = entityDef?.elements?.[firstPart];
  if (element && (element.type === "cds.Association" || element.target || element._target)) {
    return {
      associationName: firstPart,
      targetField: parts.slice(1).join("."),
      foreignKey: `${firstPart}_ID`, // managed association FK pattern
    };
  }

  return null;
}

/**
 * Build an evaluator function from a where-clause descriptor.
 * Returns (item, req, parentData) => boolean
 * parentData is an optional map: { associationName: { field: value } }
 */
function buildEvaluator(parsed, assocInfo) {
  if (!parsed) {return () => true;}

  switch (parsed.type) {
    case "user-field": {
      const { field, userAttr } = parsed;

      // If field traverses an association, use parentData
      if (assocInfo) {
        return (item, req, parentData) => {
          const parentRecord = parentData?.[assocInfo.associationName];
          if (!parentRecord) {return false;}
          // Get the target field from parent
          const targetParts = assocInfo.targetField.split(".");
          let value = parentRecord;
          for (const part of targetParts) {
            if (value == null) {return false;}
            value = value[part];
          }
          const userValue = userAttr === "id" ? req.user.id : req.user.attr?.[userAttr];
          return value === userValue;
        };
      }

      // Local field path
      const fieldParts = field.split(".");
      return (item, req) => {
        let value = item;
        for (const part of fieldParts) {
          if (value == null) {return false;}
          value = value[part];
        }
        const userValue = userAttr === "id" ? req.user.id : req.user.attr?.[userAttr];
        return value === userValue;
      };
    }
    default:
      return () => true;
  }
}

/**
 * Register handlers for a service:
 * - BetterAnnotationsConfig singleton READ handler
 * - after('READ') handlers for __fc_ virtual field computation
 */
function registerHandlers(service, svcMeta) {
  const log = cds.log(COMPONENT);
  const { singletonFields, virtualFields } = svcMeta;

  // Register singleton READ handler
  if (Object.keys(singletonFields).length > 0) {
    service.prepend(() => {
      service.on("READ", SINGLETON_NAME, (req) => {
        const result = { ID: "singleton" };
        for (const [field, roles] of Object.entries(singletonFields)) {
          result[field] = roles.some((role) => req.user.is(role));
        }
        req.reply(result);
      });
    });
    log.debug(`Registered ${SINGLETON_NAME} handler for ${service.name}`);
  }

  // Register virtual field handlers
  for (const [entityFqn, fields] of Object.entries(virtualFields)) {
    const entityName = entityFqn.split(".").pop();
    const entity = service.entities?.[entityName];
    if (!entity) {
      log.warn(`Entity ${entityName} not found in service ${service.name} for virtual field registration`);
      continue;
    }

    // Pre-build evaluators for each field
    const fieldEvaluators = fields.map((fieldDef) => {
      const { field, unconditionalRoles, conditionalGrants } = fieldDef;

      // Build conditional evaluators from parsed where clauses
      const conditionalEvaluators = conditionalGrants.map((grant) => {
        const parsed = parseWhere(grant.where);
        const assocInfo = parsed ? analyzeFieldPath(parsed.field, entity) : null;
        return {
          role: grant.role,
          evaluator: buildEvaluator(parsed, assocInfo),
          supported: parsed !== null,
          assocInfo,
        };
      });

      // Determine if any evaluator needs parent data
      const needsParentData = conditionalEvaluators.some((e) => e.assocInfo !== null);

      return { field, unconditionalRoles, conditionalEvaluators, needsParentData };
    });

    // Check if any field needs association data
    const anyNeedsParent = fieldEvaluators.some((fe) => fe.needsParentData);

    service.after("READ", entityName, async (data, req) => {
      const items = Array.isArray(data) ? data : data ? [data] : [];
      if (items.length === 0) {return;}

      // Resolve parent data if needed (batch read parent entities)
      let parentDataMap = null;
      if (anyNeedsParent) {
        parentDataMap = await resolveParentData(items, fieldEvaluators, entity, service);
      }

      for (const item of items) {
        if (!item) {continue;}
        for (const { field, unconditionalRoles, conditionalEvaluators, needsParentData } of fieldEvaluators) {
          // Check unconditional roles first
          if (unconditionalRoles.length > 0 && unconditionalRoles.some((r) => req.user.is(r))) {
            item[field] = true;
            continue;
          }

          // Check conditional grants (role + where)
          let allowed = false;
          const itemParentData = needsParentData ? parentDataMap?.get(item) : null;
          for (const { role, evaluator, supported } of conditionalEvaluators) {
            if (!supported) {
              // Unsupported where clause — grant if role matches (best effort)
              if (!role || req.user.is(role)) {
                allowed = true;
                break;
              }
              continue;
            }
            const roleOk = !role || req.user.is(role);
            if (roleOk && evaluator(item, req, itemParentData)) {
              allowed = true;
              break;
            }
          }
          item[field] = allowed;
        }
      }
    });

    log.debug(`Registered __fc_ handlers for ${entityName} in ${service.name} (${fields.length} fields)`);
  }
}

/**
 * Resolve parent data for items that need association traversal.
 * Returns a Map<item, { associationName: parentRecord }>
 */
async function resolveParentData(items, fieldEvaluators, entity, service) {
  const parentDataMap = new Map();

  // Collect unique association reads needed
  const assocReads = new Map(); // associationName → { targetEntity, foreignKey, ids: Set }

  for (const fe of fieldEvaluators) {
    for (const { assocInfo } of fe.conditionalEvaluators) {
      if (!assocInfo) {continue;}
      const { associationName, targetField, foreignKey } = assocInfo;
      if (!assocReads.has(associationName)) {
        // Resolve target entity from association definition
        const assocDef = entity.elements?.[associationName];
        const targetName = assocDef?.target || assocDef?._target?.name;
        assocReads.set(associationName, {
          targetName,
          foreignKey,
          targetField,
          ids: new Set(),
        });
      }
      // Collect all FK values from items
      const readInfo = assocReads.get(associationName);
      for (const item of items) {
        const fkValue = item[readInfo.foreignKey];
        if (fkValue) {readInfo.ids.add(fkValue);}
      }
    }
  }

  // Batch-read parent entities
  for (const [associationName, readInfo] of assocReads.entries()) {
    if (readInfo.ids.size === 0 || !readInfo.targetName) {continue;}

    try {
      const targetEntity = service.entities?.[readInfo.targetName.split(".").pop()];
      if (!targetEntity) {continue;}

      const ids = [...readInfo.ids];
      const parentRecords = await cds.run(
        SELECT.from(targetEntity)
          .columns("ID", readInfo.targetField)
          .where({ ID: { in: ids } }),
      );

      // Build lookup: parentID → record
      const parentLookup = new Map();
      for (const rec of parentRecords) {
        parentLookup.set(rec.ID, rec);
      }

      // Map items to their parent data
      for (const item of items) {
        const fkValue = item[readInfo.foreignKey];
        if (!fkValue) {continue;}
        const parentRecord = parentLookup.get(fkValue);
        if (!parentRecord) {continue;}

        if (!parentDataMap.has(item)) {parentDataMap.set(item, {});}
        parentDataMap.get(item)[associationName] = parentRecord;
      }
    } catch (err) {
      cds.log(COMPONENT).warn(`Failed to resolve parent data for ${associationName}:`, err.message);
    }
  }

  return parentDataMap;
}

module.exports = { registerHandlers, buildEvaluator, analyzeFieldPath };
