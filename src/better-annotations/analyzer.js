"use strict";

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
 * Parse a where clause string into a simplified evaluator descriptor.
 * Returns { type, field, userAttr } or null if unsupported.
 *
 * Supported patterns:
 *   - "$user.id = <field>" / "<field> = $user.id" / "<field> = $user"
 *   - "$user.<attr> = <field>" / "<field> = $user.<attr>"
 */
function parseWhere(where) {
  if (!where || typeof where !== "string") {
    return null;
  }

  const cleaned = where.trim().replace(/[()]/g, "");

  // Pattern: <field> = $user[.attr]  OR  $user[.attr] = <field>
  const match = cleaned.match(/^(\$user(?:\.\w+)?)\s*=\s*(\w+(?:\.\w+)*)$|^(\w+(?:\.\w+)*)\s*=\s*(\$user(?:\.\w+)?)$/);
  if (!match) {
    return null;
  }

  let userRef, fieldRef;
  if (match[1]) {
    userRef = match[1];
    fieldRef = match[2];
  } else {
    fieldRef = match[3];
    userRef = match[4];
  }

  // Parse user attribute: $user → 'id', $user.id → 'id', $user.email → 'email'
  const userParts = userRef.split(".");
  const userAttr = userParts.length > 1 ? userParts[1] : "id";

  return { type: "user-field", field: fieldRef, userAttr };
}

/**
 * Analyze @restrict annotation array for an entity.
 *
 * Returns operation map:
 * {
 *   CREATE: { unconditionalRoles: ['Admin'], conditionalGrants: [{ role: 'Manager', where: '...' }] },
 *   UPDATE: { ... },
 *   DELETE: { ... }
 * }
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

    for (const op of OPERATIONS) {
      if (!grants.has(op)) {
        continue;
      }

      if (where) {
        for (const role of roles) {
          result[op].conditionalGrants.push({ role, where: typeof where === "string" ? where : null });
        }
        // If no roles specified, it's any authenticated user with condition
        if (roles.length === 0) {
          result[op].conditionalGrants.push({ role: null, where: typeof where === "string" ? where : null });
        }
      } else {
        for (const role of roles) {
          result[op].unconditionalRoles.push(role);
        }
        // If no roles specified, everyone can do it unconditionally
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
 * Returns map of actionName → { unconditionalRoles, conditionalGrants }
 */
function analyzeActionRestrictions(restrictArray, knownActions = []) {
  const actions = {};
  const wildcardRoles = []; // roles with grant: '*' (applies to all actions)

  if (!Array.isArray(restrictArray)) {
    return actions;
  }

  // First pass: collect wildcard roles and action-specific grants
  for (const entry of restrictArray) {
    const grants = Array.isArray(entry.grant) ? entry.grant : entry.grant ? [entry.grant] : [];
    const roles = Array.isArray(entry.to) ? entry.to : entry.to ? [entry.to] : [];
    const where = entry.where || null;

    for (const grant of grants) {
      const upper = grant.toUpperCase();

      // Wildcard grants apply to all actions
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

      // Skip standard CRUD/WRITE
      if (["CREATE", "READ", "UPDATE", "DELETE", "WRITE"].includes(upper)) {
        continue;
      }

      // This is a custom action name
      if (!actions[grant]) {
        actions[grant] = { unconditionalRoles: [], conditionalGrants: [] };
      }

      if (where) {
        for (const role of roles) {
          actions[grant].conditionalGrants.push({ role, where: typeof where === "string" ? where : null });
        }
        if (roles.length === 0) {
          actions[grant].conditionalGrants.push({ role: null, where: typeof where === "string" ? where : null });
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

  // Second pass: apply wildcard roles to all discovered actions
  if (wildcardRoles.length > 0) {
    for (const actionAnalysis of Object.values(actions)) {
      for (const role of wildcardRoles) {
        if (!actionAnalysis.unconditionalRoles.includes(role)) {
          actionAnalysis.unconditionalRoles.push(role);
        }
      }
    }
  }

  // Third pass: seed empty entries for known actions not mentioned anywhere.
  // Ensures undiscovered actions are analyzed as "no grant" (→ static hidden)
  // and receive wildcard grants when applicable.
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
 *   { strategy: 'static', hidden: true }           — no grant at all
 *   { strategy: 'none' }                           — everyone can do it
 *   { strategy: 'singleton', roles: [...] }        — pure role check via singleton
 *   { strategy: 'virtual', roles: [...], wheres: [...] } — needs __fc_ field
 */
function determineStrategy(opAnalysis) {
  const { unconditionalRoles, conditionalGrants } = opAnalysis;

  // No grants at all → hidden
  if (unconditionalRoles.length === 0 && conditionalGrants.length === 0) {
    return { strategy: "static", hidden: true };
  }

  // Everyone can do it (wildcard role or no role restriction)
  if (unconditionalRoles.includes("*")) {
    return { strategy: "none" };
  }

  // Has where clauses → virtual field (combines role check + where evaluation)
  if (conditionalGrants.length > 0) {
    const allRoles = [...unconditionalRoles, ...conditionalGrants.map((g) => g.role).filter(Boolean)];
    const uniqueRoles = [...new Set(allRoles)];
    const wheres = conditionalGrants
      .map((g) => ({ role: g.role, parsed: parseWhere(g.where) }))
      .filter((w) => w.parsed !== null);

    return {
      strategy: "virtual",
      roles: uniqueRoles,
      unconditionalRoles,
      conditionalGrants,
      wheres,
    };
  }

  // Pure role-based (no where) → singleton
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
