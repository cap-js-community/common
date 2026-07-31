"use strict";

const cds = require("@sap/cds");

const OPERATIONS = ["CREATE", "UPDATE", "DELETE"];

/**
 * Expand grant shorthand to individual operations.
 * '*' → CREATE, READ, UPDATE, DELETE
 * 'WRITE' → CREATE, UPDATE, DELETE
 */
function expandGrants(grants) {
  const expanded = new Set();
  const grantList = Array.isArray(grants) ? grants : [grants];
  for (const grant of grantList) {
    const upper = grant.toUpperCase();
    if (upper === "*") {
      expanded.add("CREATE");
      expanded.add("READ");
      expanded.add("UPDATE");
      expanded.add("DELETE");
    } else if (upper === "WRITE") {
      expanded.add("CREATE");
      expanded.add("UPDATE");
      expanded.add("DELETE");
    } else {
      expanded.add(upper);
    }
  }
  return expanded;
}

/**
 * Normalize a where clause into a CQN expression object of shape {xpr: [...]}.
 * Accepts either a CDS expression string or an already-parsed CQN expression.
 * Returns null when parsing fails or the input has no recognizable shape.
 */
function parseWhere(where) {
  if (!where) {
    return null;
  }

  // Already a CQN expression (as compiled from CDS `where: (expr)` syntax)
  if (typeof where === "object") {
    if (where.xpr) {
      return { xpr: where.xpr };
    }
    if (where.ref || where.val || where.func) {
      return { xpr: [where] };
    }
    return null;
  }

  if (typeof where !== "string") {
    return null;
  }

  try {
    const parsed = cds.parse.expr(where);
    if (!parsed) {
      return null;
    }
    if (parsed.xpr) {
      return { xpr: parsed.xpr };
    }
    if (parsed.ref || parsed.val || parsed.func) {
      return { xpr: [parsed] };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Analyze @restrict annotation array for an entity.
 *
 * Returns operation map:
 * {
 *   CREATE: {
 *     unconditionalRoles: ['Admin'],
 *     conditionalGrants: [{ role: 'Manager', where: <CQN xpr | null> }],
 *   },
 *   UPDATE: { ... },
 *   DELETE: { ... },
 * }
 *
 * `where` is normalized to a CQN expression `{xpr: [...]}` when parseable,
 * otherwise `null` (best-effort role fallback at request time).
 */
function analyzeRestrictions(restrictArray) {
  const result = {};
  for (const op of OPERATIONS) {
    result[op] = { unconditionalRoles: [], conditionalGrants: [] };
  }

  if (!Array.isArray(restrictArray)) {
    return result;
  }

  for (const entry of restrictArray) {
    const grants = expandGrants(entry.grant || []);
    const roles = Array.isArray(entry.to) ? entry.to : entry.to ? [entry.to] : [];
    const where = entry.where || null;
    const parsedWhere = where ? parseWhere(where) : null;

    for (const op of OPERATIONS) {
      if (!grants.has(op)) {
        continue;
      }
      if (where) {
        for (const role of roles) {
          result[op].conditionalGrants.push({ role, where: parsedWhere });
        }
        if (roles.length === 0) {
          result[op].conditionalGrants.push({ role: null, where: parsedWhere });
        }
      } else {
        for (const role of roles) {
          result[op].unconditionalRoles.push(role);
        }
        if (roles.length === 0) {
          result[op].unconditionalRoles.push("*");
        }
      }
    }
  }

  return result;
}

/**
 * Analyze actions within an entity's @restrict for Core.OperationAvailable.
 *
 * @param restrictArray @restrict array from entity
 * @param knownActions optional array of action names defined on the entity; ensures
 *        actions not mentioned in any grant entry still get analyzed (empty grants →
 *        static hidden unless wildcard '*' covers them).
 * Returns map of actionName → { unconditionalRoles, conditionalGrants }.
 */
function analyzeActionRestrictions(restrictArray, knownActions = []) {
  const actions = {};
  const wildcardRoles = []; // roles with grant: '*' (applies to all actions)

  if (!Array.isArray(restrictArray)) {
    return actions;
  }

  for (const entry of restrictArray) {
    const grants = Array.isArray(entry.grant) ? entry.grant : entry.grant ? [entry.grant] : [];
    const roles = Array.isArray(entry.to) ? entry.to : entry.to ? [entry.to] : [];
    const where = entry.where || null;
    const parsedWhere = where ? parseWhere(where) : null;

    for (const grant of grants) {
      const upper = grant.toUpperCase();

      if (upper === "*") {
        if (!where) {
          for (const role of roles) {
            wildcardRoles.push(role);
          }
          if (roles.length === 0) {
            wildcardRoles.push("*");
          }
        }
        continue;
      }

      if (["CREATE", "READ", "UPDATE", "DELETE", "WRITE"].includes(upper)) {
        continue;
      }

      if (!actions[grant]) {
        actions[grant] = { unconditionalRoles: [], conditionalGrants: [] };
      }

      if (where) {
        for (const role of roles) {
          actions[grant].conditionalGrants.push({ role, where: parsedWhere });
        }
        if (roles.length === 0) {
          actions[grant].conditionalGrants.push({ role: null, where: parsedWhere });
        }
      } else {
        for (const role of roles) {
          actions[grant].unconditionalRoles.push(role);
        }
        if (roles.length === 0) {
          actions[grant].unconditionalRoles.push("*");
        }
      }
    }
  }

  if (wildcardRoles.length > 0) {
    for (const actionAnalysis of Object.values(actions)) {
      for (const role of wildcardRoles) {
        if (!actionAnalysis.unconditionalRoles.includes(role)) {
          actionAnalysis.unconditionalRoles.push(role);
        }
      }
    }
  }

  for (const actionName of knownActions) {
    if (actions[actionName]) {
      continue;
    }
    actions[actionName] = {
      unconditionalRoles: [...wildcardRoles],
      conditionalGrants: [],
    };
  }

  return actions;
}

/**
 * Determine generation strategy for an operation.
 *
 * Returns:
 *   { strategy: 'static', hidden: true }               — no grant at all
 *   { strategy: 'none' }                               — everyone can do it
 *   { strategy: 'singleton', roles: [...] }            — pure role check via singleton
 *   { strategy: 'virtual', unconditionalRoles, conditionalGrants }
 *                                                      — needs __fc_ field (per-instance)
 */
function determineStrategy(opAnalysis) {
  const { unconditionalRoles, conditionalGrants } = opAnalysis;

  if (unconditionalRoles.length === 0 && conditionalGrants.length === 0) {
    return { strategy: "static", hidden: true };
  }

  if (unconditionalRoles.includes("*")) {
    return { strategy: "none" };
  }

  if (conditionalGrants.length > 0) {
    const allRoles = [...unconditionalRoles, ...conditionalGrants.map((g) => g.role).filter(Boolean)];
    const uniqueRoles = [...new Set(allRoles)];
    return {
      strategy: "virtual",
      roles: uniqueRoles,
      unconditionalRoles,
      conditionalGrants,
    };
  }

  return { strategy: "singleton", roles: [...new Set(unconditionalRoles)] };
}

module.exports = {
  OPERATIONS,
  analyzeRestrictions,
  analyzeActionRestrictions,
  determineStrategy,
  parseWhere,
  expandGrants,
};
