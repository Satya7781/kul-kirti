const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const http = require("node:http");
const path = require("path");
const express = require("express");
const { roleGuard } = require("../lib/http-security");
const { sendExport } = require("../lib/admin-exports");
const registerAdminConsoleRoutes = require("../lib/admin-console-routes");
const { MODULES, clean, uuidOrNull } = require("../lib/admin-console-core");

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GOTRA_A = "11111111-1111-4111-8111-111111111111";
const GOTRA_B = "22222222-2222-4222-8222-222222222222";
const PERSON_A = "33333333-3333-4333-8333-333333333333";
const PERSON_B = "44444444-4444-4444-8444-444444444444";

const flat = sql => sql.replace(/\s+/g, " ").trim();
const lower = value => String(value || "").trim().toLowerCase();

function makePool() {
  const permissions = MODULES.flatMap(module => ["view", "edit", "approve"].map(action => ({
    module: module.id,
    action,
    key: `${module.id}:${action}`,
    label: `${module.en} ${action}`,
  })));
  const grants = {};
  for (const permission of permissions) {
    grants[`super_admin:${permission.key}`] = true;
    grants[`admin:${permission.key}`] =
      permission.action === "view" ||
      (permission.action === "edit" && ["gotras", "trees", "members", "verification", "master", "branches", "duplicates", "villages", "notifications", "reports", "exports", "activity"].includes(permission.module)) ||
      (permission.action === "approve" && ["verification", "master", "branches", "duplicates"].includes(permission.module));
  }
  const db = {
    permissions, grants,
    gotras: [], people: [], candidates: [], backups: [], restoreJobs: [],
    logs: [], notifications: [],
  };

  function allowed(role, key) { return db.grants[`${role}:${key}`] === true; }

  const pool = {
    db, grants: db.grants,
    async query(sql, params = []) {
      const query = flat(sql);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(query)) return { rows: [], rowCount: 0 };

      if (query.includes("FROM information_schema.columns")) {
        return {
          rows: [
            "people.wife_name", "people.member_type", "people.birth_order", "people.family_tree_id",
            "family_trees.current_revision", "family_trees.revision_number", "family_trees.root_person_id",
          ].map(key => {
            const [table_name, column_name] = key.split(".");
            return { table_name, column_name };
          }),
          rowCount: 7,
        };
      }

      if (query.includes("AS allowed") && query.includes("FROM admin_permission_overrides")) {
        return { rows: [{ allowed: allowed(params[1], params[2]) }], rowCount: 1 };
      }
      if (query.includes("FROM admin_permissions p")) {
        return {
          rows: permissions.map(permission => ({ ...permission, allowed: allowed(params[0], permission.key) })),
          rowCount: permissions.length,
        };
      }
      if (query.includes("INSERT INTO genealogy_audit")) {
        db.logs.push({ action: params[1], entityType: params[2], entityId: params[3], category: params[9] });
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("INSERT INTO notifications")) {
        const notification = { id: params[6] || crypto.randomUUID(), title: params[2], body: params[3] };
        db.notifications.push(notification);
        return { rows: [notification], rowCount: 1 };
      }
      if (query.startsWith("SELECT * FROM family_trees WHERE id=$1 FOR UPDATE")) {
        return {
          rows: [{
            id: params[0], status: "verified", tree_reference: "VSH-TEST",
            village: "Old Village", current_revision: [], revision_number: 1,
          }],
          rowCount: 1,
        };
      }
      if (query.startsWith("SELECT revision_number FROM family_trees WHERE id=$1")) {
        return { rows: [{ revision_number: 2 }], rowCount: 1 };
      }
      if (query.startsWith("SELECT DISTINCT t.id::text, t.tree_reference")) {
        return {
          rows: [{
            id: GOTRA_A, tree_reference: "VSH-TEST", revision_number: 1,
            current_revision: [
              { clientId: "r", parentId: null, memberType: "root", name: "मूल", wifeName: "माता", village: "Old Village" },
              { clientId: "d", parentId: "r", memberType: "daughter", name: "पुत्री" },
            ],
          }],
          rowCount: 1,
        };
      }
      if (query.startsWith("UPDATE family_trees SET")) {
        db.treeUpdate = { sql: query, params: [...params] };
        return {
          rows: [{
            id: params.at(-1),
            status: query.includes("status = 'under_review'") ? "under_review" : "verified",
            revisionNumber: 2,
          }],
          rowCount: 1,
        };
      }
      if (query.startsWith('SELECT id::text AS "clientId", full_name AS name')) {
        return {
          rows: [{
            clientId: PERSON_A, name: "New Name", wifeName: "सीता",
            village: "पिलानी", memberType: "root", birthOrder: null,
          }],
          rowCount: 1,
        };
      }
      if (query.startsWith('SELECT c.id::text AS "childId", p.id::text AS "parentId"')) {
        return { rows: [], rowCount: 0 };
      }
      if (query.startsWith("SELECT p.*, t.id AS tree_id")) {
        return {
          rows: [{
            id: params[0], full_name: "Old Name", family_tree_id: GOTRA_A,
            tree_id: GOTRA_A, tree_status: "verified", current_revision: [], revision_number: 1,
          }],
          rowCount: 1,
        };
      }
      if (query.startsWith("UPDATE people SET")) {
        db.memberUpdate = { sql: query, params: [...params] };
        return { rows: [{ id: params.at(-1), name: "New Name", status: "verified" }], rowCount: 1 };
      }
      if (query.includes("SELECT id FROM gotras WHERE lower(btrim(name))")) {
        const rows = db.gotras.filter(gotra => lower(gotra.name) === lower(params[0]) && gotra.id !== params[1]);
        return { rows, rowCount: rows.length };
      }
      if (query.startsWith("INSERT INTO gotras")) {
        const gotra = {
          id: crypto.randomUUID(),
          name: params[0], description: params[2], is_active: params[3], status: params[4],
          created_by: params[5], created_at: new Date().toISOString(),
        };
        db.gotras.push(gotra);
        return { rows: [{ id: gotra.id, name: gotra.name, status: gotra.status, isActive: gotra.is_active }], rowCount: 1 };
      }
      if (query.includes("SELECT COUNT(*)::int AS count FROM gotras g")) {
        return { rows: [{ count: db.gotras.length }], rowCount: 1 };
      }
      if (query.includes("SELECT g.id::text, g.name, COALESCE(g.description")) {
        return { rows: db.gotras.map(gotra => ({
          id: gotra.id, name: gotra.name, description: gotra.description || "",
          status: gotra.status, isActive: gotra.is_active, createdAt: gotra.created_at,
          treeCount: 0,
        })), rowCount: db.gotras.length };
      }
      if (query.includes("SELECT p.id, p.full_name, p.wife_name")) return { rows: db.people, rowCount: db.people.length };
      if (query.includes("SELECT id, name FROM gotras")) return { rows: db.gotras, rowCount: db.gotras.length };
      if (query.startsWith("INSERT INTO duplicate_candidates")) {
        const [entityType, entityA, entityB, score, reasons] = params;
        const candidate = {
          id: crypto.randomUUID(),
          entityType, entityA, entityB, score: Number(score), reasons: JSON.parse(reasons), status: "open",
        };
        db.candidates.push(candidate);
        return { rows: [candidate], rowCount: 1 };
      }
      if (query.startsWith("UPDATE duplicate_candidates SET status")) {
        const candidate = db.candidates.find(item => item.id === params[3]);
        if (candidate) { candidate.status = params[0]; candidate.reviewNotes = params[2]; }
        return { rows: candidate ? [{ id: candidate.id, status: candidate.status }] : [], rowCount: candidate ? 1 : 0 };
      }
      if (query.startsWith("INSERT INTO admin_backups")) {
        const backup = { id: crypto.randomUUID(), label: params[0], status: "creating", created_by: params[1], payload: {}, row_counts: {} };
        db.backups.push(backup);
        return { rows: [{ id: backup.id }], rowCount: 1 };
      }
      if (query.startsWith("SELECT * FROM admin_backups WHERE id=$1")) {
        const backup = db.backups.find(item => item.id === params[0]);
        return { rows: backup ? [backup] : [], rowCount: backup ? 1 : 0 };
      }
      if (/^SELECT \* FROM (gotras|people|family_trees|locations) ORDER BY id$/.test(query)) {
        const table = /^SELECT \* FROM (\w+)/.exec(query)[1];
        const rows = db[table] || [];
        return { rows, rowCount: rows.length };
      }
      if (query.startsWith("UPDATE admin_backups SET payload")) {
        const backup = db.backups.find(item => item.id === params[4]);
        if (backup) Object.assign(backup, { payload: JSON.parse(params[0]), row_counts: JSON.parse(params[1]), checksum: params[2], byte_size: params[3], status: "complete" });
        return { rows: [], rowCount: backup ? 1 : 0 };
      }
      if (query.startsWith("INSERT INTO admin_restore_jobs")) {
        const job = { id: crypto.randomUUID(), backup_id: params[0], mode: params[1], tables: params[2], status: "running" };
        db.restoreJobs.push(job);
        return { rows: [{ id: job.id }], rowCount: 1 };
      }
      if (query.includes("AS contributions,") && query.includes("genealogy_contributions")) {
        db.reportSql = query;
        return { rows: [{ trees: 1, verified: 1, pending: 0, contributions: 2, auditEvents: 3 }], rowCount: 1 };
      }
      if (query.includes('SELECT cl.relname AS "table"')) return { rows: [], rowCount: 0 };
      if (query.includes("SELECT column_name AS name FROM information_schema.columns")) {
        const columns = params[0] === "gotras"
          ? ["id", "name", "normalized_name", "description", "status", "is_active", "created_by", "created_at", "updated_at"]
          : ["id", "name"];
        return { rows: columns.map(name => ({ name })), rowCount: columns.length };
      }
      if (query.startsWith("INSERT INTO gotras (") || query.startsWith("INSERT INTO people (")) {
        return { rows: [], rowCount: 1 };
      }
      if (query.startsWith("UPDATE admin_restore_jobs")) return { rows: [], rowCount: 1 };
      if (query.startsWith("UPDATE admin_backups SET status='restored'")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    async connect() { return { query: (...args) => pool.query(...args), release() {} }; },
  };
  return pool;
}

async function withServer(pool, admin, callback, handlers = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use((request, _response, next) => { request.admin = admin; next(); });
  registerAdminConsoleRoutes(app, {
    pool,
    requireRole: roleGuard,
    clean,
    uuidOrNull,
    msg: (_request, _hi, en) => en,
    sendExport,
    logAudit: handlers.logAudit || (async (client, adminId, action, entityType, entityId, changes) =>
      client.query("INSERT INTO genealogy_audit (admin_id, action, entity_type, entity_id, changes) VALUES ($1,$2,$3,$4,$5)",
        [adminId, action, entityType, entityId, changes])),
    decisionHandler: handlers.decisionHandler ||
      (async (request, response) => response.json({ decision: request.body.decision, reused: true })),
    linkHandler: async (_request, response) => response.json({ linked: true }),
    reverseLinkHandler: async (_request, response) => response.json({ reversed: true }),
    refreshTreeProjection: async () => {},
  });
  app.use((error, _request, response, _next) => response.status(500).json({ error: error.message }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await callback(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

async function call(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, buffer };
}

const superAdmin = { id: ADMIN_ID, email: "super@example.com", role: "super_admin" };
const admin = { id: ADMIN_ID, email: "admin@example.com", role: "admin" };

test("console metadata lists 16 modules and denies revoked module access", async () => {
  const pool = makePool();
  await withServer(pool, admin, async base => {
    const ok = await call(base, "/api/admin/console/meta");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.modules.length, 16);
    assert.equal(ok.body.admin.role, "admin");

    pool.grants["admin:overview:view"] = false;
    const stillVisible = await call(base, "/api/admin/console/meta");
    assert.equal(stillVisible.status, 200);
    assert.equal(stillVisible.body.modules.length, 16);
    const overview = await call(base, "/api/admin/console/overview");
    assert.equal(overview.status, 403);
  });
});

test("sensitive account routes require Super Admin even with module grants", async () => {
  const pool = makePool();
  await withServer(pool, { ...admin, grants: undefined }, async base => {
    const response = await call(base, "/api/admin/console/accounts", {
      method: "POST",
      body: { email: "new@example.com", password: "a-very-strong-passphrase", role: "admin" },
    });
    assert.equal(response.status, 403);
  });
});

test("gotra creation validates duplicates and writes an audit entry", async () => {
  const pool = makePool();
  await withServer(pool, admin, async base => {
    const created = await call(base, "/api/admin/console/gotras", {
      method: "POST",
      body: { name: "Gehlot", description: "Primary branch", isActive: "true" },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.gotra.name, "Gehlot");
    assert.equal(created.body.gotra.isActive, true);
    assert.equal(pool.db.gotras.length, 1);
    assert.ok(pool.db.logs.some(log => log.action === "create_gotra" && log.category === "admin"));

    const duplicate = await call(base, "/api/admin/console/gotras", {
      method: "POST",
      body: { name: "  gehlot  " },
    });
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.body.error, /already exists/i);
  });
});

test("duplicate scan stores candidates and review decisions are validated", async () => {
  const pool = makePool();
  pool.db.people.push(
    { id: PERSON_A, full_name: "राम सिंह", wife_name: "सीता", village: "पिलानी", birth_year: "1950" },
    { id: PERSON_B, full_name: "राम सिंह", wife_name: "सीता", village: "पिलानी", birth_year: "1950" }
  );
  await withServer(pool, admin, async base => {
    const scan = await call(base, "/api/admin/console/duplicates/scan", { method: "POST", body: {} });
    assert.equal(scan.status, 200);
    assert.equal(scan.body.created, 1);
    assert.equal(pool.db.candidates.length, 1);

    const invalid = await call(base, `/api/admin/console/duplicates/${pool.db.candidates[0].id}/review`, {
      method: "PATCH", body: { decision: "merge_everything" },
    });
    assert.equal(invalid.status, 400);

    const valid = await call(base, `/api/admin/console/duplicates/${pool.db.candidates[0].id}/review`, {
      method: "PATCH", body: { decision: "dismissed", notes: "Different family lines" },
    });
    assert.equal(valid.status, 200);
    assert.equal(pool.db.candidates[0].status, "dismissed");
  });
});

test("exports stream CSV, XLSX and PDF with correct content types", async () => {
  const pool = makePool();
  pool.db.gotras.push({ id: GOTRA_A, name: "Gehlot", description: "क्षत्रिय", status: "verified", is_active: true, created_at: "2026-01-01" });
  await withServer(pool, admin, async base => {
    for (const [format, contentType] of [
      ["csv", "text/csv"],
      ["xlsx", "spreadsheetml.sheet"],
      ["pdf", "application/pdf"],
    ]) {
      const response = await call(base, `/api/admin/console/exports/gotras?format=${format}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), new RegExp(contentType));
      assert.ok(response.buffer.length > 20);
      if (format === "xlsx") assert.equal(response.buffer.subarray(0, 2).toString(), "PK");
      if (format === "pdf") assert.equal(response.buffer.subarray(0, 4).toString(), "%PDF");
    }
  });
});

test("reports date filters use each table's own timestamp column", async () => {
  const pool = makePool();
  await withServer(pool, admin, async base => {
    const response = await call(base, "/api/admin/console/reports/summary?from=2026-01-01&to=2026-01-31");
    assert.equal(response.status, 200);
    assert.match(pool.db.reportSql, /genealogy_contributions WHERE submitted_at >= \$1::timestamptz/i);
    assert.match(pool.db.reportSql, /genealogy_audit WHERE created_at >= \$3::timestamptz/i);
    assert.doesNotMatch(pool.db.reportSql, /genealogy_contributions WHERE created_at/i);
  });
});

test("verification decisions reuse the shared handler and expose the new status", async () => {
  const pool = makePool();
  await withServer(pool, admin, async base => {
    const response = await call(base, `/api/admin/console/verification/${GOTRA_A}/decision`, {
      method: "POST", body: { decision: "approve", notes: "Shared ancestor verified" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "verified");
    assert.deepEqual(response.body.skipped, []);
  }, {
    decisionHandler: async (_request, response) =>
      response.json({ status: "verified", skipped: [], message: "Decision saved." }),
  });
});

test("a failed decision audit does not block approval", async () => {
  const pool = makePool();
  let handlerCalls = 0;
  await withServer(pool, admin, async base => {
    const response = await call(base, `/api/admin/console/verification/${GOTRA_A}/decision`, {
      method: "POST", body: { decision: "approve", notes: "Approved" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, "verified");
    assert.equal(handlerCalls, 1);
  }, {
    logAudit: async () => { throw new Error("audit table unavailable"); },
    decisionHandler: async (_request, response) => {
      handlerCalls += 1;
      response.json({ status: "verified" });
    },
  });
});

test("verification decision errors are recoverable instead of bare 500s", async () => {
  const pool = makePool();
  let attempts = 0;
  const previousError = console.error;
  console.error = () => {};
  try {
    await withServer(pool, admin, async base => {
      const invalid = await call(base, `/api/admin/console/verification/${GOTRA_A}/decision`, {
        method: "POST", body: { decision: "explode" },
      });
      assert.equal(invalid.status, 400);

      const conflict = await call(base, `/api/admin/console/verification/${GOTRA_A}/decision`, {
        method: "POST", body: { decision: "approve" },
      });
      assert.equal(conflict.status, 409);
      assert.match(conflict.body.error, /already updated|conflicts/i);

      const failed = await call(base, `/api/admin/console/verification/${GOTRA_A}/decision`, {
        method: "POST", body: { decision: "approve" },
      });
      assert.equal(failed.status, 422);
      assert.match(failed.body.error, /could not be saved/i);
    }, {
      decisionHandler: async () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("duplicate key"), { code: "23505" });
        throw new Error("unexpected failure");
      },
    });
  } finally {
    console.error = previousError;
  }
});

test("schema drift and transient decision failures are actionable", async () => {
  const pool = makePool();
  const previousError = console.error;
  console.error = () => {};
  try {
    await withServer(pool, admin, async base => {
      const schema = await call(base, `/api/admin/console/verification/${GOTRA_A}/decision`, {
        method: "POST", body: { decision: "approve" },
      });
      assert.equal(schema.status, 503);
      assert.match(schema.body.error, /schema| restart /i);
      assert.equal(schema.body.code, "42703");

      const busy = await call(base, `/api/admin/console/verification/${GOTRA_A}/decision`, {
        method: "POST", body: { decision: "approve" },
      });
      assert.equal(busy.status, 503);
      assert.match(busy.body.error, /try again/i);
      assert.equal(busy.body.code, "53300");
    }, {
      decisionHandler: (() => {
        let calls = 0;
        return async () => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error('column "wife_name" does not exist'), { code: "42703" });
          throw Object.assign(new Error("remaining connection slots reserved"), { code: "53300" });
        };
      })(),
    });
  } finally {
    console.error = previousError;
  }
});

test("integrity trigger errors explain the genealogy rule that was violated", async () => {
  const pool = makePool();
  const previousError = console.error;
  console.error = () => {};
  try {
    await withServer(pool, admin, async base => {
      const response = await call(base, `/api/admin/console/verification/${GOTRA_A}/decision`, {
        method: "POST", body: { decision: "approve" },
      });
      assert.equal(response.status, 409);
      assert.match(response.body.error, /integrity rules rejected this tree/i);
      assert.match(response.body.error, /circular genealogy/i);
      assert.equal(response.body.code, "P0001");
    }, {
      decisionHandler: async () => {
        throw Object.assign(new Error("relationship would create a circular genealogy"), { code: "P0001" });
      },
    });
  } finally {
    console.error = previousError;
  }
});

test("decision errors name missing schema columns", async () => {
  const pool = makePool();
  const originalQuery = pool.query.bind(pool);
  pool.query = async (sql, params) => {
    if (flat(String(sql)).includes("FROM information_schema.columns")) return { rows: [], rowCount: 0 };
    return originalQuery(sql, params);
  };
  const previousError = console.error;
  console.error = () => {};
  try {
    await withServer(pool, admin, async base => {
      const response = await call(base, `/api/admin/console/verification/${GOTRA_A}/decision`, {
        method: "POST", body: { decision: "approve" },
      });
      assert.equal(response.status, 422);
      assert.match(response.body.error, /Missing DB columns/);
      assert.match(response.body.schema, /people\.wife_name/);
    }, {
      decisionHandler: async () => { throw new Error("unexpected failure"); },
    });
  } finally {
    console.error = previousError;
  }
});

test("verification detail actions are delegated and follow the decision status", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "js", "admin-console.js"), "utf8");
  assert.match(source, /#admin-detail-body"\)\.addEventListener\("click", dispatchAction\)/);
  assert.match(source, /result\?\.status \|\| decision/);
  assert.match(source, /state\.filters\.verification[\s\S]*status: nextStatus/);
  assert.match(source, /revisionIntent: revising/);
});

test("bulk village changes require revision intent when verified trees are affected", async () => {
  const pool = makePool();
  await withServer(pool, admin, async base => {
    const blocked = await call(base, "/api/admin/console/villages/rename", {
      method: "POST", body: { from: "Old Village", to: "New Village" },
    });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /revisionIntent/i);
    assert.equal(blocked.body.affectedTrees, 1);

    const revised = await call(base, "/api/admin/console/villages/rename", {
      method: "POST", body: { from: "Old Village", to: "New Village", revisionIntent: true },
    });
    assert.equal(revised.status, 200);
    assert.equal(revised.body.revisions, 1);
    assert.match(pool.db.treeUpdate.sql, /current_revision=\$2::jsonb/);
    assert.match(pool.db.treeUpdate.params[1], /New Village/);
  });
});

test("verified trees and members require an explicit revision intent", async () => {
  const pool = makePool();
  await withServer(pool, admin, async base => {
    const treeUrl = `/api/admin/console/trees/${GOTRA_A}`;
    const accidental = await call(base, treeUrl, { method: "PATCH", body: { village: "New Village" } });
    assert.equal(accidental.status, 409);
    assert.match(accidental.body.error, /revisionIntent/i);

    const revised = await call(base, treeUrl, {
      method: "PATCH", body: { village: "New Village", revisionIntent: true, note: "Corrected village" },
    });
    assert.equal(revised.status, 200);
    assert.equal(revised.body.tree.status, "under_review");
    assert.match(pool.db.treeUpdate.sql, /status = 'under_review'/);

    const memberUrl = `/api/admin/console/members/${PERSON_A}`;
    const memberBlocked = await call(base, memberUrl, { method: "PATCH", body: { fullName: "New Name" } });
    assert.equal(memberBlocked.status, 409);
    assert.match(memberBlocked.body.error, /revisionIntent/i);

    const memberRevised = await call(base, memberUrl, {
      method: "PATCH", body: { fullName: "New Name", revisionIntent: true },
    });
    assert.equal(memberRevised.status, 200);
    assert.match(pool.db.treeUpdate.sql, /current_revision=\$2::jsonb/);
    assert.match(pool.db.treeUpdate.sql, /revision_number=\$3/);
    assert.match(pool.db.treeUpdate.sql, /status='under_review'/);
    assert.match(pool.db.treeUpdate.params[1], /New Name/);
  });
});

test("backup restore refuses an unconfirmed request", async () => {
  const pool = makePool();
  pool.db.gotras.push({ id: GOTRA_A, name: "Gehlot", normalized_name: "gehlot", description: "", status: "verified", is_active: true, created_by: ADMIN_ID, created_at: "2026-01-01" });
  await withServer(pool, superAdmin, async base => {
    const backup = await call(base, "/api/admin/console/backups", {
      method: "POST", body: { label: "Before migration" },
    });
    assert.equal(backup.status, 201);
    assert.equal(pool.db.backups[0].status, "complete");

    const refused = await call(base, `/api/admin/console/backups/${backup.body.backup.id}/restore`, {
      method: "POST", body: { mode: "missing_only" },
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /confirmation phrase/i);

    const restored = await call(base, `/api/admin/console/backups/${backup.body.backup.id}/restore`, {
      method: "POST", body: { mode: "missing_only", confirm: "RESTORE", tables: ["gotras"] },
    });
    assert.equal(restored.status, 200);
    assert.equal(pool.db.restoreJobs[0].status, "running");
    assert.ok(pool.db.logs.some(log => log.action === "create_backup"));
  });
});

test("admin migration is additive and leaves ledger ownership to the runner", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "db", "migrations", "2026-11-20-admin-console.sql"), "utf8"
  );
  for (const table of [
    "admin_permissions", "admin_role_permissions", "admin_permission_overrides",
    "admin_sessions", "family_tree_revisions", "verification_assignments",
    "branch_links", "duplicate_candidates", "notifications", "admin_backups",
    "admin_restore_jobs",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "i"), `missing ${table}`);
  }
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+schema_migrations/i);
  assert.match(sql, /ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active/i);
  assert.match(sql, /ALTER TABLE admins ADD COLUMN IF NOT EXISTS locked_until/i);
  assert.match(sql, /WHEN action = 'view' THEN TRUE/i);
  assert.match(sql, /WHEN action = 'edit' AND module IN/i);
  assert.match(sql, /WHEN action = 'approve' AND module IN \(\s*'verification', 'master', 'branches', 'duplicates'/i);
  assert.match(sql, /UPDATE admin_role_permissions arp/i);
});
