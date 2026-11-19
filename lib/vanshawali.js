/**
 * vanshawali.js
 * -------------
 * Pure helpers for the Gotra-first Vanshawali system. Kept free of database
 * and Express dependencies so they can be unit-tested with node:test.
 */
"use strict";

const MAX_MEMBERS = 2000;
const MEMBER_TYPES = ["root", "son", "daughter"];

function text(value, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Normalised Gotra name: case/punctuation/whitespace insensitive, Devanagari aware. */
function normalizeName(value) {
  return text(value, 200)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Validate one unordered member array.
 *
 * Business rules enforced here (and therefore also on the API):
 *  - exactly one root; the root has no parent;
 *  - every other member names a parent that exists in the same submission;
 *  - a daughter records her name ONLY - no wife/village and no children;
 *  - root/son require name, wife's name and village (as the form specifies);
 *  - the parent graph is acyclic and every member is reachable from the root;
 *  - no artificial generation limit (depth is not capped).
 *
 * Returns { valid, error, members }. `members` contains resolved UUID ids so
 * the two-pass database insert can connect children regardless of entry order.
 */
function validateTreeMembers(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_MEMBERS) : [];
  if (!list.length) return { valid: false, error: "empty_tree", members: [] };
  if (raw.length > MAX_MEMBERS) return { valid: false, error: "too_many_members", members: [] };

  const members = list.map((item, index) => {
    const clientId = text(item.clientId || item.id, 80) || `member-${index + 1}`;
    return {
      clientId,
      name: text(item.name, 120),
      wifeName: text(item.wifeName, 120),
      village: text(item.village, 120),
      memberType: MEMBER_TYPES.includes(item.memberType) ? item.memberType : "son",
      parentId: item.parentId ? text(item.parentId, 80) : null,
      birthOrder: Number.isFinite(Number(item.birthOrder)) ? Number(item.birthOrder) : index,
      index,
    };
  });

  const byId = new Map(members.map(m => [m.clientId, m]));
  if (byId.size !== members.length) return { valid: false, error: "duplicate_member_id", members: [] };

  const roots = members.filter(m => m.memberType === "root");
  if (roots.length !== 1) return { valid: false, error: roots.length ? "multiple_roots" : "missing_root", members: [] };
  if (roots[0].parentId) return { valid: false, error: "root_has_parent", members: [] };

  for (const m of members) {
    if (!m.name) return { valid: false, error: "missing_name", members: [] };
    if (m.memberType === "daughter") {
      if (m.wifeName || m.village) return { valid: false, error: "daughter_extra_fields", members: [] };
    } else if (!m.wifeName || !m.village) {
      return { valid: false, error: "missing_wife_or_village", members: [] };
    }
    if (m.memberType !== "root") {
      if (!m.parentId || !byId.has(m.parentId)) return { valid: false, error: "invalid_parent", members: [] };
      if (byId.get(m.parentId).memberType === "daughter") {
        return { valid: false, error: "daughter_has_descendant", members: [] };
      }
      if (m.parentId === m.clientId) return { valid: false, error: "self_parenting", members: [] };
    }
  }

  // A member's only allowed parent chain must terminate at the root.
  for (const m of members) {
    const seen = new Set();
    let cursor = m;
    while (cursor.parentId) {
      if (seen.has(cursor.clientId)) return { valid: false, error: "circular_genealogy", members: [] };
      seen.add(cursor.clientId);
      cursor = byId.get(cursor.parentId);
      if (!cursor) return { valid: false, error: "invalid_parent", members: [] };
    }
    if (cursor.clientId !== roots[0].clientId) {
      return { valid: false, error: "unreachable_member", members: [] };
    }
  }

  return { valid: true, error: null, members };
}

/** Only the root and sons may expose descendant controls / wife + village. */
function canHaveChildren(memberType) {
  return memberType === "root" || memberType === "son";
}

module.exports = { MAX_MEMBERS, MEMBER_TYPES, normalizeName, validateTreeMembers, canHaveChildren, text };
