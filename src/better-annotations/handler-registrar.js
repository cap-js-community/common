"use strict";

const cds = require("@sap/cds");
const { SINGLETON_NAME, ANNO_ROLES, ANNO_UNCONDITIONAL, ANNO_CONDITIONAL } = require("./model-enhancer");

const log = cds.log("/cap-js-community-common/better-annotations");

function registerHandlers(service) {
  service.prepend(() => {
    const singletonEntity = service.entities?.[SINGLETON_NAME] || `${service.name}.${SINGLETON_NAME}`;
    service.on("READ", singletonEntity, (req) => {
      const entityDef = getModelDefinition(service, `${service.name}.${SINGLETON_NAME}`);
      const result = { ID: "singleton" };
      const elements = entityDef?.elements || {};
      for (const [fieldName, elementDef] of Object.entries(elements)) {
        const roles = elementDef?.[ANNO_ROLES];
        if (!Array.isArray(roles)) {
          continue;
        }
        result[fieldName] = roles.some((role) => req.user.is(role));
      }
      return result;
    });
  });
  log.debug(`Registered ${SINGLETON_NAME} handler for ${service.name}`);

  service.before("READ", (req) => {
    const targetDef = resolveTargetDef(service, req);
    if (!targetDef?.elements) {
      return;
    }

    const fieldDefs = collectVirtualFieldDefs(targetDef.elements);
    if (fieldDefs.length === 0) {
      return;
    }

    const select = req.query?.SELECT;
    if (!select) {
      return;
    }

    if (!select.columns) {
      select.columns = ["*"];
    }

    const requestedFields = requestedFieldNames(select.columns);
    const selectAll = requestedFields.has("*");
    const neededFields = selectAll ? fieldDefs : fieldDefs.filter(({ field }) => requestedFields.has(field));
    if (neededFields.length === 0) {
      return;
    }

    // Drop any bare refs for the virtual fields; keep '*' etc.
    select.columns = select.columns.filter((column) => {
      const ref = column?.ref?.[0];
      return !neededFields.some(({ field }) => ref === field);
    });

    for (const fieldDef of neededFields) {
      select.columns.push(buildCalcColumn(req, fieldDef));
    }
  });

  log.debug(`Registered __fc_ before READ handler for ${service.name}`);
}

function getModelDefinition(service, fqn) {
  const model = cds.context?.model || service.model || cds.model;
  return model?.definitions?.[fqn];
}

function resolveTargetDef(service, req) {
  const target = req.target;
  if (!target?.name) {
    return null;
  }

  if (target.elements) {
    return target;
  }

  const model = cds.context?.model || service.model || cds.model;
  const definitions = model?.definitions;
  if (!definitions) {
    return null;
  }

  const baseName = target.name.endsWith(".drafts") ? target.name.slice(0, -".drafts".length) : target.name;
  return definitions[target.name] || definitions[baseName] || null;
}

function collectVirtualFieldDefs(elements) {
  const defs = [];
  for (const [name, element] of Object.entries(elements)) {
    if (!element?.virtual) {
      continue;
    }
    const unconditionalRoles = element[ANNO_UNCONDITIONAL];
    const conditionalGrants = element[ANNO_CONDITIONAL];
    if (!Array.isArray(unconditionalRoles) && !Array.isArray(conditionalGrants)) {
      continue;
    }
    defs.push({
      field: name,
      unconditionalRoles: Array.isArray(unconditionalRoles) ? unconditionalRoles : [],
      conditionalGrants: Array.isArray(conditionalGrants) ? conditionalGrants : [],
    });
  }
  return defs;
}

function requestedFieldNames(columns) {
  const names = new Set();
  for (const column of columns) {
    if (column === "*") {
      names.add("*");
      continue;
    }
    const name = column?.ref?.[0] || column?.as;
    if (name) {
      names.add(name);
    }
  }
  return names;
}

function buildCalcColumn(req, fieldDef) {
  const { field } = fieldDef;
  const expression = buildAvailabilityExpression(req, fieldDef);

  if (expression.val !== undefined) {
    return { val: expression.val, as: field, cast: { type: "cds.Boolean" } };
  }

  return { xpr: expression.xpr, as: field, cast: { type: "cds.Boolean" } };
}

function buildAvailabilityExpression(req, fieldDef) {
  const { unconditionalRoles = [], conditionalGrants = [] } = fieldDef;

  if (unconditionalRoles.some((role) => role === "*" || req.user.is(role))) {
    return { val: true };
  }

  const expressions = [];
  for (const grant of conditionalGrants) {
    if (grant.role && !req.user.is(grant.role)) {
      continue;
    }

    const parsedWhere = grant.where;
    if (!parsedWhere || !parsedWhere.xpr) {
      // No usable expression: role matched (or grant with no role) but where was
      // absent or unparseable. Enable best-effort — backend @restrict remains authoritative.
      expressions.push({ val: true });
      continue;
    }

    const substituted = substituteUser(parsedWhere.xpr, req);
    expressions.push({ xpr: substituted });
  }

  return combineExpressions(expressions);
}

/**
 * Deep-clone a CQN xpr array while replacing every `{ref: ['$user', ...]}` node
 * with a literal `{val: ...}` sourced from `req.user`. All other structure
 * (refs, filters, exists, functions, nested xpr) is preserved as-is.
 */
function substituteUser(xprArray, req) {
  return xprArray.map((token) => substituteToken(token, req));
}

function substituteToken(token, req) {
  if (token === null || token === undefined) {
    return token;
  }
  if (typeof token !== "object") {
    return token;
  }

  if (Array.isArray(token.ref)) {
    if (token.ref[0] === "$user") {
      const attr = token.ref[1];
      if (!attr) {
        return { val: req.user.id ?? null };
      }
      if (attr === "id") {
        return { val: req.user.id ?? null };
      }
      const value = req.user.attr?.[attr];
      return { val: value === undefined ? null : value };
    }
    // Reference with infix filters (e.g. `members[userID = $user.id]`)
    const nextRef = token.ref.map((segment) => substituteRefSegment(segment, req));
    return { ...token, ref: nextRef };
  }

  if (Array.isArray(token.xpr)) {
    return { ...token, xpr: substituteUser(token.xpr, req) };
  }

  if (Array.isArray(token.args)) {
    return { ...token, args: substituteUser(token.args, req) };
  }

  return token;
}

function substituteRefSegment(segment, req) {
  if (typeof segment !== "object" || segment === null) {
    return segment;
  }
  if (Array.isArray(segment.where)) {
    return { ...segment, where: substituteUser(segment.where, req) };
  }
  return segment;
}

function combineExpressions(expressions) {
  if (expressions.some((expression) => expression.val === true)) {
    return { val: true };
  }

  const effectiveExpressions = expressions.filter((expression) => expression.val !== false);
  if (effectiveExpressions.length === 0) {
    return { val: false };
  }

  if (effectiveExpressions.length === 1) {
    return effectiveExpressions[0];
  }

  const xpr = [];
  for (const expression of effectiveExpressions) {
    if (xpr.length > 0) {
      xpr.push("or");
    }
    xpr.push({ xpr: expression.xpr });
  }
  return { xpr };
}

module.exports = {
  registerHandlers,
  buildAvailabilityExpression,
  substituteUser,
  requestedFieldNames,
};
