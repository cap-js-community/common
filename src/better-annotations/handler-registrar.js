"use strict";

const cds = require("@sap/cds");
const { parseWhere } = require("./analyzer");
const { SINGLETON_NAME } = require("./model-enhancer");

const COMPONENT = "/cap-js-community-common/better-annotations";

function registerHandlers(service) {
  const log = cds.log(COMPONENT);

  service.prepend(() => {
    const singletonEntity = service.entities?.[SINGLETON_NAME] || `${service.name}.${SINGLETON_NAME}`;
    service.on("READ", singletonEntity, (req) => {
      const { singletonFields } = getServiceMetadata(service);
      const result = { ID: "singleton" };
      for (const [field, roles] of Object.entries(singletonFields)) {
        result[field] = roles.some((role) => req.user.is(role));
      }
      return result;
    });
  });
  log.debug(`Registered ${SINGLETON_NAME} handler for ${service.name}`);

  service.before("READ", (req) => {
    const { virtualFields } = getServiceMetadata(service);
    const fieldDefs = getVirtualFieldDefs(req, service, virtualFields);
    if (!fieldDefs?.length) {
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

    // Replace virtual refs with calculated columns. For '*' append calculated columns.
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

function getServiceMetadata(service) {
  const model = cds.context?.model || service.model || cds.model;
  const metadata = model?.$betterAnnotations || cds.betterAnnotations;
  return metadata?.services?.[service.name] || { singletonFields: {}, virtualFields: {} };
}

function getVirtualFieldDefs(req, service, virtualFields) {
  const targetName = req.target?.name;
  if (!targetName) {
    return null;
  }

  const shortName = targetName.split(".").pop();
  const baseTargetName = targetName.endsWith(".drafts") ? targetName.slice(0, -".drafts".length) : targetName;
  const baseShortName = baseTargetName.split(".").pop();

  return (
    virtualFields[targetName] ||
    virtualFields[baseTargetName] ||
    virtualFields[`${service.name}.${shortName}`] ||
    virtualFields[`${service.name}.${baseShortName}`]
  );
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

    const parsed = parseWhere(grant.where);
    if (!parsed) {
      // Best effort: role matched, but where clause cannot be translated to CQL.
      expressions.push({ val: true });
      continue;
    }

    const cqlExpression = buildCqlExpression(parsed, req);
    if (cqlExpression) {
      expressions.push(cqlExpression);
    }
  }

  return combineExpressions(expressions);
}

function buildCqlExpression(parsed, req) {
  if (parsed.type !== "user-field") {
    return null;
  }

  const userValue = parsed.userAttr === "id" ? req.user.id : req.user.attr?.[parsed.userAttr];
  if (userValue === undefined) {
    return null;
  }

  return { xpr: [{ ref: parsed.field.split(".") }, "=", { val: userValue }] };
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
  buildCqlExpression,
  requestedFieldNames,
};
