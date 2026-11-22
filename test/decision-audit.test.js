const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const registerVanshawaliRoutes = require("../lib/vanshawali-routes");

const TREE_ID = "22bebf4e-c63a-4af8-a5e4-45f74f87a699";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const GOTRA_ID = "11111111-1111-4111-8111-111111111111";

const tree = {
  id: TREE_ID,
  gotra_id: GOTRA_ID,
  tree_reference: "KK-AUDIT",
  status: "pending",
  revision_number: 1,
  current_revision: [
    { clientId: "r", parentId: null, memberType: "root", name: "मूल पूर्वज", wifeName: "माता", village: "गांव", birthOrder: 0 },
    { clientId: "s", parentId: "r", memberType: "son", name: "पुत्र", wifeName: "पत्नी", village: "गांव", birthOrder: 0 },
  ],
};

const clean = (value, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const uuidOrNull = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "")) ? String(value) : null;

function makeClient(queries, relationshipShouldFail) {
  return {
    async query(sql, params) {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      queries.push(flat);
      /* Mirror pg's bind check so a placeholder/argument mismatch fails the
         test exactly as it fails production (SQLSTATE 08P01). */
      const placeholders = [...flat.matchAll(/\$(\d+)/g)].map(match => Number(match[1]));
      const expected = placeholders.length ? Math.max(...placeholders) : 0;
      if (expected && params && params.length !== expected) {
        throw Object.assign(new Error(
          `bind message supplies ${params.length} parameters, but prepared statement requires ${expected}`
        ), { code: "08P01" });
      }
      if (relationshipShouldFail && /^INSERT INTO person_relationships/i.test(flat)) {
        throw Object.assign(new Error("relationship would create a circular genealogy"), { code: "P0001" });
      }
      if (/SELECT \* FROM family_trees WHERE id = \$1 FOR UPDATE/i.test(flat)) return { rows: [tree] };
      if (/INSERT INTO people/i.test(flat)) return { rows: [{ id: `aaaaaaaa-0000-4000-8000-${String(queries.length).padStart(12, "0")}`, public_id: "PUB" }] };
      if (/SELECT id FROM people WHERE id IN/i.test(flat)) return { rows: [{ id: params[0] }, { id: params[1] }] };
      if (/SELECT COUNT\(\*\)::int AS count FROM person_relationships/i.test(flat)) return { rows: [{ count: 0 }] };
      return { rows: [] };
    },
    release() {},
  };
}

function makeContext(queries, auditShouldFail, relationshipShouldFail) {
  const pool = {
    async query(sql, params) { return makeClient(queries, relationshipShouldFail).query(sql, params); },
    async connect() { return makeClient(queries, relationshipShouldFail); },
  };
  return {
    pool,
    auth: (request, _response, next) => {
      request.admin = { id: ADMIN_ID, role: "admin" };
      next();
    },
    requireRole: () => (_request, _response, next) => next(),
    clean,
    uuidOrNull,
    msg: (_request, hi) => hi,
    logAudit: async () => {
      if (auditShouldFail) throw Object.assign(new Error("audit table unavailable"), { code: "42P01" });
    },
    refreshTreeProjection: async () => {},
    genealogy: {
      async validateRelationship() { return { valid: true, error: null }; },
    },
    rateLimit: () => (_request, _response, next) => next(),
  };
}

function postDecision(ctx, body = { decision: "approve", notes: "" }) {
  const app = express();
  app.use(express.json());
  registerVanshawaliRoutes(app, ctx);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, async () => {
      try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/admin/vanshawali/trees/${TREE_ID}/decision`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        resolve({ status: response.status, body: await response.json() });
      } catch (error) {
        reject(error);
      } finally {
        server.close();
      }
    });
  });
}

test("audit failures inside the decision transaction do not block approval", async () => {
  const queries = [];
  const previousError = console.error;
  console.error = () => {};
  try {
    const result = await postDecision(makeContext(queries, true));
    assert.equal(result.status, 200);
    assert.equal(result.body.status, "verified");
    assert.ok(queries.some(q => q === "SAVEPOINT kk_audit_write"));
    assert.ok(queries.some(q => q === "ROLLBACK TO SAVEPOINT kk_audit_write"));
    assert.ok(queries.some(q => q === "COMMIT"));
  } finally {
    console.error = previousError;
  }
});

test("a database integrity-trigger rejection skips the edge but still approves", async () => {
  const queries = [];
  const previousError = console.error;
  console.error = () => {};
  try {
    const result = await postDecision(makeContext(queries, false, true));
    assert.equal(result.status, 200);
    assert.equal(result.body.status, "verified");
    assert.equal(result.body.skipped.length, 1);
    assert.match(result.body.skipped[0].reason, /relationship_rejected/);
    assert.ok(queries.some(q => q === "ROLLBACK TO SAVEPOINT kk_relationship_write"));
    assert.ok(queries.some(q => q === "COMMIT"));
  } finally {
    console.error = previousError;
  }
});

test("a healthy audit still commits and materialises the tree", async () => {
  const queries = [];
  const result = await postDecision(makeContext(queries, false));
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "verified");
  assert.equal(queries.filter(q => q === "RELEASE SAVEPOINT kk_audit_write").length, 2);
  assert.ok(!queries.includes("ROLLBACK TO SAVEPOINT kk_audit_write"));
});
