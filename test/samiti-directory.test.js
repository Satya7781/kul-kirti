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

function groupRow(row) {
  return {
    id: row.id, name: row.name, description: row.description || "",
    isActive: row.is_active, sortOrder: row.sort_order,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function memberRow(row) {
  return {
    id: row.id, samitiId: row.samiti_id, name: row.name, position: row.position,
    isPresident: row.is_president, photoUrl: row.photo_data || "", photoMime: row.photo_mime || "",
    sortOrder: row.sort_order, isActive: row.is_active,
    createdAt: row.created_at, updatedAt: row.updated_at,
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
  const db = { samitis: [], members: [], logs: [], grants };
  const allowed = (role, key) => grants[`${role}:${key}`] === true;
  const stamp = () => new Date().toISOString();

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

      /* Public API: one row per published samiti/member pair. */
      if (query.includes("FROM samitis g") && query.includes("LEFT JOIN samiti_members m")) {
        const rows = [];
        db.samitis.filter(item => item.is_active).forEach(item => {
          const members = db.members
            .filter(member => member.samiti_id === item.id && member.is_active)
            .sort((a, b) => Number(b.is_president) - Number(a.is_president) || a.sort_order - b.sort_order);
          if (!members.length) {
            rows.push({ samitiId: item.id, samitiName: item.name, samitiDescription: item.description, id: null });
            return;
          }
          members.forEach(member => rows.push({
            samitiId: item.id, samitiName: item.name, samitiDescription: item.description,
            id: member.id, name: member.name, position: member.position,
            isPresident: member.is_president, photoUrl: member.photo_data, sortOrder: member.sort_order,
          }));
        });
        return { rows, rowCount: rows.length };
      }

      if (query.startsWith("SELECT ") && query.includes("FROM samitis ORDER BY")) {
        const rows = db.samitis.map(groupRow);
        return { rows, rowCount: rows.length };
      }
      if (query.startsWith("SELECT ") && query.includes("FROM samiti_members ORDER BY")) {
        const rows = db.members.map(memberRow);
        return { rows, rowCount: rows.length };
      }
      if (query.startsWith("SELECT * FROM samitis WHERE id = $1")) {
        const item = db.samitis.find(group => group.id === params[0]);
        return { rows: item ? [item] : [], rowCount: item ? 1 : 0 };
      }
      if (query.startsWith("INSERT INTO samitis")) {
        const item = {
          id: crypto.randomUUID(), name: params[0], description: params[1],
          is_active: params[2], sort_order: params[3], created_by: params[4],
          created_at: stamp(), updated_at: stamp(),
        };
        db.samitis.push(item);
        return { rows: [groupRow(item)], rowCount: 1 };
      }
      if (query.startsWith("UPDATE samitis SET")) {
        const item = db.samitis.find(group => group.id === params[5]);
        if (!item) return { rows: [], rowCount: 0 };
        Object.assign(item, {
          name: params[0], description: params[1], is_active: params[2],
          sort_order: params[3], updated_by: params[4], updated_at: stamp(),
        });
        return { rows: [groupRow(item)], rowCount: 1 };
      }
      if (query.startsWith("DELETE FROM samitis WHERE id = $1")) {
        const index = db.samitis.findIndex(group => group.id === params[0]);
        if (index < 0) return { rows: [], rowCount: 0 };
        db.samitis.splice(index, 1);
        db.members = db.members.filter(member => member.samiti_id !== params[0]);
        return { rows: [], rowCount: 1 };
      }

      if (query.includes("FROM samiti_members WHERE samiti_id = $1 AND is_president")) {
        const rows = db.members.filter(member =>
          member.samiti_id === params[0] && member.is_president && member.is_active && member.id !== params[1]
        );
        return { rows, rowCount: rows.length };
      }
      if (query.startsWith("SELECT * FROM samiti_members WHERE id = $1 AND samiti_id = $2")) {
        const member = db.members.find(item => item.id === params[0] && item.samiti_id === params[1]);
        return { rows: member ? [member] : [], rowCount: member ? 1 : 0 };
      }
      if (query.startsWith("INSERT INTO samiti_members")) {
        const member = {
          id: crypto.randomUUID(), samiti_id: params[0], name: params[1], position: params[2],
          is_president: params[3], photo_data: params[4], photo_mime: params[5],
          sort_order: params[6], is_active: params[7], created_by: params[8],
          created_at: stamp(), updated_at: stamp(),
        };
        db.members.push(member);
        return { rows: [memberRow(member)], rowCount: 1 };
      }
      if (query.startsWith("UPDATE samiti_members SET")) {
        const member = db.members.find(item => item.id === params[10]);
        if (!member) return { rows: [], rowCount: 0 };
        Object.assign(member, {
          samiti_id: params[0], name: params[1], position: params[2], is_president: params[3],
          photo_data: params[4], photo_mime: params[5], sort_order: params[6],
          is_active: params[7], updated_by: params[8], updated_at: stamp(),
        });
        return { rows: [memberRow(member)], rowCount: 1 };
      }
      if (query.startsWith("DELETE FROM samiti_members WHERE id = $1 AND samiti_id = $2")) {
        const index = db.members.findIndex(item => item.id === params[0] && item.samiti_id === params[1]);
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

async function createSamiti(base, name, extra = {}) {
  const result = await call(base, "/api/admin/console/samiti", {
    method: "POST", body: { name, isActive: true, ...extra },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.samiti;
}

test("admin can create, update and delete multiple samitis independently", async () => {
  const pool = makePool();
  await withServer(pool, async base => {
    const first = await createSamiti(base, "पहली समिति", { description: "गांव समिति" });
    const second = await createSamiti(base, "दूसरी समिति");
    assert.equal(pool.db.samitis.length, 2);

    const listing = await call(base, "/api/admin/console/samiti");
    assert.equal(listing.status, 200);
    assert.deepEqual(listing.body.samitis.map(item => item.name), ["पहली समिति", "दूसरी समिति"]);

    const renamed = await call(base, `/api/admin/console/samiti/${first.id}`, {
      method: "PATCH", body: { name: "नई पहली समिति", description: "अपडेट विवरण", isActive: false },
    });
    assert.equal(renamed.status, 200);
    assert.equal(pool.db.samitis[0].name, "नई पहली समिति");
    assert.equal(pool.db.samitis[0].description, "अपडेट विवरण");
    assert.equal(pool.db.samitis[0].is_active, false);

    const deleted = await call(base, `/api/admin/console/samiti/${second.id}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.equal(pool.db.samitis.length, 1);
    assert.ok(pool.db.logs.some(log => log.action === "create_samiti" && log.category === "admin"));
    assert.ok(pool.db.logs.some(log => log.action === "update_samiti"));
    assert.ok(pool.db.logs.some(log => log.action === "delete_samiti"));
  });
});

test("each samiti has its own president and published members", async () => {
  const pool = makePool();
  await withServer(pool, async base => {
    const first = await createSamiti(base, " समिति A");
    const second = await createSamiti(base, "समिति B");

    const presidentA = await call(base, `/api/admin/console/samiti/${first.id}/members`, {
      method: "POST",
      body: { name: "रमेश", position: "अध्यक्ष", isPresident: true, photo: VALID_PNG, sortOrder: 1 },
    });
    assert.equal(presidentA.status, 201, JSON.stringify(presidentA.body));
    assert.match(presidentA.body.member.photoUrl, /^data:image\/png;base64,/);
    assert.ok(pool.db.logs.some(log => log.action === "create_samiti_member" && log.category === "admin"));
    assert.ok(!JSON.stringify(pool.db.logs).includes(VALID_PNG));

    const presidentB = await call(base, `/api/admin/console/samiti/${second.id}/members`, {
      method: "POST", body: { name: "सीमा", position: "अध्यक्ष", isPresident: true },
    });
    assert.equal(presidentB.status, 201, JSON.stringify(presidentB.body));

    const secondPresidentA = await call(base, `/api/admin/console/samiti/${first.id}/members`, {
      method: "POST", body: { name: "दूसरे अध्यक्ष", isPresident: true },
    });
    assert.equal(secondPresidentA.status, 409);
    assert.match(secondPresidentA.body.error, /president/i);

    const published = await call(base, "/api/samiti");
    assert.equal(published.status, 200);
    assert.equal(published.body.samitis.length, 2);
    assert.deepEqual(published.body.samitis.map(item => item.name), [" समिति A".trim(), "समिति B"]);
    assert.deepEqual(published.body.samitis.map(item => item.members[0].name), ["रमेश", "सीमा"]);

    await call(base, `/api/admin/console/samiti/${second.id}`, {
      method: "PATCH", body: { isActive: false },
    });
    const afterUnpublish = await call(base, "/api/samiti");
    assert.equal(afterUnpublish.body.samitis.length, 1);
    assert.equal(afterUnpublish.body.samitis[0].name, "समिति A");

    const missing = await call(base, `/api/admin/console/samiti/${crypto.randomUUID()}/members`, {
      method: "POST", body: { name: "अमान्य" },
    });
    assert.equal(missing.status, 404);
  });
});

test("member updates can move a member to another samiti; invalid photos are rejected", async () => {
  const pool = makePool();
  await withServer(pool, async base => {
    const first = await createSamiti(base, "समिति A");
    const second = await createSamiti(base, "समिति B");

    const badPhoto = await call(base, `/api/admin/console/samiti/${first.id}/members`, {
      method: "POST", body: { name: "टेस्ट", photo: "data:text/plain;base64,SGVsbG8=" },
    });
    assert.equal(badPhoto.status, 400);
    assert.match(badPhoto.body.error, /PNG, JPEG, WebP or GIF/i);

    const noName = await call(base, `/api/admin/console/samiti/${first.id}/members`, {
      method: "POST", body: { position: "सदस्य" },
    });
    assert.equal(noName.status, 400);

    const created = await call(base, `/api/admin/console/samiti/${first.id}/members`, {
      method: "POST", body: { name: "विनय", position: "सदस्य", photo: VALID_PNG },
    });
    assert.equal(created.status, 201);
    const memberId = created.body.member.id;

    const moved = await call(base, `/api/admin/console/samiti/${first.id}/members/${memberId}`, {
      method: "PATCH",
      body: { samitiId: second.id, name: "विनय कुमार", isPresident: true, removePhoto: true },
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.member.samitiId, second.id);
    assert.equal(moved.body.member.isPresident, true);
    assert.equal(moved.body.member.photoUrl, "");
    assert.equal(pool.db.members[0].samiti_id, second.id);

    const wrongPath = await call(base, `/api/admin/console/samiti/${first.id}/members/${memberId}`, {
      method: "DELETE",
    });
    assert.equal(wrongPath.status, 404);

    const removed = await call(base, `/api/admin/console/samiti/${second.id}/members/${memberId}`, {
      method: "DELETE",
    });
    assert.equal(removed.status, 200);
    assert.equal(pool.db.members.length, 0);
    assert.ok(pool.db.logs.some(log => log.action === "update_samiti_member"));
    assert.ok(pool.db.logs.some(log => log.action === "delete_samiti_member"));
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
    assert.equal(pool.db.samitis.length, 0);
  });
});
