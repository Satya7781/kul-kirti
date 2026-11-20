const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const registerVanshawaliRoutes = require("../lib/vanshawali-routes");
const { createRateLimiter, roleGuard } = require("../lib/http-security");

const GOTRA_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERS = [{
  clientId: "root-1", parentId: null, memberType: "root",
  name: "मूल पूर्वज", wifeName: "मूल माता", village: "गांव",
}];

const clean = (value, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";
const uuidOrNull = (value) => {
  const text = clean(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : null;
};
const msg = (_request, hi, _en) => hi;
const flat = sql => sql.replace(/\s+/g, " ").trim();

function makePool() {
  const trees = [];
  const requests = [];
  const logs = [];

  function seedTree(overrides = {}) {
    const tree = {
      id: `tree-${trees.length + 1}`,
      gotra_id: GOTRA_ID,
      tree_reference: `KK-TEST-${trees.length + 1}`,
      edit_token: `TOKEN${trees.length + 1}`,
      token_expires_at: new Date(Date.now() + 86_400_000),
      token_revoked_at: null,
      submitter_name: "योगदानकर्ता",
      submitter_contact: "contact@example.com",
      status: "draft",
      revision_number: 1,
      current_revision: [],
      village: "गांव", district: "", state: "राजस्थान",
      review_notes: null, submitted_at: null, verified_at: null,
      created_at: new Date(),
      ...overrides,
    };
    trees.push(tree);
    return tree;
  }

  const pool = {
    trees, requests, logs, seedTree,
    async query(text, params = []) {
      const sql = flat(text);
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT id FROM gotras WHERE id = $1")) {
        return { rows: params[0] === GOTRA_ID ? [{ id: GOTRA_ID }] : [], rowCount: params[0] === GOTRA_ID ? 1 : 0 };
      }
      if (sql.startsWith("INSERT INTO family_trees")) {
        const tree = seedTree({
          gotra_id: params[0], edit_token: params[1], token_expires_at: params[2],
          submitter_name: params[3], submitter_contact: params[4],
          village: params[5], district: params[6], state: params[7],
        });
        return {
          rowCount: 1,
          rows: [{
            id: tree.id, tree_reference: tree.tree_reference, edit_token: tree.edit_token,
            status: tree.status, revision_number: tree.revision_number, created_at: tree.created_at,
          }],
        };
      }
      if (sql.includes("FROM family_trees t JOIN gotras g") && sql.includes("t.edit_token = $1")) {
        const tree = trees.find(t => t.edit_token === params[0] && !t.token_revoked_at
          && (!t.token_expires_at || t.token_expires_at > new Date()));
        return {
          rowCount: tree ? 1 : 0,
          rows: tree ? [{ ...tree, gotra_name: "गेहलोत", gotra_status: "verified", gotra_is_active: true }] : [],
        };
      }
      if (sql.includes("FROM verification_records WHERE family_tree_id")) return { rows: [], rowCount: 0 };
      if (sql.startsWith("UPDATE family_trees")) {
        const id = params.find(p => String(p).startsWith("tree-"));
        const tree = trees.find(t => t.id === id);
        if (tree && sql.includes("edit_token = $2")) {
          tree.edit_token = params[1];
          tree.token_expires_at = params[2];
          tree.current_revision = JSON.parse(params[0]);
          tree.status = "pending";
          tree.revision_number += 1;
          tree.submitted_at = new Date();
        }
        if (tree && sql.includes("token_revoked_at = NOW()")) tree.token_revoked_at = new Date();
        if (tree && sql.includes("submitter_name =")) {
          tree.submitter_name = params[0];
          tree.submitter_contact = null;
          tree.current_revision = [];
          tree.status = "rejected";
          tree.deleted_at = new Date();
        }
        if (tree && sql.includes("delete_requested_at = NOW()")) tree.delete_requested_at = new Date();
        return {
          rowCount: tree ? 1 : 0,
          rows: tree ? [{
            tree_reference: tree.tree_reference, revision_number: tree.revision_number,
            edit_token: tree.edit_token,
          }] : [],
        };
      }
      if (sql.startsWith("INSERT INTO privacy_requests")) {
        const request = {
          id: `99999999-9999-4999-8999-${String(requests.length + 1).padStart(12, "0")}`,
          family_tree_id: params[0], request_type: "delete", details: params[1],
          status: "pending", created_at: new Date(),
        };
        requests.push(request);
        return { rows: [request], rowCount: 1 };
      }
      if (sql.includes("FROM privacy_requests p JOIN family_trees t")) {
        const rows = requests.filter(r => r.status === "pending").map(r => ({
          ...r, tree_reference: trees.find(t => t.id === r.family_tree_id)?.tree_reference,
          tree_status: trees.find(t => t.id === r.family_tree_id)?.status,
        }));
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("FROM privacy_requests p") && sql.includes("FOR UPDATE OF p")) {
        const request = requests.find(r => r.id === params[0]);
        return { rows: request ? [{ ...request, tree_status: "verified" }] : [], rowCount: request ? 1 : 0 };
      }
      if (sql.startsWith("UPDATE privacy_requests")) {
        const request = requests.find(r => r.id === params[0]);
        if (request) { request.status = "fulfilled"; request.fulfilled_at = new Date(); request.fulfilled_by = params[1]; }
        return { rows: [], rowCount: request ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO genealogy_audit")) {
        logs.push({ action: params[1], targetId: params[3], details: params[4] });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() { return { query: (...args) => pool.query(...args), release() {} }; },
  };
  return pool;
}

async function withServer(app, callback) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function makeApp(pool) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const auth = (request, _response, next) => {
    request.admin = { id: ADMIN_ID, role: "super_admin" };
    next();
  };
  registerVanshawaliRoutes(app, {
    pool, auth, requireRole: roleGuard, clean, uuidOrNull, msg,
    logAudit: async (client, adminId, action, entityType, targetId, details) =>
      client.query("INSERT INTO genealogy_audit (admin_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)",
        [adminId, action, entityType, targetId, details]),
    refreshTreeProjection: () => {},
    genealogy: { validateRelationship: async () => ({ valid: true }) },
    rateLimit: createRateLimiter().rateLimit,
  });
  return app;
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body, headers: response.headers };
}

test("tree creation requires consent and stores a token expiry", async () => {
  const pool = makePool();
  await withServer(makeApp(pool), async (base) => {
    const withoutConsent = await request(base, "/api/vanshawali/trees", {
      method: "POST",
      body: JSON.stringify({ gotraId: GOTRA_ID, submitterName: "योगदानकर्ता" }),
    });
    assert.equal(withoutConsent.status, 400);
    assert.equal(pool.trees.length, 0);

    const created = await request(base, "/api/vanshawali/trees", {
      method: "POST",
      body: JSON.stringify({ gotraId: GOTRA_ID, submitterName: "योगदानकर्ता", consent: true }),
    });
    assert.equal(created.status, 201);
    assert.equal(pool.trees.length, 1);
    assert.ok(pool.trees[0].token_expires_at > new Date());
    assert.match(created.headers.get("cache-control") || "", /no-store/);
  });
});

test("submitting rotates the edit token and invalidates the old link", async () => {
  const pool = makePool();
  const tree = pool.seedTree();
  const oldToken = tree.edit_token;
  await withServer(makeApp(pool), async (base) => {
    const submitted = await request(base, `/api/vanshawali/trees/${oldToken}/submit`, {
      method: "POST", body: JSON.stringify({ members: MEMBERS }),
    });
    assert.equal(submitted.status, 200);
    assert.ok(submitted.body.token);
    assert.notEqual(submitted.body.token, oldToken);
    assert.equal(tree.status, "pending");

    const oldLink = await request(base, `/api/vanshawali/trees/${oldToken}`);
    assert.equal(oldLink.status, 404);

    const newLink = await request(base, `/api/vanshawali/trees/${submitted.body.token}`);
    assert.equal(newLink.status, 200);
    assert.equal(newLink.body.tree.status, "pending");
  });
});

test("token holder can revoke the edit link", async () => {
  const pool = makePool();
  const tree = pool.seedTree();
  await withServer(makeApp(pool), async (base) => {
    const revoked = await request(base, `/api/vanshawali/trees/${tree.edit_token}/revoke`, { method: "POST" });
    assert.equal(revoked.status, 200);
    const lookup = await request(base, `/api/vanshawali/trees/${tree.edit_token}`);
    assert.equal(lookup.status, 404);
  });
});

test("draft deletion anonymises immediately while verified deletion is queued", async () => {
  const pool = makePool();
  const draft = pool.seedTree();
  const verified = pool.seedTree({ status: "verified", current_revision: MEMBERS });
  await withServer(makeApp(pool), async (base) => {
    const removed = await request(base, `/api/vanshawali/trees/${draft.edit_token}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.queued, false);
    assert.equal(draft.status, "rejected");
    assert.equal(draft.submitter_contact, null);
    assert.deepEqual(draft.current_revision, []);

    const queued = await request(base, `/api/vanshawali/trees/${verified.edit_token}`, { method: "DELETE" });
    assert.equal(queued.status, 200);
    assert.equal(queued.body.queued, true);
    assert.equal(verified.status, "verified");
    assert.equal(pool.requests.length, 1);
    assert.equal(pool.requests[0].request_type, "delete");
  });
});

test("admin privacy queue can list and fulfil requests", async () => {
  const pool = makePool();
  const verified = pool.seedTree({ status: "verified", current_revision: MEMBERS });
  await withServer(makeApp(pool), async (base) => {
    await request(base, `/api/vanshawali/trees/${verified.edit_token}`, { method: "DELETE" });
    const list = await request(base, "/api/admin/vanshawali/privacy-requests");
    assert.equal(list.status, 200);
    assert.equal(list.body.requests.length, 1);
    assert.equal(list.body.requests[0].tree_reference, verified.tree_reference);

    const fulfilled = await request(base, `/api/admin/vanshawali/privacy-requests/${pool.requests[0].id}/fulfil`, {
      method: "POST", body: JSON.stringify({}),
    });
    assert.equal(fulfilled.status, 200);
    assert.equal(pool.requests[0].status, "fulfilled");
    assert.equal(verified.submitter_contact, null);
    assert.equal(pool.logs.length, 1);

    const empty = await request(base, "/api/admin/vanshawali/privacy-requests");
    assert.equal(empty.body.requests.length, 0);
  });
});
