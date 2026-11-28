const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const http = require("node:http");
const express = require("express");
const { roleGuard } = require("../lib/http-security");
const registerAdminConsoleRoutes = require("../lib/admin-console-routes");
const { MODULES, clean, uuidOrNull } = require("../lib/admin-console-core");

const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
const flat = sql => String(sql).replace(/\s+/g, " ").trim();

function asAdmin(row) {
  return {
    id: row.id, name: row.name, position: row.position,
    isPresident: row.is_president, photoUrl: row.photo_data || "",
    photoMime: row.photo_mime || "", sortOrder: row.sort_order,
    isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function asPublic(row) {
  return {
    id: row.id, name: row.name, position: row.position,
    isPresident: row.is_president, photoUrl: row.photo_data || null,
    sortOrder: row.sort_order,
  };
}

function makePool() {
  const permissions = MODULES.flatMap(module => ["view", "edit", "approve"].map(action => ({
    module: module.id, action, key: `${module.id}:${action}`,
  })));
  const grants = {};
  for (const permission of permissions) {
    grants[`super_admin:${permission.key}`] = true;
    grants[`admin:${permission.key}`] = permission.action === "view" || (permission.action === "edit" && permission.module === "samiti");
  }
  const db = { members: [], logs: [], grants };
  const allowed = (role, key) => grants[`${role}:${key}`] === true;

  const pool = {
    db, grants,
    async query(sql, params = []) {
      const query = flat(sql);
      const placeholders = [...query.matchAll(/\$(\d+)/g)].map(match => Number(match[1]));
      const expected = placeholders.length ? Math.max(...placeholders) : 0;
      if (expected && params.length !== expected) {
        throw Object.assign(new Error(
          `bind message supplies ${params.length} parameters, but prepared statement requires ${expected}`
        ), { code: "08P01" });
      }

      if (query.includes("AS allowed") && query.includes("FROM admin_permission_overrides")) {
        return { rows: [{ allowed: allowed(params[1], params[2]) }], rowCount: 1 };
      }
      if (query.includes("INSERT INTO genealogy_audit")) {
        db.logs.push({ action: params[1], entityType: params[2], entityId: params[3], changes: params[5], category: params[9] });
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("FROM samiti_members WHERE is_active = TRUE")) {
        const rows = db.members.filter(member => member.is_active).map(asPublic);
        return { rows, rowCount: rows.length };
      }
      if (query.startsWith("SELECT ") && query.includes("FROM samiti_members") && query.includes("ORDER BY is_president DESC")) {
        const rows = db.members.map(asAdmin);
        return { rows, rowCount: rows.length };
      }
      if (query.includes("FROM samiti_members WHERE is_president = TRUE AND is_active = TRUE")) {
        const rows = db.members.filter(member => member.is_president && member.is_active && member.id !== params[0]);
        return { rows, rowCount: rows.length };
      }
      if (query.startsWith("SELECT * FROM samiti_members WHERE id = $1")) {
        const member = db.members.find(item => item.id === params[0]);
        return { rows: member ? [member] : [], rowCount: member ? 1 : 0 };
      }
      if (query.startsWith("INSERT INTO samiti_members")) {
        const member = {
          id: crypto.randomUUID(), name: params[0], position: params[1],
          is_president: params[2], photo_data: params[3], photo_mime: params[4],
          sort_order: params[5], is_active: params[6], created_by: params[7],
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        };
        db.members.push(member);
        return { rows: [asAdmin(member)], rowCount: 1 };
      }
      if (query.startsWith("UPDATE samiti_members")) {
        const member = db.members.find(item => item.id === params[8]);
        if (!member) return { rows: [], rowCount: 0 };
        Object.assign(member, {
          name: params[0], position: params[1], is_president: params[2],
          photo_data: params[3], photo_mime: params[4], sort_order: params[5],
          is_active: params[6], updated_by: params[7], updated_at: new Date().toISOString(),
        });
        return { rows: [asAdmin(member)], rowCount: 1 };
      }
      if (query.startsWith("DELETE FROM samiti_members WHERE id = $1")) {
        const index = db.members.findIndex(item => item.id === params[0]);
        if (index < 0) return { rows: [], rowCount: 0 };
        db.members.splice(index, 1);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async connect() { return { query: (...args) => pool.query(...args), release() {} }; },
  };
  return pool;
}

async function withServer(pool, callback) {
  const app = express();
  app.use(express.json({ limit: "6mb" }));
  app.use((request, _response, next) => {
    request.admin = { id: ADMIN_ID, email: "admin@example.com", role: "admin" };
    next();
  });
  registerAdminConsoleRoutes(app, {
    pool,
    requireRole: roleGuard,
    clean,
    uuidOrNull,
    msg: (_request, _hi, en) => en,
    sendExport: () => {},
    logAudit: async () => {},
    decisionHandler: async (_request, response) => response.json({}),
    linkHandler: async (_request, response) => response.json({}),
    reverseLinkHandler: async (_request, response) => response.json({}),
    refreshTreeProjection: async () => {},
  });
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ error: error.message }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await callback(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

async function call(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers: { "content-type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

test("samiti CRUD persists photos and publishes only active members", async () => {
  const pool = makePool();
  await withServer(pool, async base => {
    const created = await call(base, "/api/admin/console/samiti", {
      method: "POST",
      body: {
        name: "रमेश शर्मा", position: "अध्यक्ष", isPresident: true,
        photo: VALID_PNG, sortOrder: 1, isActive: true,
      },
    });
    assert.equal(created.status, 201);
    assert.equal(pool.db.members.length, 1);
    assert.match(created.body.member.photoUrl, /^data:image\/png;base64,/);
    assert.ok(pool.db.logs.some(log => log.action === "create_samiti_member" && log.category === "admin"));
    assert.ok(!JSON.stringify(pool.db.logs).includes(VALID_PNG));

    const second = await call(base, "/api/admin/console/samiti", {
      method: "POST", body: { name: "दूसरे", isPresident: true, isActive: true },
    });
    assert.equal(second.status, 409);
    assert.match(second.body.error, /president/i);

    const published = await call(base, "/api/samiti");
    assert.equal(published.status, 200);
    assert.equal(published.body.members.length, 1);
    assert.equal(published.body.members[0].name, "रमेश शर्मा");

    const id = created.body.member.id;
    const updated = await call(base, `/api/admin/console/samiti/${id}`, {
      method: "PATCH",
      body: { name: "रमेश कुमार", position: "अध्यक्ष", isPresident: true, removePhoto: true, isActive: false },
    });
    assert.equal(updated.status, 200);
    assert.equal(pool.db.members[0].name, "रमेश कुमार");
    assert.equal(pool.db.members[0].photo_data, null);
    assert.equal((await call(base, "/api/samiti")).body.members.length, 0);

    const removed = await call(base, `/api/admin/console/samiti/${id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.equal(pool.db.members.length, 0);
    assert.ok(pool.db.logs.some(log => log.action === "delete_samiti_member"));
  });
});

test("samiti photo validation rejects non-images and missing names", async () => {
  const pool = makePool();
  await withServer(pool, async base => {
    const noName = await call(base, "/api/admin/console/samiti", {
      method: "POST", body: { position: "Member", photo: VALID_PNG },
    });
    assert.equal(noName.status, 400);
    const badPhoto = await call(base, "/api/admin/console/samiti", {
      method: "POST", body: { name: "Test", photo: "data:text/plain;base64,SGVsbG8=" },
    });
    assert.equal(badPhoto.status, 400);
    assert.match(badPhoto.body.error, /PNG, JPEG, WebP or GIF/i);
    assert.equal(pool.db.members.length, 0);
  });
});

test("samiti writes are denied when the DB-backed edit permission is revoked", async () => {
  const pool = makePool();
  pool.grants["admin:samiti:edit"] = false;
  await withServer(pool, async base => {
    const response = await call(base, "/api/admin/console/samiti", {
      method: "POST", body: { name: "Blocked" },
    });
    assert.equal(response.status, 403);
    assert.equal(pool.db.members.length, 0);
  });
});
