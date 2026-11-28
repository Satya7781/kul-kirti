/**
 * admin-console-routes.js — functional backend for the 17 admin modules.
 *
 * All routes are registered AFTER server.js's central /api/admin auth gate, so
 * every handler already has request.admin from the current database row.
 * Module-level authorisation is enforced again from admin_permissions.
 */
"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const {
  MODULES, GROUPS, makePermissionGuard, loadPermissions, makeAdminLogger,
  makeNotifier, paginate, dateWindow, asBool, clean, uuidOrNull, fetchExportData,
} = require("./admin-console-core");
const vsh = require("./vanshawali");

const ROOT_NAME_SQL = `COALESCE(p.full_name, t.current_revision->0->>'name', '')`;

const BACKUP_TABLES = [
  "gotras", "family_branches", "people", "family_trees", "person_gotra_links",
  "person_relationships", "locations", "tree_links", "verification_records",
  "family_tree_revisions", "branch_links", "duplicate_candidates",
];
const RESTORE_TABLES = [
  "gotras", "family_branches", "people", "family_trees", "person_gotra_links",
  "person_relationships", "locations", "family_tree_revisions", "branch_links",
];
/* Columns participating in circular / self dependencies are inserted as NULL
   and filled in a second pass, so restore never depends on row order. */
const DEFERRED_COLUMNS = {
  family_branches: ["parent_branch_id"],
  family_trees: ["root_person_id"],
  people: ["family_tree_id"],
};

function wrap(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function param(values, value) {
  values.push(value);
  return `$${values.length}`;
}

function sameLower(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

async function tableRestoreOrder(client, tables) {
  const result = await client.query(
    `SELECT cl.relname AS "table", ct.relname AS "dependsOn"
       FROM pg_constraint con
       JOIN pg_class cl ON cl.oid = con.conrelid
       JOIN pg_class ct ON ct.oid = con.confrelid
       JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE con.contype = 'f' AND ns.nspname = 'public'`
  );
  const dependencies = new Map(tables.map(table => [table, new Set()]));
  for (const row of result.rows) {
    if (dependencies.has(row.table) && dependencies.has(row.dependsOn) && row.table !== row.dependsOn) {
      dependencies.get(row.table).add(row.dependsOn);
    }
  }
  const ordered = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining].filter(table =>
      [...dependencies.get(table)].every(dependency => !remaining.has(dependency))
    );
    if (!ready.length) { ordered.push(...remaining); break; }
    ready.sort().forEach(table => { ordered.push(table); remaining.delete(table); });
  }
  return ordered;
}

/**
 * @param {object} app Express app
 * @param {object} deps shared server dependencies
 */
module.exports = function registerAdminConsoleRoutes(app, deps) {
  const {
    pool, requireRole, clean: serverClean, uuidOrNull: serverUuid, msg,
    sendExport, logAudit, decisionHandler, linkHandler, reverseLinkHandler,
  } = deps;
  const requirePermission = makePermissionGuard(pool);
  const logAdminAction = makeAdminLogger(pool, logAudit);
  const notify = makeNotifier(pool);
  const superOnly = requireRole("super_admin");
  const PREFIX = "/api/admin/console";

  const view = module => [requirePermission(module, "view")];
  const edit = module => [requirePermission(module, "edit")];
  const approve = module => [requirePermission(module, "approve")];

  function locale(request, hi, en) { return msg ? msg(request, hi, en) : en; }

  /* Decision writes must never collapse into a bare 500: an audit hiccup is
     non-fatal, and a database/data conflict is surfaced as a recoverable 4xx
     so the reviewer can correct the submission and try again. */
  function decisionFailureStatus(error) {
    const status = Number(error?.status || error?.statusCode);
    if (status >= 400 && status < 500) return status;
    if (["23505", "23503", "23514", "22P02", "22001", "23502", "42804", "22003", "P0001"].includes(error?.code)) return 409;
    /* Missing/outdated schema objects and transient capacity errors are not
       something the reviewer can fix by changing the tree. */
    if (["42703", "42P01", "42883", "42P10", "42601"].includes(error?.code)) return 503;
    if (["40001", "40P01", "57014", "53300"].includes(error?.code)) return 503;
    return 422;
  }

  function decisionFailureMessage(request, error, status) {
    let message;
    if (status === 503 && ["42703", "42P01", "42883", "42P10", "42601"].includes(error?.code)) {
      message = locale(request,
        "डेटाबेस स्कीम पुराना है। सेवा को पुनः चालू करें ताकि माइग्रेशन लागू हों।",
        "The database schema is out of date. Restart the service so migrations apply."
      );
    } else if (status === 503) {
      message = locale(request,
        "सेवा अस्थायी रूप से व्यस्त है; कृपया पुनः प्रयास करें।",
        "The service is temporarily busy; please try again."
      );
    } else if (error?.code === "P0001") {
      /* Integrity-trigger messages are safe, descriptive and admin-only. */
      message = locale(request,
        `वंशानुक्रम नियमों के कारण यह वृक्ष सहेजा नहीं जा सका: ${String(error?.message || "").slice(0, 200)}`,
        `Genealogy integrity rules rejected this tree: ${String(error?.message || "").slice(0, 200)}`
      );
    } else if (status === 409) {
      message = locale(request,
        "यह वृक्ष पहले ही अपडेट हो चुका है या मौजूदा रिकॉर्ड से मेल नहीं खाता।",
        "The tree was already updated or conflicts with existing records."
      );
    } else {
      message = locale(request,
        "निर्णय सहेजा नहीं जा सका; कृपया वृक्ष डेटा जाँचें।",
        "The decision could not be saved; check the tree data and try again."
      );
    }
    /* Explicit DB code makes the next failure actionable without requiring
       access to the hosting provider's log stream. Admin route only. */
    if (error?.code) message += ` [${error.code}${error.constraint ? `:${error.constraint}` : ""}]`;
    return message;
  }

  function cid(value) { return serverUuid ? serverUuid(value) : uuidOrNull(value); }
  function text(value, max = 500) { return serverClean ? serverClean(value, max) : clean(value, max); }

  /* Photos travel as validated data URLs. Storing them in Postgres keeps the
     feature self-contained: no new upload bucket, static path or secret is
     required, and the public API can return the same vetted value safely. */
  const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
  function parsePhoto(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw) return { url: null, mime: null };
    if (raw.length > MAX_PHOTO_BYTES * 2) return { error: "Photo is too large." };
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);
    if (!match) return { error: "Photo must be a PNG, JPEG, WebP or GIF image." };
    const encoded = match[2].replace(/\s+/g, "");
    if (!encoded || encoded.length % 4 !== 0) return { error: "Photo data is invalid." };
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) return { error: "Photo must be smaller than 2 MB." };
    const isPng = bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG";
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isGif = ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
    const isWebp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!(isPng || isJpeg || isGif || isWebp)) return { error: "Photo file content does not match its image type." };
    return { url: `data:${match[1]};base64,${bytes.toString("base64")}`, mime: match[1] };
  }

  function samitiSort(value, fallback = 100) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.min(9999, Math.max(0, parsed)) : fallback;
  }

  /* ── Metadata / overview ────────────────────────────────────────────── */

  /* Metadata is available to any authenticated admin so that revoking one
     module's view access cannot hide every other module behind an empty nav. */
  app.get(`${PREFIX}/meta`, wrap(async (request, response) => {
    const permissions = await loadPermissions(pool, request.admin);
    response.json({
      modules: MODULES.map(module => ({
        ...module,
        title: msg ? msg(request, module.hi, module.en) : module.en,
        groupLabel: GROUPS[module.group],
        permissions: permissions[module.id] || {},
      })),
      admin: { email: request.admin.email, role: request.admin.role },
      permissions,
    });
  }));

  app.get(`${PREFIX}/overview`, ...view("overview"), wrap(async (_request, response) => {
    const counters = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM gotras WHERE is_active) AS "activeGotras",
         (SELECT COUNT(*) FROM gotras) AS gotras,
         (SELECT COUNT(*) FROM family_trees WHERE deleted_at IS NULL) AS trees,
         (SELECT COUNT(*) FROM people WHERE status <> 'archived') AS people,
         (SELECT COUNT(*) FROM family_trees WHERE status = 'pending') AS pending,
         (SELECT COUNT(*) FROM family_trees WHERE status = 'under_review') AS underReview,
         (SELECT COUNT(*) FROM family_trees WHERE status = 'correction_required') AS corrections,
         (SELECT COUNT(*) FROM family_trees WHERE status = 'verified') AS verified,
         (SELECT COUNT(*) FROM family_trees WHERE status = 'rejected') AS rejected,
         (SELECT COUNT(*) FROM tree_links WHERE status = 'active') AS links,
         (SELECT COUNT(*) FROM genealogy_contributions WHERE status = 'pending') AS contributions,
         (SELECT COUNT(*) FROM privacy_requests WHERE status = 'pending') AS privacyRequests,
         (SELECT COUNT(*) FROM duplicate_candidates WHERE status = 'open') AS duplicates,
         (SELECT COUNT(*) FROM notifications WHERE read_at IS NULL AND (admin_id IS NULL OR admin_id = $1)) AS unread,
         (SELECT COUNT(*) FROM admin_backups WHERE status = 'complete') AS backups,
         (SELECT COUNT(*) FROM admins WHERE is_active) AS admins,
         ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (verified_at - submitted_at)) / 3600), 0)::numeric, 1) AS "avgVerificationHours"
       FROM family_trees WHERE verified_at IS NOT NULL AND submitted_at IS NOT NULL`,
      [requestAdminId(_request)]
    );
    const [statuses, gotras, recentTrees, recentAudit] = await Promise.all([
      pool.query(`SELECT status, COUNT(*)::int AS count FROM family_trees WHERE deleted_at IS NULL GROUP BY status ORDER BY count DESC`),
      pool.query(`SELECT g.name, COUNT(t.id)::int AS count FROM gotras g LEFT JOIN family_trees t ON t.gotra_id = g.id GROUP BY g.id, g.name ORDER BY count DESC LIMIT 8`),
      pool.query(
        `SELECT t.id::text, t.tree_reference AS "treeReference", g.name AS gotra, t.status,
                t.submitted_at::text AS "submittedAt"
           FROM family_trees t LEFT JOIN gotras g ON g.id = t.gotra_id
          ORDER BY COALESCE(t.submitted_at, t.created_at) DESC LIMIT 8`
      ),
      pool.query(
        `SELECT a.id::text, a.action, a.entity_type AS "entityType", a.category,
                COALESCE(ad.email,'system') AS admin, a.created_at::text AS "createdAt"
           FROM genealogy_audit a LEFT JOIN admins ad ON ad.id = a.admin_id
          ORDER BY a.created_at DESC LIMIT 8`
      ),
    ]);
    response.json({
      counters: counters.rows[0],
      statuses: statuses.rows,
      gotras: gotras.rows,
      recentTrees: recentTrees.rows,
      recentAudit: recentAudit.rows,
    });
  }));

  function requestAdminId(request) { return request.admin?.id || null; }

  /* ── Gotra management ───────────────────────────────────────────────── */

  app.get(`${PREFIX}/gotras`, ...view("gotras"), wrap(async (request, response) => {
    const { limit, offset } = paginate(request.query);
    const values = [];
    const clauses = [];
    const q = text(request.query.q, 120);
    const status = text(request.query.status, 30);
    if (q) { clauses.push(`(g.name ILIKE ${param(values, `%${q}%`)} OR COALESCE(g.description,'') ILIKE $${values.length})`); }
    if (status) clauses.push(`g.status = ${param(values, status)}`);
    if (request.query.active === "true") clauses.push("g.is_active = TRUE");
    if (request.query.active === "false") clauses.push("g.is_active = FALSE");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = await pool.query(`SELECT COUNT(*)::int AS count FROM gotras g ${where}`, values);
    const rows = await pool.query(
      `SELECT g.id::text, g.name, COALESCE(g.description,'') AS description, g.status,
              g.is_active AS "isActive", g.created_at::text AS "createdAt",
              (SELECT COUNT(*) FROM family_trees t WHERE t.gotra_id = g.id)::int AS "treeCount",
              (SELECT COUNT(*) FROM gotra_members m WHERE m.gotra_id = g.id)::int AS "memberCount"
         FROM gotras g ${where} ORDER BY g.name LIMIT ${limit} OFFSET ${offset}`,
      values
    );
    response.json({ gotras: rows.rows, total: total.rows[0].count, limit, offset });
  }));

  app.post(`${PREFIX}/gotras`, ...edit("gotras"), wrap(async (request, response) => {
    const name = text(request.body?.name, 120);
    if (!name) return response.status(400).json({ error: "Gotra name is required." });
    const description = text(request.body?.description, 500);
    const isActive = asBool(request.body?.isActive, true);
    const duplicate = await pool.query(
      "SELECT id FROM gotras WHERE lower(btrim(name)) = lower(btrim($1))", [name]
    );
    if (duplicate.rowCount) return response.status(409).json({ error: "A Gotra with this name already exists." });
    const result = await pool.query(
      `INSERT INTO gotras (name, normalized_name, description, is_active, status, created_by)
       VALUES ($1, regexp_replace(lower(btrim($2)), '\s+', ' ', 'g'), $3, $4, 'verified', $5)
       RETURNING id::text, name, status, is_active AS "isActive"`,
      [name, name, description, isActive, request.admin.id]
    );
    await logAdminAction(request, "create_gotra", "gotra", result.rows[0].id, { name, isActive });
    await notify(request, { title: " Gotra created", body: `${name} was added to the directory.`, type: "success", linkUrl: "/admin.html#gotras" });
    response.status(201).json({ gotra: result.rows[0], message: locale(request, "गोत्र जोड़ा गया।", "Gotra created.") });
  }));

  app.patch(`${PREFIX}/gotras/:id`, ...edit("gotras"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    if (!id) return response.status(404).json({ error: "Gotra not found." });
    const existing = await pool.query("SELECT * FROM gotras WHERE id = $1", [id]);
    if (!existing.rowCount) return response.status(404).json({ error: "Gotra not found." });
    const name = text(request.body?.name, 120) || existing.rows[0].name;
    const duplicate = await pool.query(
      "SELECT id FROM gotras WHERE lower(btrim(name)) = lower(btrim($1)) AND id <> $2", [name, id]
    );
    if (duplicate.rowCount) return response.status(409).json({ error: "A Gotra with this name already exists." });
    const status = ["draft", "verified"].includes(text(request.body?.status)) ? text(request.body.status, 20) : existing.rows[0].status;
    const result = await pool.query(
      `UPDATE gotras SET name=$1, normalized_name=regexp_replace(lower(btrim($1)), '\s+', ' ', 'g'),
              description=$2, is_active=$3, status=$4, updated_at=NOW()
        WHERE id=$5 RETURNING id::text, name, status, is_active AS "isActive"`,
      [name, text(request.body?.description, 500), asBool(request.body?.isActive, existing.rows[0].is_active), status, id]
    );
    await logAdminAction(request, "update_gotra", "gotra", id, request.body);
    response.json({ gotra: result.rows[0], message: locale(request, "गोत्र अद्यतन किया गया।", "Gotra updated.") });
  }));

  app.delete(`${PREFIX}/gotras/:id`, ...edit("gotras"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    const used = await pool.query("SELECT COUNT(*)::int AS count FROM family_trees WHERE gotra_id = $1", [id]);
    if (used.rows[0].count > 0) {
      return response.status(409).json({ error: "This Gotra has family trees. Deactivate it instead of deleting it." });
    }
    const result = await pool.query("DELETE FROM gotras WHERE id = $1", [id]);
    if (!result.rowCount) return response.status(404).json({ error: "Gotra not found." });
    await logAdminAction(request, "delete_gotra", "gotra", id, null, "warning");
    response.json({ message: locale(request, "गोत्र हटाया गया।", "Gotra deleted.") });
  }));

  /* ── Samiti directory ───────────────────────────────────────────────── */

  const SAMITI_COLUMNS = `
    id::text, name, COALESCE(description,'') AS description,
    is_active AS "isActive", sort_order AS "sortOrder",
    created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;
  const SAMITI_MEMBER_COLUMNS = `
    id::text, samiti_id::text AS "samitiId", name, position,
    is_president AS "isPresident", COALESCE(photo_data,'') AS "photoUrl",
    COALESCE(photo_mime,'') AS "photoMime", sort_order AS "sortOrder",
    is_active AS "isActive", created_at::text AS "createdAt",
    updated_at::text AS "updatedAt"`;

  /* Public read.  Deliberately outside the /api/admin gate and intentionally
     narrow: published samitis, their published members, and no audit data. */
  app.get("/api/samiti", wrap(async (_request, response) => {
    const result = await pool.query(`
      SELECT g.id::text AS "samitiId", g.name AS "samitiName",
             COALESCE(g.description,'') AS "samitiDescription",
             m.id::text, m.name, m.position, m.is_president AS "isPresident",
             m.photo_data AS "photoUrl", m.sort_order AS "sortOrder"
        FROM samitis g
        LEFT JOIN samiti_members m ON m.samiti_id = g.id AND m.is_active = TRUE
       WHERE g.is_active = TRUE
       ORDER BY g.sort_order, lower(g.name), m.is_president DESC, m.sort_order, lower(m.name)`);
    const samitis = new Map();
    result.rows.forEach(row => {
      if (!samitis.has(row.samitiId)) {
        samitis.set(row.samitiId, {
          id: row.samitiId, name: row.samitiName,
          description: row.samitiDescription || "", members: [],
        });
      }
      if (!row.id) return;
      samitis.get(row.samitiId).members.push({
        id: row.id, name: row.name, position: row.position,
        isPresident: row.isPresident, photoUrl: row.photoUrl || null,
        sortOrder: row.sortOrder,
      });
    });
    response.set("Cache-Control", "public, max-age=300");
    response.json({ samitis: [...samitis.values()] });
  }));

  app.get(`${PREFIX}/samiti`, ...view("samiti"), wrap(async (_request, response) => {
    const [groups, members] = await Promise.all([
      pool.query(`SELECT ${SAMITI_COLUMNS} FROM samitis ORDER BY sort_order, lower(name)`),
      pool.query(`SELECT ${SAMITI_MEMBER_COLUMNS} FROM samiti_members ORDER BY sort_order, lower(name)`),
    ]);
    response.json({ samitis: groups.rows, members: members.rows });
  }));

  async function samitiById(id) {
    if (!id) return null;
    const result = await pool.query("SELECT * FROM samitis WHERE id = $1", [id]);
    return result.rows[0] || null;
  }

  async function rejectSecondPresident(request, response, samitiId, memberId, samitiName) {
    const query = memberId
      ? "SELECT id FROM samiti_members WHERE samiti_id = $1 AND is_president = TRUE AND is_active = TRUE AND id <> $2"
      : "SELECT id FROM samiti_members WHERE samiti_id = $1 AND is_president = TRUE AND is_active = TRUE";
    const existing = await pool.query(query, memberId ? [samitiId, memberId] : [samitiId]);
    if (existing.rowCount) {
      response.status(409).json({
        error: locale(request,
          `${samitiName || "इस समिति"} में पहले से एक अध्यक्ष प्रकाशित है। उसे बदलने के लिए पुराने अध्यक्ष को संपादित करें।`,
          `An active president is already published in ${samitiName || "this samiti"}. Edit the existing president to replace them.`
        ),
      });
      return true;
    }
    return false;
  }

  /* ── Samiti entities: add, rename, publish, delete ───────────────────── */

  app.post(`${PREFIX}/samiti`, ...edit("samiti"), wrap(async (request, response) => {
    const name = text(request.body?.name, 160);
    if (!name) return response.status(400).json({ error: "Samiti name is required." });
    const description = text(request.body?.description, 500);
    const isActive = asBool(request.body?.isActive, true);
    const result = await pool.query(
      `INSERT INTO samitis (name, description, is_active, sort_order, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING ${SAMITI_COLUMNS}`,
      [name, description || null, isActive, samitiSort(request.body?.sortOrder), request.admin.id]
    );
    const samiti = result.rows[0];
    await logAdminAction(request, "create_samiti", "samiti", samiti.id, { name, isActive });
    response.status(201).json({ samiti, message: locale(request, "समिति जोड़ी गई।", "Samiti created.") });
  }));

  app.patch(`${PREFIX}/samiti/:id`, ...edit("samiti"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    const current = id ? await samitiById(id) : null;
    if (!current) return response.status(404).json({ error: "Samiti not found." });
    const name = text(request.body?.name, 160) || current.name;
    const description = request.body?.description !== undefined
      ? text(request.body.description, 500) : current.description;
    const isActive = asBool(request.body?.isActive, current.is_active);
    const result = await pool.query(
      `UPDATE samitis SET name=$1, description=$2, is_active=$3, sort_order=$4,
              updated_by=$5, updated_at=NOW() WHERE id=$6 RETURNING ${SAMITI_COLUMNS}`,
      [name, description || null, isActive,
       samitiSort(request.body?.sortOrder, current.sort_order), request.admin.id, id]
    );
    await logAdminAction(request, "update_samiti", "samiti", id, { name, isActive });
    response.json({ samiti: result.rows[0], message: locale(request, "समिति अद्यतन की गई।", "Samiti updated.") });
  }));

  app.delete(`${PREFIX}/samiti/:id`, ...edit("samiti"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    if (!id) return response.status(404).json({ error: "Samiti not found." });
    const result = await pool.query("DELETE FROM samitis WHERE id = $1", [id]);
    if (!result.rowCount) return response.status(404).json({ error: "Samiti not found." });
    await logAdminAction(request, "delete_samiti", "samiti", id, null, "warning");
    response.json({ message: locale(request, "समिति और उसके सदस्य हटाए गए।", "Samiti and its members deleted.") });
  }));

  /* ── Members belong to one samiti; president uniqueness is per samiti ── */

  app.post(`${PREFIX}/samiti/:samitiId/members`, ...edit("samiti"), wrap(async (request, response) => {
    const samitiId = cid(request.params.samitiId);
    const samiti = await samitiById(samitiId);
    if (!samiti) return response.status(404).json({ error: "Samiti not found." });
    const name = text(request.body?.name, 120);
    if (!name) return response.status(400).json({ error: "Member name is required." });
    const position = text(request.body?.position, 120) || "Member";
    const isPresident = asBool(request.body?.isPresident, false);
    const isActive = asBool(request.body?.isActive, true);
    const photo = parsePhoto(request.body?.photo);
    if (photo.error) return response.status(400).json({ error: photo.error });
    if (isPresident && isActive && await rejectSecondPresident(request, response, samitiId, null, samiti.name)) return;

    const result = await pool.query(
      `INSERT INTO samiti_members
         (samiti_id, name, position, is_president, photo_data, photo_mime,
          sort_order, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING ${SAMITI_MEMBER_COLUMNS}`,
      [samitiId, name, position, isPresident, photo.url, photo.mime,
       samitiSort(request.body?.sortOrder), isActive, request.admin.id]
    );
    const member = result.rows[0];
    await logAdminAction(request, "create_samiti_member", "samiti_member", member.id,
      { samitiId, samitiName: samiti.name, name, position, isPresident, isActive, hasPhoto: Boolean(photo.url) });
    response.status(201).json({ member, message: locale(request, "समिति सदस्य जोड़ा गया।", "Samiti member created.") });
  }));

  app.patch(`${PREFIX}/samiti/:samitiId/members/:memberId`, ...edit("samiti"), wrap(async (request, response) => {
    const samitiId = cid(request.params.samitiId);
    const memberId = cid(request.params.memberId);
    if (!samitiId || !memberId) return response.status(404).json({ error: "Samiti member not found." });
    const existing = await pool.query(
      "SELECT * FROM samiti_members WHERE id = $1 AND samiti_id = $2", [memberId, samitiId]
    );
    if (!existing.rowCount) return response.status(404).json({ error: "Samiti member not found." });
    const current = existing.rows[0];
    const targetId = cid(request.body?.samitiId) || samitiId;
    const target = await samitiById(targetId);
    if (!target) return response.status(404).json({ error: "Samiti not found." });
    const name = text(request.body?.name, 120) || current.name;
    const position = text(request.body?.position, 120) || current.position || "Member";
    const isPresident = asBool(request.body?.isPresident, current.is_president);
    const isActive = asBool(request.body?.isActive, current.is_active);
    if (isPresident && isActive && await rejectSecondPresident(request, response, targetId, memberId, target.name)) return;

    let photoUrl = current.photo_data || null;
    let photoMime = current.photo_mime || null;
    if (asBool(request.body?.removePhoto, false)) {
      photoUrl = null;
      photoMime = null;
    } else if (request.body?.photo !== undefined && String(request.body.photo).trim()) {
      const photo = parsePhoto(request.body.photo);
      if (photo.error) return response.status(400).json({ error: photo.error });
      photoUrl = photo.url;
      photoMime = photo.mime;
    }

    const updates = [];
    const values = [];
    const put = (column, value) => updates.push(`${column} = ${param(values, value)}`);
    put("samiti_id", targetId);
    put("name", name);
    put("position", position);
    put("is_president", isPresident);
    put("photo_data", photoUrl);
    put("photo_mime", photoMime);
    put("sort_order", samitiSort(request.body?.sortOrder, current.sort_order));
    put("is_active", isActive);
    put("updated_by", request.admin.id);
    put("updated_at", new Date());
    values.push(memberId);
    const result = await pool.query(
      `UPDATE samiti_members SET ${updates.join(", ")} WHERE id = $${values.length}
       RETURNING ${SAMITI_MEMBER_COLUMNS}`, values
    );
    await logAdminAction(request, "update_samiti_member", "samiti_member", memberId,
      { samitiId: targetId, samitiName: target.name, name, position, isPresident, isActive,
        hasPhoto: Boolean(photoUrl), photoRemoved: asBool(request.body?.removePhoto, false) });
    response.json({ member: result.rows[0], message: locale(request, "समिति सदस्य अद्यतन किया गया।", "Samiti member updated.") });
  }));

  app.delete(`${PREFIX}/samiti/:samitiId/members/:memberId`, ...edit("samiti"), wrap(async (request, response) => {
    const samitiId = cid(request.params.samitiId);
    const memberId = cid(request.params.memberId);
    if (!samitiId || !memberId) return response.status(404).json({ error: "Samiti member not found." });
    const result = await pool.query(
      "DELETE FROM samiti_members WHERE id = $1 AND samiti_id = $2", [memberId, samitiId]
    );
    if (!result.rowCount) return response.status(404).json({ error: "Samiti member not found." });
    await logAdminAction(request, "delete_samiti_member", "samiti_member", memberId, { samitiId }, "warning");
    response.json({ message: locale(request, "समिति सदस्य हटाया गया।", "Samiti member deleted.") });
  }));

  /* ── Complete family tree management ────────────────────────────────── */

  app.get(`${PREFIX}/trees`, ...view("trees"), wrap(async (request, response) => {
    const { limit, offset } = paginate(request.query);
    const values = [];
    const clauses = ["t.deleted_at IS NULL"];
    const q = text(request.query.q, 120);
    const status = text(request.query.status, 30);
    const gotraId = cid(request.query.gotraId);
    const village = text(request.query.village, 120);
    if (q) clauses.push(`(${ROOT_NAME_SQL} ILIKE ${param(values, `%${q}%`)} OR t.tree_reference ILIKE $${values.length} OR t.submitters_name ILIKE $${values.length})`.replace("submitters_name", "submitter_name"));
    if (status) clauses.push(`t.status = ${param(values, status)}`);
    if (gotraId) clauses.push(`t.gotra_id = ${param(values, gotraId)}`);
    if (village) clauses.push(`lower(btrim(t.village)) = lower(btrim(${param(values, village)}))`);
    const where = clauses.join(" AND ");
    const total = await pool.query(
      `SELECT COUNT(*)::int AS count FROM family_trees t
        LEFT JOIN gotras g ON g.id = t.gotra_id
        LEFT JOIN people p ON p.id = t.root_person_id WHERE ${where}`, values
    );
    const rows = await pool.query(
      `SELECT t.id::text, t.tree_reference AS "treeReference", g.name AS gotra,
              ${ROOT_NAME_SQL} AS "rootName", COALESCE(t.village,'') AS village,
              t.status, t.revision_number AS "revisionNumber", t.submitted_at::text AS "submittedAt",
              t.verified_at::text AS "verifiedAt", t.review_notes AS "reviewNotes",
              (SELECT COUNT(*) FROM people p2 WHERE p2.family_tree_id = t.id)::int AS "memberCount"
         FROM family_trees t LEFT JOIN gotras g ON g.id = t.gotra_id
         LEFT JOIN people p ON p.id = t.root_person_id
        WHERE ${where} ORDER BY COALESCE(t.submitted_at, t.created_at) DESC
        LIMIT ${limit} OFFSET ${offset}`, values
    );
    response.json({ trees: rows.rows, total: total.rows[0].count, limit, offset });
  }));

  app.get(`${PREFIX}/trees/:id`, ...view("trees"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    const result = await pool.query(
      `SELECT t.*, t.gotra_id::text AS "gotraId", g.name AS gotra, ${ROOT_NAME_SQL} AS "rootName",
              a.email AS "reviewerEmail", va.assigned_at::text AS "assignedAt", va.due_at::text AS "dueAt"
         FROM family_trees t LEFT JOIN gotras g ON g.id = t.gotra_id
         LEFT JOIN people p ON p.id = t.root_person_id
         LEFT JOIN admins a ON a.id = t.reviewed_by
         LEFT JOIN verification_assignments va ON va.family_tree_id = t.id
        WHERE t.id = $1`, [id]
    );
    const tree = result.rows[0];
    if (!tree) return response.status(404).json({ error: "Tree not found." });
    const [revisions, verifications, links, members] = await Promise.all([
      pool.query(`SELECT id::text, revision_number AS "revisionNumber", note, created_at::text AS "createdAt" FROM family_tree_revisions WHERE family_tree_id=$1 ORDER BY revision_number DESC`, [id]),
      pool.query(`SELECT id::text, decision, remarks, created_at::text AS "createdAt", admin_id::text AS "adminId" FROM verification_records WHERE family_tree_id=$1 ORDER BY created_at DESC`, [id]),
      pool.query(`SELECT id::text, status, notes, created_at::text AS "createdAt" FROM tree_links WHERE source_tree_id=$1 OR target_tree_id=$1 ORDER BY created_at DESC`, [id]),
      pool.query(`SELECT id::text, public_id AS "publicId", full_name AS name, member_type AS "memberType", wife_name AS "wifeName", wife_gotra AS "wifeGotra", married_gotra AS "marriedGotra", village, status FROM people WHERE family_tree_id=$1 ORDER BY birth_order, full_name`, [id]),
    ]);
    response.json({
      tree,
      members: tree.current_revision || [],
      people: members.rows,
      revisions: revisions.rows,
      verifications: verifications.rows,
      links: links.rows,
    });
  }));

  app.patch(`${PREFIX}/trees/:id`, ...edit("trees"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    if (!id) return response.status(404).json({ error: "Tree not found." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM family_trees WHERE id=$1 FOR UPDATE", [id]);
      const oldTree = found.rows[0];
      if (!oldTree) { await client.query("ROLLBACK"); return response.status(404).json({ error: "Tree not found." }); }

      /* Verified trees are read-only unless an admin explicitly opens a
         revision. The revision path below keeps the original snapshot and
         returns the tree to verification; accidental PATCHes are rejected. */
      const revisionFields = ["currentRevision", "village", "district", "state", "submitterName", "gotraId"];
      const changesVerifiedValues = revisionFields.some(field => request.body?.[field] !== undefined);
      if (oldTree.status === "verified" && changesVerifiedValues && !asBool(request.body?.revisionIntent, false)) {
        await client.query("ROLLBACK");
        return response.status(409).json({
          error: locale(request,
            "यह वृक्ष सत्यापित है। संशोधन खोलने के लिए revisionIntent सहित अनुरोध भेजें; इससे पुनः सत्यापन होगा।",
            "This tree is verified. Open a revision with revisionIntent to edit it; re-verification will be required."),
        });
      }

      let nextRevision = oldTree.current_revision;
      if (request.body?.currentRevision !== undefined) {
        const checked = vsh.validateTreeMembers(request.body.currentRevision);
        if (!checked.valid) {
          await client.query("ROLLBACK");
          return response.status(400).json({ error: `Invalid tree members: ${checked.error}` });
        }
        nextRevision = checked.members;
      }
      const updates = [];
      const values = [];
      const put = (expression, value) => updates.push(`${expression} = ${param(values, value)}`);
      if (request.body?.village !== undefined) put("village", text(request.body.village, 120));
      if (request.body?.district !== undefined) put("district", text(request.body.district, 120));
      if (request.body?.state !== undefined) put("state", text(request.body.state, 120));
      if (request.body?.submitterName !== undefined) put("submitter_name", text(request.body.submitterName, 120));
      if (request.body?.reviewNotes !== undefined) put("review_notes", text(request.body.reviewNotes, 500));
      if (cid(request.body?.gotraId)) put("gotra_id", cid(request.body.gotraId));
      put("current_revision", JSON.stringify(nextRevision));
      put("revision_number", Number(oldTree.revision_number) + 1);
      put("updated_at", new Date());

      const becomesUnverified = oldTree.status === "verified";
      if (becomesUnverified) {
        updates.push("status = 'under_review'");
        updates.push("verified_at = NULL");
      }

      await client.query(
        `INSERT INTO family_tree_revisions (family_tree_id, revision_number, revision, snapshot, editor_admin_id, note)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (family_tree_id, revision_number) DO NOTHING`,
        [id, Number(oldTree.revision_number) + 1, JSON.stringify(nextRevision),
          JSON.stringify({ village: oldTree.village, status: oldTree.status, revision: oldTree.current_revision }),
          request.admin.id, text(request.body?.note, 300) || null]
      );
      const updated = await client.query(
        `UPDATE family_trees SET ${updates.join(", ")} WHERE id=${param(values, id)} RETURNING id::text, status, revision_number AS "revisionNumber"`,
        values
      );
      if (becomesUnverified) {
        await client.query(
          `INSERT INTO verification_records (family_tree_id, revision_number, admin_id, decision, remarks)
           VALUES ($1,$2,$3,'under_review',$4)`,
          [id, Number(oldTree.revision_number) + 1, request.admin.id,
            text(request.body?.note, 500) || "Verified tree changed; re-verification required."]
        );
      }
      await logAudit(client, request.admin.id, "admin_edit_tree", "family_tree", id,
        { note: text(request.body?.note, 300), revisionNumber: Number(oldTree.revision_number) + 1 });
      await client.query("COMMIT");
      await notify(request, {
        title: becomesUnverified ? "Verified tree requires re-verification" : "Family tree updated",
        body: `${oldTree.tree_reference} was changed by ${request.admin.email}.`,
        type: becomesUnverified ? "warning" : "info",
        linkUrl: `/admin.html#verification`,
      });
      response.json({ tree: updated.rows[0], message: locale(request, "वृक्ष अद्यतन हुआ; संस्करण सहेजा गया।", "Tree updated and revision saved.") });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }));

  app.post(`${PREFIX}/trees/:id/archive`, ...edit("trees"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    const result = await pool.query(
      "UPDATE family_trees SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL", [id]
    );
    if (!result.rowCount) return response.status(404).json({ error: "Tree not found or already archived." });
    await logAdminAction(request, "archive_tree", "family_tree", id, null, "warning");
    response.json({ message: locale(request, "वृक्ष संग्रहीत किया गया।", "Tree archived.") });
  }));

  app.post(`${PREFIX}/trees/:id/restore`, ...edit("trees"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    const result = await pool.query("UPDATE family_trees SET deleted_at=NULL, updated_at=NOW() WHERE id=$1", [id]);
    if (!result.rowCount) return response.status(404).json({ error: "Tree not found." });
    await logAdminAction(request, "restore_tree", "family_tree", id);
    response.json({ message: "Tree restored." });
  }));

  app.delete(`${PREFIX}/trees/:id`, ...edit("trees"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    const found = await pool.query("SELECT status FROM family_trees WHERE id=$1", [id]);
    if (!found.rowCount) return response.status(404).json({ error: "Tree not found." });
    if (!["draft", "pending"].includes(found.rows[0].status)) {
      return response.status(409).json({ error: "Only draft or pending trees can be deleted." });
    }
    await pool.query("DELETE FROM family_trees WHERE id=$1", [id]);
    await logAdminAction(request, "delete_tree", "family_tree", id, null, "warning");
    response.json({ message: "Tree deleted." });
  }));

  app.get(`${PREFIX}/trees/:id/revisions`, ...view("trees"), wrap(async (request, response) => {
    const result = await pool.query(
      `SELECT r.id::text, r.revision_number AS "revisionNumber", r.revision, r.snapshot,
              r.note, r.created_at::text AS "createdAt", a.email AS editor
         FROM family_tree_revisions r LEFT JOIN admins a ON a.id = r.editor_admin_id
        WHERE r.family_tree_id=$1 ORDER BY r.revision_number DESC`, [cid(request.params.id)]
    );
    response.json({ revisions: result.rows });
  }));

  /* ── Individual member management ──────────────────────────────────── */

  app.get(`${PREFIX}/members`, ...view("members"), wrap(async (request, response) => {
    const { limit, offset } = paginate(request.query);
    const values = [];
    const clauses = ["p.status <> 'archived'"];
    const q = text(request.query.q, 120);
    const treeId = cid(request.query.treeId);
    const gotraId = cid(request.query.gotraId);
    const memberType = text(request.query.memberType, 30);
    if (q) clauses.push(`(p.full_name ILIKE ${param(values, `%${q}%`)} OR p.public_id ILIKE $${values.length} OR COALESCE(p.village,'') ILIKE $${values.length})`);
    if (treeId) clauses.push(`p.family_tree_id = ${param(values, treeId)}`);
    if (gotraId) clauses.push(`t.gotra_id = ${param(values, gotraId)}`);
    if (memberType) clauses.push(`p.member_type = ${param(values, memberType)}`);
    const where = clauses.join(" AND ");
    const total = await pool.query(
      `SELECT COUNT(*)::int AS count FROM people p LEFT JOIN family_trees t ON t.id=p.family_tree_id WHERE ${where}`, values
    );
    const rows = await pool.query(
      `SELECT p.id::text, p.public_id AS "publicId", p.full_name AS name,
              COALESCE(p.wife_name,'') AS "wifeName", COALESCE(p.wife_gotra,'') AS "wifeGotra",
              COALESCE(p.married_gotra,'') AS "marriedGotra", COALESCE(p.village,'') AS village,
              COALESCE(p.member_type,'') AS "memberType", p.status, p.visibility,
              t.tree_reference AS "treeReference", t.id::text AS "treeId", t.status AS "treeStatus",
              g.name AS gotra,
              (SELECT COUNT(*) FROM person_relationships r WHERE r.parent_id=p.id)::int AS children
         FROM people p LEFT JOIN family_trees t ON t.id=p.family_tree_id
         LEFT JOIN gotras g ON g.id=t.gotra_id
        WHERE ${where} ORDER BY p.full_name LIMIT ${limit} OFFSET ${offset}`, values
    );
    response.json({ members: rows.rows, total: total.rows[0].count, limit, offset });
  }));

  app.get(`${PREFIX}/members/:id`, ...view("members"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    const found = await pool.query(
      `SELECT p.*, g.name AS gotra, t.tree_reference AS "treeReference", t.id::text AS "treeId",
              t.status AS "treeStatus"
         FROM people p LEFT JOIN family_trees t ON t.id=p.family_tree_id
         LEFT JOIN gotras g ON g.id=t.gotra_id WHERE p.id=$1`, [id]
    );
    const person = found.rows[0];
    if (!person) return response.status(404).json({ error: "Member not found." });
    const [parents, children, branches] = await Promise.all([
      pool.query(`SELECT p.id::text, p.full_name AS name, r.relation_type AS "relationType" FROM person_relationships r JOIN people p ON p.id=r.parent_id WHERE r.child_id=$1`, [id]),
      pool.query(`SELECT p.id::text, p.full_name AS name, r.relation_type AS "relationType" FROM person_relationships r JOIN people p ON p.id=r.child_id WHERE r.parent_id=$1`, [id]),
      pool.query(`SELECT b.id::text, b.name, g.name AS gotra FROM person_gotra_links l JOIN family_branches b ON b.id=l.branch_id LEFT JOIN gotras g ON g.id=b.gotra_id WHERE l.person_id=$1`, [id]),
    ]);
    response.json({ person, parents: parents.rows, children: children.rows, branches: branches.rows });
  }));

  app.patch(`${PREFIX}/members/:id`, ...edit("members"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        `SELECT p.*, t.id AS tree_id, t.status AS tree_status, t.current_revision, t.revision_number
           FROM people p LEFT JOIN family_trees t ON t.id=p.family_tree_id
          WHERE p.id=$1 FOR UPDATE OF p`, [id]
      );
      const person = found.rows[0];
      if (!person) { await client.query("ROLLBACK"); return response.status(404).json({ error: "Member not found." }); }
      const valueFields = ["fullName", "wifeName", "wifeGotra", "marriedGotra", "village", "birthYear", "deathYear", "memberType"];
      const changesVerifiedValues = valueFields.some(field => request.body?.[field] !== undefined);
      if (person.tree_status === "verified" && changesVerifiedValues && !asBool(request.body?.revisionIntent, false)) {
        await client.query("ROLLBACK");
        return response.status(409).json({
          error: locale(request,
            "यह सदस्य सत्यापित वृक्ष का हिस्सा है। संशोधन खोलने के लिए revisionIntent सहित अनुरोध भेजें; इससे पुनः सत्यापन होगा।",
            "This member belongs to a verified tree. Open a revision with revisionIntent to edit it; re-verification will be required."),
        });
      }
      if (text(request.body?.memberType) === "daughter" && text(request.body?.fullName || person.full_name)) {
        /* Daughters remain name-only; spouse/village details are intentionally
           not rendered for daughter nodes in the tree UI. */
      }
      const updates = [];
      const values = [];
      const put = (expression, value) => updates.push(`${expression} = ${param(values, value)}`);
      if (request.body?.fullName !== undefined) put("full_name", text(request.body.fullName, 160));
      if (request.body?.wifeName !== undefined) put("wife_name", text(request.body.wifeName, 160));
      if (request.body?.wifeGotra !== undefined) put("wife_gotra", text(request.body.wifeGotra, 120));
      if (request.body?.marriedGotra !== undefined) put("married_gotra", text(request.body.marriedGotra, 120));
      if (request.body?.village !== undefined) put("village", text(request.body.village, 120));
      if (request.body?.birthYear !== undefined) put("birth_year", text(request.body.birthYear, 20));
      if (request.body?.deathYear !== undefined) put("death_year", text(request.body.deathYear, 20));
      if (["root", "son", "daughter"].includes(text(request.body?.memberType))) put("member_type", text(request.body.memberType, 20));
      if (["draft", "pending", "verified", "archived"].includes(text(request.body?.status))) put("status", text(request.body.status, 20));
      if (["public", "members", "private"].includes(text(request.body?.visibility))) put("visibility", text(request.body.visibility, 20));
      if (!updates.length) { await client.query("ROLLBACK"); return response.status(400).json({ error: "No updates provided." }); }
      put("updated_by", request.admin.id);
      put("updated_at", new Date());
      const updated = await client.query(`UPDATE people SET ${updates.join(", ")} WHERE id=${param(values, id)} RETURNING id::text, full_name AS name, status`, values);

      if (person.tree_id && person.tree_status === "verified") {
        /* Rebuild the proposed revision from canonical people + verified
           relationships so re-approval materialises the edited values. */
        const peopleRows = await client.query(
          `SELECT id::text AS "clientId", full_name AS name, wife_name AS "wifeName",
                  wife_gotra AS "wifeGotra", married_gotra AS "marriedGotra",
                  village, member_type AS "memberType", birth_order AS "birthOrder"
             FROM people WHERE family_tree_id=$1 AND status <> 'archived'
            ORDER BY birth_order NULLS LAST, full_name`, [person.tree_id]
        );
        const relationRows = await client.query(
          `SELECT c.id::text AS "childId", p.id::text AS "parentId"
             FROM person_relationships r JOIN people c ON c.id=r.child_id
             JOIN people p ON p.id=r.parent_id
            WHERE r.status='verified' AND c.family_tree_id=$1 AND p.family_tree_id=$1`, [person.tree_id]
        );
        const latest = await client.query("SELECT revision_number FROM family_trees WHERE id=$1", [person.tree_id]);
        const parentByChild = new Map(relationRows.rows.map(row => [row.childId, row.parentId]));
        const nextRevision = peopleRows.rows.map(row => {
          const member = {
            clientId: row.clientId,
            parentId: parentByChild.get(row.clientId) || null,
            memberType: row.memberType,
            name: row.name,
          };
          if (row.memberType !== "daughter") {
            member.wifeName = row.wifeName || "";
            member.village = row.village || "";
          }
          if (row.birthOrder !== null && row.birthOrder !== undefined) member.birthOrder = row.birthOrder;
          return member;
        });
        await client.query(
          `UPDATE family_trees SET current_revision=$2::jsonb, revision_number=$3,
                  status='under_review', verified_at=NULL, updated_at=NOW() WHERE id=$1`,
          [person.tree_id, JSON.stringify(nextRevision), latest.rows[0].revision_number]
        );
        await client.query(
          `INSERT INTO family_tree_revisions (family_tree_id, revision_number, revision, snapshot, editor_admin_id, note)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [person.tree_id, latest.rows[0].revision_number, JSON.stringify(nextRevision),
            JSON.stringify({ currentRevision: person.current_revision || [], personId: id, action: "member_edit" }),
            request.admin.id, "Member edit triggered re-verification"]
        );
        await client.query(
          `INSERT INTO verification_records (family_tree_id, revision_number, admin_id, decision, remarks)
           VALUES ($1,$2,$3,'under_review',$4)`,
          [person.tree_id, latest.rows[0].revision_number, request.admin.id, "Verified record changed by member edit."]
        );
      }
      await logAudit(client, request.admin.id, "admin_edit_member", "person", id, request.body);
      await client.query("COMMIT");
      await notify(request, { title: "Member record updated", body: `${updated.rows[0].name} was edited.`, type: "info", linkUrl: "/admin.html#members" });
      response.json({ person: updated.rows[0], message: "Member updated." });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }));

  app.post(`${PREFIX}/members/:id/archive`, ...edit("members"), wrap(async (request, response) => {
    const id = cid(request.params.id);
    const result = await pool.query(
      "UPDATE people SET status='archived', updated_by=$1, updated_at=NOW() WHERE id=$2", [request.admin.id, id]
    );
    if (!result.rowCount) return response.status(404).json({ error: "Member not found." });
    await logAdminAction(request, "archive_member", "person", id, null, "warning");
    response.json({ message: "Member archived." });
  }));

  app.put(`${PREFIX}/members/:id/branch`, ...edit("members"), wrap(async (request, response) => {
    const personId = cid(request.params.id);
    const branchId = cid(request.body?.branchId);
    const person = await pool.query("SELECT id, full_name FROM people WHERE id=$1", [personId]);
    if (!person.rowCount) return response.status(404).json({ error: "Member not found." });
    if (!branchId) {
      await pool.query("UPDATE person_gotra_links SET branch_id=NULL WHERE person_id=$1", [personId]);
    } else {
      const branch = await pool.query("SELECT id, gotra_id FROM family_branches WHERE id=$1", [branchId]);
      if (!branch.rowCount) return response.status(404).json({ error: "Branch not found." });
      const existing = await pool.query("SELECT id FROM person_gotra_links WHERE person_id=$1 AND gotra_id=$2", [personId, branch.rows[0].gotra_id]);
      if (existing.rowCount) {
        await pool.query("UPDATE person_gotra_links SET branch_id=$1 WHERE id=$2", [branchId, existing.rows[0].id]);
      } else {
        await pool.query("INSERT INTO person_gotra_links (person_id, gotra_id, branch_id) VALUES ($1,$2,$3)", [personId, branch.rows[0].gotra_id, branchId]);
      }
    }
    await logAdminAction(request, branchId ? "assign_branch" : "unassign_branch", "person", personId, { branchId });
    response.json({ message: branchId ? "Branch assigned." : "Branch unassigned." });
  }));

  /* ── Verification workflow ─────────────────────────────────────────── */

  app.get(`${PREFIX}/verification/queue`, ...view("verification"), wrap(async (request, response) => {
    const { limit, offset } = paginate(request.query, 50);
    const values = [];
    const clauses = ["t.deleted_at IS NULL"];
    const status = text(request.query.status, 30) || "pending";
    clauses.push(`t.status = ${param(values, status)}`);
    if (cid(request.query.gotraId)) clauses.push(`t.gotra_id = ${param(values, cid(request.query.gotraId))}`);
    if (cid(request.query.adminId)) clauses.push(`va.admin_id = ${param(values, cid(request.query.adminId))}`);
    const where = clauses.join(" AND ");
    const total = await pool.query(
      `SELECT COUNT(*)::int AS count FROM family_trees t
        LEFT JOIN verification_assignments va ON va.family_tree_id=t.id WHERE ${where}`, values
    );
    const rows = await pool.query(
      `SELECT t.id::text, t.tree_reference AS "treeReference", g.name AS gotra,
              ${ROOT_NAME_SQL} AS "rootName", t.village, t.status,
              t.submitted_at::text AS "submittedAt", t.revision_number AS "revisionNumber",
              a.email AS "assignedTo", va.due_at::text AS "dueAt"
         FROM family_trees t LEFT JOIN gotras g ON g.id=t.gotra_id
         LEFT JOIN people p ON p.id=t.root_person_id
         LEFT JOIN verification_assignments va ON va.family_tree_id=t.id
         LEFT JOIN admins a ON a.id=va.admin_id
        WHERE ${where} ORDER BY t.submitted_at ASC LIMIT ${limit} OFFSET ${offset}`, values
    );
    response.json({ queue: rows.rows, total: total.rows[0].count, limit, offset });
  }));

  app.post(`${PREFIX}/verification/:id/assign`, ...approve("verification"), wrap(async (request, response) => {
    const treeId = cid(request.params.id);
    const adminId = cid(request.body?.adminId);
    if (!treeId || !adminId) return response.status(400).json({ error: "Tree and reviewer are required." });
    const dueAt = Number.isNaN(Date.parse(request.body?.dueAt)) ? null : new Date(request.body.dueAt);
    await pool.query(
      `INSERT INTO verification_assignments (family_tree_id, admin_id, assigned_by, due_at, notes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (family_tree_id) DO UPDATE SET admin_id=EXCLUDED.admin_id, assigned_by=EXCLUDED.assigned_by,
         due_at=EXCLUDED.due_at, notes=EXCLUDED.notes, assigned_at=NOW()`,
      [treeId, adminId, request.admin.id, dueAt, text(request.body?.notes, 300) || null]
    );
    await logAdminAction(request, "assign_verification", "family_tree", treeId, { adminId });
    await notify(request, { title: "Verification assigned", body: "A tree was assigned to you for review.", type: "info", adminId, linkUrl: "/admin.html#verification" });
    response.json({ message: "Reviewer assigned." });
  }));

  /* Reuse the exact verification/materialisation handler from the original
     Vanshawali module — business rules must never be duplicated. */
  app.post(`${PREFIX}/verification/:id/decision`, ...approve("verification"), wrap(async (request, response) => {
    if (!decisionHandler) {
      return response.status(503).json({
        error: locale(request, "सत्यापन सेवा उपलब्ध नहीं है।", "Verification service is unavailable."),
      });
    }
    const decision = text(request.body?.decision, 40);
    if (!["approve", "under_review", "correction_required", "reject"].includes(decision)) {
      return response.status(400).json({ error: locale(request, "अमान्य निर्णय।", "Invalid decision.") });
    }
    try {
      await logAdminAction(request, "console_verification_decision", "family_tree", cid(request.params.id), request.body);
    } catch (error) {
      /* The decision itself is more important than an audit row; the shared
         handler writes its own genealogy audit inside the same transaction. */
      console.error("[admin-console] decision audit failed:", error?.message || error);
    }
    /* Non-blocking schema probe: if the deployed DB is missing a column that
       materialisation needs, name it in the failure response. */
    let schemaNote = null;
    try {
      const required = [
        "people.wife_name", "people.wife_gotra", "people.married_gotra",
        "people.member_type", "people.birth_order", "people.family_tree_id",
        "family_trees.current_revision", "family_trees.revision_number", "family_trees.root_person_id",
      ];
      const probe = await pool.query(
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND ((table_name = 'people' AND column_name IN ('wife_name','wife_gotra','married_gotra','member_type','birth_order','family_tree_id'))
              OR (table_name = 'family_trees' AND column_name IN ('current_revision','revision_number','root_person_id')))`
      );
      const present = new Set((probe.rows || []).map(row => `${row.table_name}.${row.column_name}`));
      const missing = required.filter(key => !present.has(key));
      if (missing.length) {
        schemaNote = `Missing DB columns: ${missing.join(", ")}`;
        console.error("[admin-console]", schemaNote);
      }
    } catch (error) {
      /* The probe is diagnostic only; the handler remains the authority. */
      console.error("[admin-console] schema probe failed:", error?.message || error);
    }

    try {
      await decisionHandler(request, response);
    } catch (error) {
      if (response.headersSent) throw error;
      const status = decisionFailureStatus(error);
      console.error("[admin-console] verification decision failed:", error?.stack || error);
      const message = decisionFailureMessage(request, error, status);
      return response.status(status).json({
        error: schemaNote ? `${message} — ${schemaNote}` : message,
        code: error?.code || null,
        constraint: error?.constraint || null,
        detail: typeof error?.message === "string" ? error.message.slice(0, 300) : null,
        schema: schemaNote,
      });
    }
  }));

  app.get(`${PREFIX}/verifications`, ...view("verification"), wrap(async (_request, response) => {
    const result = await pool.query(
      `SELECT v.id::text, v.decision, v.remarks, v.created_at::text AS "createdAt",
              t.tree_reference AS "treeReference", t.id::text AS "treeId", a.email AS admin
         FROM verification_records v JOIN family_trees t ON t.id=v.family_tree_id
         LEFT JOIN admins a ON a.id=v.admin_id ORDER BY v.created_at DESC LIMIT 200`
    );
    response.json({ records: result.rows });
  }));

  /* ── Master Vanshawali ─────────────────────────────────────────────── */

  app.get(`${PREFIX}/master/tree-index`, ...view("master"), wrap(async (request, response) => {
    const result = await pool.query(
      `SELECT t.id::text, t.tree_reference AS "treeReference", g.id::text AS "gotraId", g.name AS gotra,
              t.root_person_id::text AS "rootPersonId", ${ROOT_NAME_SQL} AS "rootName", t.village, t.status,
              (SELECT COUNT(*) FROM people p2 WHERE p2.family_tree_id=t.id)::int AS "memberCount",
              (SELECT COUNT(*) FROM tree_links l WHERE l.status='active' AND (l.source_tree_id=t.id OR l.target_tree_id=t.id))::int AS "linkCount"
         FROM family_trees t JOIN gotras g ON g.id=t.gotra_id
         LEFT JOIN people p ON p.id=t.root_person_id
        WHERE t.status='verified' AND t.deleted_at IS NULL
        ORDER BY g.name, ${ROOT_NAME_SQL} LIMIT 500`
    );
    response.json({ trees: result.rows });
  }));

  app.get(`${PREFIX}/master/compare`, ...view("master"), wrap(async (request, response) => {
    const sourceId = cid(request.query.sourceTreeId);
    const targetId = cid(request.query.targetTreeId);
    if (!sourceId || !targetId) return response.status(400).json({ error: "Two trees are required." });
    const [source, target] = await Promise.all([
      pool.query(`SELECT id::text, tree_reference AS "treeReference", gotra_id::text AS "gotraId", status FROM family_trees WHERE id=$1`, [sourceId]),
      pool.query(`SELECT id::text, tree_reference AS "treeReference", gotra_id::text AS "gotraId", status FROM family_trees WHERE id=$1`, [targetId]),
    ]);
    if (!source.rowCount || !target.rowCount) return response.status(404).json({ error: "Tree not found." });
    const names = await pool.query(
      `SELECT p.id::text, p.full_name AS name, p.village, p.wife_name AS "wifeName",
              lower(btrim(p.full_name)) AS key, t.id::text AS "treeId", t.tree_reference AS "treeReference"
         FROM people p JOIN family_trees t ON t.id=p.family_tree_id
        WHERE p.family_tree_id IN ($1,$2) AND p.status='verified'
        ORDER BY t.id, p.full_name`, [sourceId, targetId]
    );
    const sourceNames = names.rows.filter(row => row.treeId === sourceId);
    const targetNames = names.rows.filter(row => row.treeId === targetId);
    const targetByKey = new Map(targetNames.map(row => [row.key, row]));
    const matches = sourceNames
      .filter(row => targetByKey.has(row.key))
      .map(row => ({
        sourcePersonId: row.id, sourceName: row.name, targetPersonId: targetByKey.get(row.key).id,
        targetName: targetByKey.get(row.key).name, village: row.village, wifeName: row.wifeName,
        sameGotra: source.rows[0].gotraId === target.rows[0].gotraId,
      }));
    response.json({
      source: source.rows[0], target: target.rows[0], matches,
      warning: matches.length
        ? "Name matches are leads only. Verify documentary evidence before linking trees."
        : "No exact name overlap found. Do not link trees on Gotra or village alone.",
    });
  }));

  app.get(`${PREFIX}/master/ancestors`, ...view("master"), wrap(async (request, response) => {
    const personId = cid(request.query.personId);
    if (!personId) return response.status(400).json({ error: "Person is required." });
    const result = await pool.query(
      `WITH RECURSIVE ancestors AS (
         SELECT p.id::text, p.full_name AS name, 1 AS depth, ARRAY[p.id] AS path
           FROM people p WHERE p.id=$1
         UNION ALL
         SELECT parent.id::text, parent.full_name, a.depth+1, a.path || parent.id
           FROM ancestors a JOIN person_relationships r ON r.child_id=a.id::uuid AND r.status='verified'
           JOIN people parent ON parent.id=r.parent_id
          WHERE a.depth < 50 AND NOT parent.id = ANY(a.path)
       )
       SELECT id, name, depth FROM ancestors ORDER BY depth, name`, [personId]
    );
    response.json({ ancestors: result.rows });
  }));

  app.get(`${PREFIX}/master/hierarchy`, ...view("master"), wrap(async (request, response) => {
    const treeId = cid(request.query.treeId);
    const result = await pool.query(
      `SELECT p.id::text, p.full_name AS name, COALESCE(p.member_type,'') AS "memberType",
              p.birth_order AS "birthOrder", parent.id::text AS "parentId",
              g.name AS gotra, b.name AS branch
         FROM people p LEFT JOIN person_relationships r ON r.child_id=p.id AND r.status='verified'
         LEFT JOIN people parent ON parent.id=r.parent_id
         LEFT JOIN family_trees t ON t.id=p.family_tree_id
         LEFT JOIN gotras g ON g.id=t.gotra_id
         LEFT JOIN person_gotra_links pgl ON pgl.person_id=p.id
         LEFT JOIN family_branches b ON b.id=pgl.branch_id
        WHERE ($1::uuid IS NULL OR p.family_tree_id=$1)
        ORDER BY g.name, p.family_tree_id, p.birth_order, p.full_name LIMIT 2000`, [treeId]
    );
    response.json({ nodes: result.rows });
  }));

  app.get(`${PREFIX}/master/links`, ...view("master"), wrap(async (request, response) => {
    const result = await pool.query(
      `SELECT l.id::text, l.status, l.notes, l.created_at::text AS "createdAt",
              s.tree_reference AS source, t.tree_reference AS target,
              ancestor.full_name AS ancestor, a.email AS admin
         FROM tree_links l JOIN family_trees s ON s.id=l.source_tree_id
         JOIN family_trees t ON t.id=l.target_tree_id
         LEFT JOIN people ancestor ON ancestor.id=l.common_ancestor_person_id
         LEFT JOIN admins a ON a.id=l.linking_admin_id
        ORDER BY l.created_at DESC LIMIT 500`
    );
    response.json({ links: result.rows });
  }));

  app.post(`${PREFIX}/master/link/:id`, ...approve("master"), superOnly, wrap(async (request, response) => {
    if (!linkHandler) throw new Error("Tree-link handler is unavailable.");
    await logAdminAction(request, "console_link_trees", "tree_link", cid(request.params.id), request.body);
    await linkHandler(request, response);
  }));

  app.post(`${PREFIX}/master/links/:id/reverse`, ...approve("master"), superOnly, wrap(async (request, response) => {
    if (!reverseLinkHandler) throw new Error("Reverse-link handler is unavailable.");
    await logAdminAction(request, "console_reverse_link", "tree_link", cid(request.params.id), request.body);
    await reverseLinkHandler(request, response);
  }));

  /* ── Family branch linking / unlinking ─────────────────────────────── */

  app.get(`${PREFIX}/branches`, ...view("branches"), wrap(async (request, response) => {
    const { limit, offset } = paginate(request.query);
    const values = [];
    const clauses = [];
    const q = text(request.query.q, 120);
    if (q) clauses.push(`(b.name ILIKE ${param(values, `%${q}%`)} OR g.name ILIKE $${values.length})`);
    if (cid(request.query.gotraId)) clauses.push(`b.gotra_id = ${param(values, cid(request.query.gotraId))}`);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = await pool.query(`SELECT COUNT(*)::int AS count FROM family_branches b JOIN gotras g ON g.id=b.gotra_id ${where}`, values);
    const rows = await pool.query(
      `SELECT b.id::text, b.name, b.status, g.name AS gotra, parent.name AS parent,
              (SELECT COUNT(*) FROM person_gotra_links pgl WHERE pgl.branch_id=b.id)::int AS "memberCount"
         FROM family_branches b JOIN gotras g ON g.id=b.gotra_id
         LEFT JOIN family_branches parent ON parent.id=b.parent_branch_id
         ${where} ORDER BY g.name, b.name LIMIT ${limit} OFFSET ${offset}`, values
    );
    const links = await pool.query(
      `SELECT l.id::text, l.status, l.notes, l.created_at::text AS "createdAt",
              s.name AS source, t.name AS target, g.name AS gotra
         FROM branch_links l JOIN family_branches s ON s.id=l.source_branch_id
         JOIN family_branches t ON t.id=l.target_branch_id
         JOIN gotras g ON g.id=s.gotra_id ORDER BY l.created_at DESC LIMIT 200`
    );
    response.json({ branches: rows.rows, links: links.rows, total: total.rows[0].count, limit, offset });
  }));

  app.post(`${PREFIX}/branches`, ...edit("branches"), wrap(async (request, response) => {
    const name = text(request.body?.name, 120);
    const gotraId = cid(request.body?.gotraId);
    if (!name || !gotraId) return response.status(400).json({ error: "Branch name and Gotra are required." });
    const result = await pool.query(
      `INSERT INTO family_branches (name, gotra_id, parent_branch_id, description, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id::text, name, status`,
      [name, gotraId, cid(request.body?.parentBranchId), text(request.body?.description, 500), request.admin.id]
    );
    await logAdminAction(request, "create_branch", "branch", result.rows[0].id, request.body);
    response.status(201).json({ branch: result.rows[0], message: "Branch created." });
  }));

  app.post(`${PREFIX}/branches/:id/link`, ...approve("branches"), wrap(async (request, response) => {
    const source = cid(request.params.id);
    const target = cid(request.body?.targetBranchId);
    if (!source || !target || source === target) return response.status(400).json({ error: "Two different branches are required." });
    const relationType = ["parent", "related", "merged_from"].includes(text(request.body?.relationType)) ? text(request.body.relationType, 20) : "related";
    const result = await pool.query(
      `INSERT INTO branch_links (source_branch_id, target_branch_id, relation_type, notes, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (source_branch_id, target_branch_id) DO UPDATE SET status='active',
         relation_type=EXCLUDED.relation_type, notes=EXCLUDED.notes, unlinked_at=NULL, unlinked_by=NULL
       RETURNING id::text, status, created_at::text AS "createdAt"`,
      [source, target, relationType, text(request.body?.notes, 500), request.admin.id]
    );
    await logAdminAction(request, "link_branches", "branch", source, { target, relationType });
    response.json({ link: result.rows[0], message: "Branches linked." });
  }));

  app.post(`${PREFIX}/branches/links/:id/unlink`, ...approve("branches"), wrap(async (request, response) => {
    const result = await pool.query(
      `UPDATE branch_links SET status='unlinked', unlinked_at=NOW(), unlinked_by=$2
        WHERE id=$1 AND status='active'`, [cid(request.params.id), request.admin.id]
    );
    if (!result.rowCount) return response.status(404).json({ error: "Active branch link not found." });
    await logAdminAction(request, "unlink_branches", "branch", cid(request.params.id));
    response.json({ message: "Branch link removed; history preserved." });
  }));

  /* ── Duplicate detection ───────────────────────────────────────────── */

  app.post(`${PREFIX}/duplicates/scan`, ...edit("duplicates"), wrap(async (request, response) => {
    const people = await pool.query(
      `SELECT p.id, p.full_name, p.wife_name, p.village, p.birth_year, p.family_tree_id,
              t.tree_reference, g.name AS gotra
         FROM people p LEFT JOIN family_trees t ON t.id=p.family_tree_id
         LEFT JOIN gotras g ON g.id=t.gotra_id
        WHERE p.status <> 'archived' ORDER BY p.full_name LIMIT 3000`
    );
    const buckets = new Map();
    for (const person of people.rows) {
      const key = vsh.normalizeName(person.full_name);
      if (!key) continue;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(person);
    }
    const candidates = [];
    for (const group of buckets.values()) {
      if (group.length < 2) continue;
      for (let i = 0; i < group.length && candidates.length < 300; i += 1) {
        for (let j = i + 1; j < group.length && candidates.length < 300; j += 1) {
          const a = group[i]; const b = group[j];
          const reasons = ["same_normalized_name"];
          let score = 70;
          if (a.wife_name && sameLower(a.wife_name, b.wife_name)) { score += 15; reasons.push("same_spouse"); }
          if (a.village && sameLower(a.village, b.village)) { score += 10; reasons.push("same_village"); }
          if (a.birth_year && a.birth_year === b.birth_year) { score += 5; reasons.push("same_birth_year"); }
          if (a.family_tree_id && a.family_tree_id === b.family_tree_id) { score += 10; reasons.push("same_tree"); }
          candidates.push({ a, b, score: Math.min(99, score), reasons });
        }
      }
    }
    const gotras = await pool.query("SELECT id, name FROM gotras");
    const gotraBuckets = new Map();
    for (const gotra of gotras.rows) {
      const key = vsh.normalizeName(gotra.name);
      if (!gotraBuckets.has(key)) gotraBuckets.set(key, []);
      gotraBuckets.get(key).push(gotra);
    }
    for (const group of gotraBuckets.values()) {
      for (let i = 0; i < group.length && candidates.length < 350; i += 1) {
        for (let j = i + 1; j < group.length && candidates.length < 350; j += 1) {
          candidates.push({ a: group[i], b: group[j], score: 95, reasons: ["same_normalized_gotra"], entityType: "gotra" });
        }
      }
    }

    let created = 0;
    for (const candidate of candidates) {
      const [first, second] = candidate.a.id < candidate.b.id ? [candidate.a.id, candidate.b.id] : [candidate.b.id, candidate.a.id];
      const result = await pool.query(
        `INSERT INTO duplicate_candidates (entity_type, entity_a, entity_b, score, reasons)
         VALUES ($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT (entity_type, entity_a, entity_b) DO UPDATE
           SET score=EXCLUDED.score, reasons=EXCLUDED.reasons,
               status=CASE WHEN duplicate_candidates.status IN ('dismissed','merged') THEN duplicate_candidates.status ELSE 'open' END
         WHERE duplicate_candidates.status NOT IN ('dismissed','merged')`,
        [candidate.entityType || "person", first, second, candidate.score, JSON.stringify(candidate.reasons)]
      );
      created += result.rowCount;
    }
    await logAdminAction(request, "scan_duplicates", "duplicate", null, { scanned: people.rowCount, created });
    await notify(request, { title: "Duplicate scan complete", body: `${created} candidate pairs are ready for review.`, type: created ? "warning" : "success", linkUrl: "/admin.html#duplicates" });
    response.json({ scanned: people.rowCount, created, message: "Duplicate scan complete." });
  }));

  app.get(`${PREFIX}/duplicates`, ...view("duplicates"), wrap(async (request, response) => {
    const { limit, offset } = paginate(request.query);
    const status = text(request.query.status, 30) || "open";
    const minScore = Math.max(0, Math.min(100, Number(request.query.minScore) || 60));
    const total = await pool.query(
      "SELECT COUNT(*)::int AS count FROM duplicate_candidates WHERE status=$1 AND score >= $2", [status, minScore]
    );
    const result = await pool.query(
      `SELECT d.id::text, d.entity_type AS "entityType", d.score::text AS score, d.status,
              d.reasons, d.created_at::text AS "createdAt", a.email AS reviewer,
              pa.full_name AS "nameA", pb.full_name AS "nameB",
              ga.name AS "gotraA", gb.name AS "gotraB",
              ta.tree_reference AS "treeA", tb.tree_reference AS "treeB"
         FROM duplicate_candidates d
         LEFT JOIN admins a ON a.id=d.reviewed_by
         LEFT JOIN people pa ON d.entity_type='person' AND pa.id=d.entity_a
         LEFT JOIN people pb ON d.entity_type='person' AND pb.id=d.entity_b
         LEFT JOIN gotras ga ON d.entity_type='gotra' AND ga.id=d.entity_a
         LEFT JOIN gotras gb ON d.entity_type='gotra' AND gb.id=d.entity_b
         LEFT JOIN family_trees ta ON ta.id=pa.family_tree_id
         LEFT JOIN family_trees tb ON tb.id=pb.family_tree_id
        WHERE d.status=$1 AND d.score >= $2
        ORDER BY d.score DESC, d.created_at DESC LIMIT ${limit} OFFSET ${offset}`, [status, minScore]
    );
    response.json({ candidates: result.rows, total: total.rows[0].count, limit, offset });
  }));

  app.patch(`${PREFIX}/duplicates/:id/review`, ...approve("duplicates"), wrap(async (request, response) => {
    const decision = text(request.body?.decision, 30);
    if (!["confirmed", "dismissed", "merged", "resolved"].includes(decision)) {
      return response.status(400).json({ error: "Invalid review decision." });
    }
    const result = await pool.query(
      `UPDATE duplicate_candidates SET status=$1, reviewed_by=$2, reviewed_at=NOW(), review_notes=$3
        WHERE id=$4 RETURNING id::text, status`,
      [decision, request.admin.id, text(request.body?.notes, 500) || null, cid(request.params.id)]
    );
    if (!result.rowCount) return response.status(404).json({ error: "Candidate not found." });
    await logAdminAction(request, "review_duplicate", "duplicate", cid(request.params.id), { decision });
    response.json({ candidate: result.rows[0], message: "Duplicate review saved." });
  }));

  /* ── Village management ────────────────────────────────────────────── */

  app.get(`${PREFIX}/villages`, ...view("villages"), wrap(async (request, response) => {
    const q = text(request.query.q, 120);
    const result = await pool.query(
      `SELECT lower(btrim(v.village)) AS key, min(btrim(v.village)) AS village,
              COUNT(*) FILTER (WHERE v.source='people')::int AS "peopleCount",
              COUNT(*) FILTER (WHERE v.source='trees')::int AS "treeCount",
              COUNT(DISTINCT v.gotra_id)::int AS "gotraCount"
         FROM (
           SELECT village, 'people' AS source, t.gotra_id FROM people p LEFT JOIN family_trees t ON t.id=p.family_tree_id
           UNION ALL
           SELECT village, 'trees' AS source, gotra_id FROM family_trees
         ) v
        WHERE v.village IS NOT NULL AND btrim(v.village) <> '' AND ($1='' OR lower(v.village) LIKE '%'||$1||'%')
        GROUP BY 1 ORDER BY 2`, [q.toLowerCase()]
    );
    response.json({ villages: result.rows });
  }));

  async function applyVillageChange(request, response, rename) {
    const from = text(request.body?.from, 120);
    const to = text(request.body?.to, 120);
    if (!from || !to) return response.status(400).json({ error: "Both village names are required." });
    if (sameLower(from, to)) return response.status(400).json({ error: "Village names must differ." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      /* A village name is part of a verified tree's submitted values. Any
         verified tree touched by a bulk rename must be reopened for review
         instead of silently changing public genealogy. */
      const affected = await client.query(
        `SELECT DISTINCT t.id::text, t.tree_reference, t.revision_number, t.current_revision
           FROM family_trees t LEFT JOIN people p ON p.family_tree_id=t.id
          WHERE t.status='verified' AND t.deleted_at IS NULL
            AND (lower(btrim(t.village))=lower(btrim($1)) OR lower(btrim(p.village))=lower(btrim($1)))`, [from]
      );
      if (affected.rowCount && !asBool(request.body?.revisionIntent, false)) {
        await client.query("ROLLBACK");
        return response.status(409).json({
          error: locale(request,
            "इस गांव में सत्यापित वृक्ष हैं। संशोधन स्वीकार करने के लिए revisionIntent सहित अनुरोध भेजें; प्रभावित वृक्ष पुनः सत्यापन में जाएँगे।",
            "Verified trees are affected. Send revisionIntent to accept the change; affected trees will return to verification."),
          affectedTrees: affected.rowCount,
        });
      }
      const people = await client.query(
        "UPDATE people SET village=$1, updated_at=NOW() WHERE lower(btrim(village))=lower(btrim($2))", [to, from]
      );
      const trees = await client.query(
        "UPDATE family_trees SET village=$1, updated_at=NOW() WHERE lower(btrim(village))=lower(btrim($2))", [to, from]
      );
      let locations = 0;
      if (rename) {
        const loc = await client.query(
          "UPDATE locations SET village_name=$1, updated_at=NOW() WHERE lower(btrim(village_name))=lower(btrim($2))", [to, from]
        );
        locations = loc.rowCount;
      } else {
        const removed = await client.query("DELETE FROM locations WHERE lower(btrim(village_name))=lower(btrim($2))", [from]);
        locations = removed.rowCount;
      }
      await client.query(
        `INSERT INTO locations (village_name, district, state, slug)
         VALUES ($1, '', '', regexp_replace(lower(btrim($1)), '[^a-z0-9]+', '-', 'g'))
         ON CONFLICT (village_name, district, state) DO NOTHING`, [to]
      );
      for (const tree of affected.rows) {
        const nextRevisionNumber = Number(tree.revision_number) + 1;
        const nextMembers = (tree.current_revision || []).map(member =>
          member.memberType === "daughter" ? member : { ...member, village: to }
        );
        await client.query(
          `UPDATE family_trees SET current_revision=$2::jsonb, revision_number=$3,
                  status='under_review', verified_at=NULL, updated_at=NOW()
            WHERE id=$1`, [tree.id, JSON.stringify(nextMembers), nextRevisionNumber]
        );
        await client.query(
          `INSERT INTO family_tree_revisions (family_tree_id, revision_number, revision, snapshot, editor_admin_id, note)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [tree.id, nextRevisionNumber, JSON.stringify(nextMembers),
            JSON.stringify({ currentRevision: tree.current_revision || [], village: { from, to }, action: "village_change" }),
            request.admin.id, `Village ${from} changed to ${to}`]
        );
        await client.query(
          `INSERT INTO verification_records (family_tree_id, revision_number, admin_id, decision, remarks)
           VALUES ($1,$2,$3,'under_review',$4)`,
          [tree.id, nextRevisionNumber, request.admin.id, "Verified tree changed by village rename; re-verification required."]
        );
      }
      await logAudit(client, request.admin.id, rename ? "rename_village" : "merge_village", "village", null, {
        from, to, people: people.rowCount, trees: trees.rowCount, revisions: affected.rowCount,
      });
      await client.query("COMMIT");
      response.json({
        message: rename ? "Village renamed." : "Villages merged.",
        people: people.rowCount, trees: trees.rowCount, locations, revisions: affected.rowCount,
      });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  app.post(`${PREFIX}/villages/merge`, ...edit("villages"), wrap((request, response) => applyVillageChange(request, response, false)));
  app.post(`${PREFIX}/villages/rename`, ...edit("villages"), wrap((request, response) => applyVillageChange(request, response, true)));

  /* ── User and account management ───────────────────────────────────── */

  async function revokeAllSessions(client, adminId) {
    const sessions = await client.query("SELECT jti, expires_at FROM admin_sessions WHERE admin_id=$1", [adminId]);
    for (const session of sessions.rows) {
      await client.query(
        `INSERT INTO revoked_tokens (jti, admin_id, expires_at) VALUES ($1,$2,$3)
         ON CONFLICT (jti) DO NOTHING`, [session.jti, adminId, session.expires_at]
      );
    }
    await client.query("DELETE FROM admin_sessions WHERE admin_id=$1", [adminId]);
  }

  app.get(`${PREFIX}/accounts`, ...view("accounts"), wrap(async (request, response) => {
    const result = await pool.query(
      `SELECT a.id::text, a.email, COALESCE(a.display_name,'') AS "displayName", a.role,
              a.is_active AS "isActive", a.last_login_at::text AS "lastLoginAt",
              a.password_changed_at::text AS "passwordChangedAt", a.created_at::text AS "createdAt",
              (SELECT COUNT(*) FROM genealogy_audit g WHERE g.admin_id=a.id)::int AS actions
         FROM admins a ORDER BY a.created_at DESC`
    );
    const sessions = await pool.query(
      `SELECT s.admin_id::text AS "adminId", COUNT(*)::int AS count
         FROM admin_sessions s WHERE s.expires_at > NOW() GROUP BY s.admin_id`
    );
    response.json({ accounts: result.rows, sessions: sessions.rows });
  }));

  app.get(`${PREFIX}/contributors`, ...view("accounts"), wrap(async (request, response) => {
    const result = await pool.query(
      `SELECT COALESCE(NULLIF(btrim(submitter_name),''), 'Unknown') AS name,
              COALESCE(NULLIF(btrim(submitter_contact),''), '—') AS contact,
              COUNT(*)::int AS trees,
              COUNT(*) FILTER (WHERE status='verified')::int AS verified
         FROM family_trees GROUP BY 1,2 ORDER BY trees DESC LIMIT 200`
    );
    response.json({ contributors: result.rows });
  }));

  app.post(`${PREFIX}/accounts`, ...edit("accounts"), superOnly, wrap(async (request, response) => {
    const email = text(request.body?.email, 200).toLowerCase();
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    const role = ["admin", "super_admin"].includes(text(request.body?.role)) ? text(request.body.role, 30) : "admin";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response.status(400).json({ error: "Valid email is required." });
    if (password.length < 12) return response.status(400).json({ error: "Password must be at least 12 characters." });
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO admins (email, password_hash, role, display_name, created_by, password_changed_at)
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id::text, email, role`,
      [email, hash, role, text(request.body?.displayName, 120) || null, request.admin.id]
    );
    await logAdminAction(request, "create_admin", "admin", result.rows[0].id, { email, role });
    await notify(request, { title: "Admin account created", body: `${email} can now access the console.`, type: "success" });
    response.status(201).json({ account: result.rows[0], message: "Account created." });
  }));

  app.patch(`${PREFIX}/accounts/:id`, ...edit("accounts"), superOnly, wrap(async (request, response) => {
    const id = cid(request.params.id);
    if (!id) return response.status(404).json({ error: "Account not found." });
    const found = await pool.query("SELECT * FROM admins WHERE id=$1", [id]);
    if (!found.rowCount) return response.status(404).json({ error: "Account not found." });
    const account = found.rows[0];
    const nextRole = ["admin", "super_admin"].includes(text(request.body?.role)) ? text(request.body.role, 30) : account.role;
    const isActive = asBool(request.body?.isActive, account.is_active);
    if (id === request.admin.id && (!isActive || (nextRole !== "super_admin" && account.role === "super_admin"))) {
      return response.status(400).json({ error: "You cannot deactivate or demote your own account." });
    }
    if (account.role === "super_admin" && nextRole !== "super_admin" && isActive) {
      const supers = await pool.query("SELECT COUNT(*)::int AS count FROM admins WHERE role='super_admin' AND is_active=TRUE");
      if (supers.rows[0].count <= 1) return response.status(409).json({ error: "At least one active Super Admin must remain." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE admins SET role=$1, is_active=$2, display_name=$3 WHERE id=$4
         RETURNING id::text, email, role, is_active AS "isActive"`,
        [nextRole, isActive, text(request.body?.displayName, 120) || account.display_name, id]
      );
      if (!isActive || nextRole !== account.role) await revokeAllSessions(client, id);
      await logAudit(client, request.admin.id, "update_admin", "admin", id, { role: nextRole, isActive });
      await client.query("COMMIT");
      response.json({ account: result.rows[0], message: "Account updated." });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }));

  app.post(`${PREFIX}/accounts/:id/reset-password`, ...edit("accounts"), superOnly, wrap(async (request, response) => {
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (password.length < 12) return response.status(400).json({ error: "Password must be at least 12 characters." });
    const id = cid(request.params.id);
    const hash = await bcrypt.hash(password, 12);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "UPDATE admins SET password_hash=$1, password_changed_at=NOW(), failed_login_count=0 WHERE id=$2 RETURNING id::text, email",
        [hash, id]
      );
      if (!result.rowCount) { await client.query("ROLLBACK"); return response.status(404).json({ error: "Account not found." }); }
      await revokeAllSessions(client, id);
      await logAudit(client, request.admin.id, "reset_admin_password", "admin", id, null, "warning");
      await client.query("COMMIT");
      response.json({ message: "Password reset and all sessions revoked." });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }));

  app.delete(`${PREFIX}/accounts/:id`, ...edit("accounts"), superOnly, wrap(async (request, response) => {
    const id = cid(request.params.id);
    if (id === request.admin.id) return response.status(400).json({ error: "You cannot deactivate your own account." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("UPDATE admins SET is_active=FALSE WHERE id=$1 RETURNING id::text", [id]);
      if (!result.rowCount) { await client.query("ROLLBACK"); return response.status(404).json({ error: "Account not found." }); }
      await revokeAllSessions(client, id);
      await logAudit(client, request.admin.id, "deactivate_admin", "admin", id, null, "warning");
      await client.query("COMMIT");
      response.json({ message: "Account deactivated; audit history preserved." });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }));

  /* ── Notifications ─────────────────────────────────────────────────── */

  app.get(`${PREFIX}/notifications`, ...view("notifications"), wrap(async (request, response) => {
    const { limit, offset } = paginate(request.query, 50);
    const scope = text(request.query.scope, 20) === "all" ? "all" : "mine";
    const unreadOnly = asBool(request.query.unread, false);
    const values = [request.admin.id];
    const clauses = [scope === "all" ? "TRUE" : "(n.admin_id IS NULL OR n.admin_id=$1)"];
    if (unreadOnly) clauses.push("n.read_at IS NULL");
    const where = clauses.join(" AND ");
    const total = await pool.query(`SELECT COUNT(*)::int AS count FROM notifications n WHERE ${where}`, values);
    const rows = await pool.query(
      `SELECT n.id::text, n.type, n.title, COALESCE(n.body,'') AS body,
              COALESCE(n.link_url,'') AS "linkUrl", n.read_at::text AS "readAt",
              n.created_at::text AS "createdAt", COALESCE(a.email,'All admins') AS recipient
         FROM notifications n LEFT JOIN admins a ON a.id=n.admin_id
        WHERE ${where} ORDER BY n.created_at DESC LIMIT ${limit} OFFSET ${offset}`, values
    );
    const unread = await pool.query(
      "SELECT COUNT(*)::int AS count FROM notifications WHERE read_at IS NULL AND (admin_id IS NULL OR admin_id=$1)",
      [request.admin.id]
    );
    response.json({ notifications: rows.rows, unread: unread.rows[0].count, total: total.rows[0].count, limit, offset });
  }));

  app.post(`${PREFIX}/notifications`, ...edit("notifications"), wrap(async (request, response) => {
    const title = text(request.body?.title, 160);
    if (!title) return response.status(400).json({ error: "Notification title is required." });
    const type = ["info", "success", "warning", "danger"].includes(text(request.body?.type)) ? text(request.body.type, 20) : "info";
    const adminId = cid(request.body?.adminId);
    const result = await pool.query(
      `INSERT INTO notifications (admin_id, type, title, body, link_url, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id::text, title, type, created_at::text AS "createdAt"`,
      [adminId, type, title, text(request.body?.body, 1000), text(request.body?.linkUrl, 300) || null, request.admin.id]
    );
    await logAdminAction(request, "create_notification", "notification", result.rows[0].id, { title, adminId });
    response.status(201).json({ notification: result.rows[0], message: "Notification sent." });
  }));

  app.post(`${PREFIX}/notifications/:id/read`, ...edit("notifications"), wrap(async (request, response) => {
    const result = await pool.query(
      "UPDATE notifications SET read_at=NOW() WHERE id=$1 AND read_at IS NULL", [cid(request.params.id)]
    );
    response.json({ message: result.rowCount ? "Marked as read." : "Already read." });
  }));

  app.post(`${PREFIX}/notifications/read-all`, ...edit("notifications"), wrap(async (request, response) => {
    await pool.query(
      "UPDATE notifications SET read_at=NOW() WHERE read_at IS NULL AND (admin_id IS NULL OR admin_id=$1)",
      [request.admin.id]
    );
    response.json({ message: "All notifications marked as read." });
  }));

  app.delete(`${PREFIX}/notifications/:id`, ...edit("notifications"), wrap(async (request, response) => {
    const result = await pool.query("DELETE FROM notifications WHERE id=$1", [cid(request.params.id)]);
    if (!result.rowCount) return response.status(404).json({ error: "Notification not found." });
    await logAdminAction(request, "delete_notification", "notification", cid(request.params.id));
    response.json({ message: "Notification deleted." });
  }));

  /* ── Reports and analytics ─────────────────────────────────────────── */

  app.get(`${PREFIX}/reports/summary`, ...view("reports"), wrap(async (request, response) => {
    const contributionsWindow = dateWindow(request.query, "submitted_at", 1);
    const window = dateWindow(request.query, "created_at", 1 + contributionsWindow.params.length);
    const summary = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM family_trees WHERE deleted_at IS NULL) AS trees,
         (SELECT COUNT(*) FROM family_trees WHERE status='verified') AS verified,
         (SELECT COUNT(*) FROM family_trees WHERE status='pending') AS pending,
         ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (verified_at-submitted_at))/86400),0)::numeric,1) AS "avgVerificationDays",
         (SELECT COUNT(*) FROM tree_links WHERE status='active') AS links,
         (SELECT COUNT(*) FROM genealogy_contributions ${contributionsWindow.where}) AS contributions,
         (SELECT COUNT(*) FROM genealogy_audit ${window.where}) AS auditEvents
       FROM family_trees WHERE verified_at IS NOT NULL AND submitted_at IS NOT NULL`,
      contributionsWindow.params.concat(window.params)
    );
    const [byMonth, byGotra, byVillage, turnaround] = await Promise.all([
      pool.query(
        `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::int AS count
           FROM family_trees GROUP BY 1 ORDER BY 1 DESC LIMIT 12`
      ),
      pool.query(
        `SELECT g.name AS label, COUNT(t.id)::int AS count FROM gotras g
          LEFT JOIN family_trees t ON t.gotra_id=g.id GROUP BY g.id,g.name ORDER BY count DESC LIMIT 12`
      ),
      pool.query(
        `SELECT btrim(village) AS label, COUNT(*)::int AS count FROM family_trees
          WHERE village IS NOT NULL AND btrim(village)<>'' GROUP BY 1 ORDER BY count DESC LIMIT 12`
      ),
      pool.query(
        `SELECT decision, COUNT(*)::int AS count FROM verification_records GROUP BY decision ORDER BY count DESC`
      ),
    ]);
    response.json({ summary: summary.rows[0], byMonth: byMonth.rows, byGotra: byGotra.rows, byVillage: byVillage.rows, turnaround: turnaround.rows });
  }));

  /* ── Exports ───────────────────────────────────────────────────────── */

  app.get(`${PREFIX}/exports/:dataset`, ...view("exports"), wrap(async (request, response) => {
    const format = ["csv", "xlsx", "pdf"].includes(text(request.query.format, 10).toLowerCase()) ? text(request.query.format, 10).toLowerCase() : "csv";
    const data = await fetchExportData(pool, text(request.params.dataset, 50));
    if (!data) return response.status(404).json({ error: "Unknown export dataset." });
    await logAdminAction(request, "export_data", "export", null, { dataset: request.params.dataset, format });
    return sendExport(response, {
      filename: `kulkirti-${request.params.dataset}-${new Date().toISOString().slice(0, 10)}`,
      format, columns: data.columns, rows: data.rows, title: data.title,
      subtitle: `Generated ${new Date().toLocaleString("en-GB")}`,
    });
  }));

  app.get(`${PREFIX}/reports/export`, ...view("exports"), wrap(async (request, response) => {
    const dataset = text(request.query.dataset, 50) || "trees";
    request.query.format = text(request.query.format, 10) || "csv";
    const data = await fetchExportData(pool, dataset);
    if (!data) return response.status(404).json({ error: "Unknown export dataset." });
    await logAdminAction(request, "export_report", "export", null, { dataset, format: request.query.format });
    return sendExport(response, {
      filename: `kulkirti-report-${dataset}`,
      format: request.query.format, columns: data.columns, rows: data.rows, title: data.title,
    });
  }));

  /* ── Backup and restore management ─────────────────────────────────── */

  app.get(`${PREFIX}/backups`, ...view("backups"), wrap(async (_request, response) => {
    const result = await pool.query(
      `SELECT b.id::text, b.label, b.kind, b.status, b.row_counts AS "rowCounts", b.checksum,
              b.byte_size AS "byteSize", b.created_at::text AS "createdAt",
              b.finished_at::text AS "finishedAt", b.restored_at::text AS "restoredAt",
              COALESCE(a.email,'system') AS creator
         FROM admin_backups b LEFT JOIN admins a ON a.id=b.created_by
        ORDER BY b.created_at DESC LIMIT 100`
    );
    const jobs = await pool.query(
      `SELECT j.id::text, j.backup_id::text AS "backupId", j.mode, j.status, j.summary,
              j.started_at::text AS "startedAt", j.finished_at::text AS "finishedAt", j.error
         FROM admin_restore_jobs j ORDER BY j.started_at DESC LIMIT 100`
    );
    response.json({ backups: result.rows, jobs: jobs.rows });
  }));

  app.post(`${PREFIX}/backups`, ...edit("backups"), superOnly, wrap(async (request, response) => {
    const label = text(request.body?.label, 120) || `Manual backup ${new Date().toISOString()}`;
    const client = await pool.connect();
    let backupId;
    try {
      await client.query("BEGIN");
      const created = await client.query(
        "INSERT INTO admin_backups (label, status, created_by) VALUES ($1,'creating',$2) RETURNING id::text",
        [label, request.admin.id]
      );
      backupId = created.rows[0].id;
      const payload = {};
      const rowCounts = {};
      for (const table of BACKUP_TABLES) {
        const rows = await client.query(`SELECT * FROM ${table} ORDER BY id`);
        payload[table] = rows.rows;
        rowCounts[table] = rows.rowCount;
      }
      const json = JSON.stringify(payload);
      const checksum = crypto.createHash("sha256").update(json).digest("hex");
      await client.query(
        `UPDATE admin_backups SET payload=$1::jsonb, row_counts=$2::jsonb, checksum=$3,
                byte_size=$4, status='complete', finished_at=NOW() WHERE id=$5`,
        [json, JSON.stringify(rowCounts), checksum, Buffer.byteLength(json), backupId]
      );
      await logAudit(client, request.admin.id, "create_backup", "backup", backupId, { label, rowCounts });
      await client.query("COMMIT");
      await notify(request, { title: "Backup complete", body: `${label} captured ${Object.values(rowCounts).reduce((a, b) => a + b, 0)} rows.` });
      response.status(201).json({ backup: { id: backupId, label, rowCounts, checksum }, message: "Backup created." });
    } catch (error) {
      if (backupId) await pool.query("UPDATE admin_backups SET status='failed', finished_at=NOW(), notes=$2 WHERE id=$1", [backupId, error.message.slice(0, 300)]);
      throw error;
    } finally { client.release(); }
  }));

  app.get(`${PREFIX}/backups/:id/download`, ...view("backups"), superOnly, wrap(async (request, response) => {
    const result = await pool.query("SELECT label, payload, checksum, created_at FROM admin_backups WHERE id=$1", [cid(request.params.id)]);
    if (!result.rowCount) return response.status(404).json({ error: "Backup not found." });
    response.set("Content-Type", "application/json; charset=utf-8");
    response.set("Content-Disposition", `attachment; filename="kulkirti-backup-${String(result.rows[0].label).replace(/[^a-zA-Z0-9._-]/g, "_")}.json"`);
    response.set("Cache-Control", "no-store");
    response.send(JSON.stringify({
      kind: "kulkirti-logical-backup",
      version: 1,
      label: result.rows[0].label,
      exportedAt: result.rows[0].created_at,
      checksum: result.rows[0].checksum,
      tables: result.rows[0].payload,
    }, null, 2));
  }));

  app.post(`${PREFIX}/backups/:id/restore`, ...approve("backups"), superOnly, wrap(async (request, response) => {
    const backupId = cid(request.params.id);
    const mode = text(request.body?.mode, 30) === "apply_snapshot" ? "apply_snapshot" : "missing_only";
    const confirm = text(request.body?.confirm, 40);
    if (confirm !== (mode === "apply_snapshot" ? "APPLY SNAPSHOT" : "RESTORE")) {
      return response.status(400).json({ error: "Type the exact confirmation phrase to continue." });
    }
    const requested = Array.isArray(request.body?.tables) ? request.body.tables.map(t => text(t, 60)) : RESTORE_TABLES;
    const tables = requested.filter(table => RESTORE_TABLES.includes(table));
    if (!tables.length) return response.status(400).json({ error: "No restorable tables were selected." });

    const backup = await pool.query("SELECT * FROM admin_backups WHERE id=$1", [backupId]);
    if (!backup.rowCount) return response.status(404).json({ error: "Backup not found." });
    const payload = backup.rows[0].payload || {};
    let jobId;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const job = await client.query(
        "INSERT INTO admin_restore_jobs (backup_id, mode, tables, status, started_by) VALUES ($1,$2,$3,'running',$4) RETURNING id::text",
        [backupId, mode, tables, request.admin.id]
      );
      jobId = job.rows[0].id;
      const order = await tableRestoreOrder(client, tables);
      const summary = {};
      for (const table of order) {
        const rows = payload[table];
        if (!Array.isArray(rows)) { summary[table] = { skipped: true }; continue; }
        const columnsRes = await client.query(
          `SELECT column_name AS name FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1 AND is_generated='NEVER'
            ORDER BY ordinal_position`, [table]
        );
        const columns = columnsRes.rows.map(row => row.name).filter(name => name !== "id");
        const deferred = new Set(DEFERRED_COLUMNS[table] || []);
        let inserted = 0;
        for (const row of rows) {
          const usable = columns.filter(name => Object.prototype.hasOwnProperty.call(row, name));
          const names = ["id", ...usable];
          const values = [row.id, ...usable.map(name => deferred.has(name) ? null : row[name])];
          const placeholders = names.map((_, i) => `$${i + 1}`).join(",");
          const conflict = mode === "apply_snapshot"
            ? `DO UPDATE SET ${usable.filter(name => !deferred.has(name)).map(name => `${name}=EXCLUDED.${name}`).join(",") || "id=EXCLUDED.id"}`
            : "DO NOTHING";
          const result = await client.query(
            `INSERT INTO ${table} (${names.join(",")}) VALUES (${placeholders}) ON CONFLICT (id) ${conflict}`,
            values
          );
          inserted += result.rowCount;
        }
        summary[table] = { rows: rows.length, applied: inserted };
      }
      for (const [table, deferredColumns] of Object.entries(DEFERRED_COLUMNS)) {
        if (!tables.includes(table) || !Array.isArray(payload[table])) continue;
        for (const row of payload[table]) {
          for (const column of deferredColumns) {
            await client.query(`UPDATE ${table} SET ${column}=$2 WHERE id=$1`, [row.id, row[column] ?? null]);
          }
        }
      }
      await client.query(
        `UPDATE admin_restore_jobs SET status='completed', finished_at=NOW(), summary=$2::jsonb WHERE id=$1`,
        [jobId, JSON.stringify(summary)]
      );
      await client.query("UPDATE admin_backups SET status='restored', restored_at=NOW(), restored_by=$2 WHERE id=$1", [backupId, request.admin.id]);
      await logAudit(client, request.admin.id, "restore_backup", "backup", backupId, { mode, tables, summary }, "warning");
      await client.query("COMMIT");
      await refreshProjectionSafely(deps);
      await notify(request, { title: "Restore complete", body: `${tables.length} tables restored in ${mode} mode.`, type: "warning" });
      response.json({ jobId, summary, message: "Restore completed." });
    } catch (error) {
      await client.query("ROLLBACK");
      if (jobId) await pool.query("UPDATE admin_restore_jobs SET status='failed', finished_at=NOW(), error=$2 WHERE id=$1", [jobId, error.message.slice(0, 500)]);
      throw error;
    } finally { client.release(); }
  }));

  app.delete(`${PREFIX}/backups/:id`, ...approve("backups"), superOnly, wrap(async (request, response) => {
    const result = await pool.query("DELETE FROM admin_backups WHERE id=$1", [cid(request.params.id)]);
    if (!result.rowCount) return response.status(404).json({ error: "Backup not found." });
    await logAdminAction(request, "delete_backup", "backup", cid(request.params.id), null, "warning");
    response.json({ message: "Backup metadata deleted." });
  }));

  async function refreshProjectionSafely(dependency) {
    try { if (dependency.refreshTreeProjection) await dependency.refreshTreeProjection(); } catch { /* non-fatal */ }
  }

  /* ── Admin activity logs ───────────────────────────────────────────── */

  app.get(`${PREFIX}/activity`, ...view("activity"), wrap(async (request, response) => {
    const { limit, offset } = paginate(request.query, 50);
    const window = dateWindow(request.query, "a.created_at");
    const values = window.params.slice();
    const clauses = window.clauses.slice();
    const action = text(request.query.action, 80);
    const entityType = text(request.query.entityType, 80);
    const category = text(request.query.category, 80);
    const adminId = cid(request.query.adminId);
    if (action) clauses.push(`a.action ILIKE ${param(values, `%${action}%`)}`);
    if (entityType) clauses.push(`a.entity_type = ${param(values, entityType)}`);
    if (category) clauses.push(`a.category = ${param(values, category)}`);
    if (adminId) clauses.push(`a.admin_id = ${param(values, adminId)}`);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = await pool.query(`SELECT COUNT(*)::int AS count FROM genealogy_audit a ${where}`, values);
    const rows = await pool.query(
      `SELECT a.id::text, a.action, a.entity_type AS "entityType", a.entity_id::text AS "entityId",
              a.category, a.severity, COALESCE(a.changes::text,'') AS changes,
              COALESCE(ad.email,'system') AS admin, a.ip::text AS ip,
              a.created_at::text AS "createdAt"
         FROM genealogy_audit a LEFT JOIN admins ad ON ad.id=a.admin_id
         ${where} ORDER BY a.created_at DESC LIMIT ${limit} OFFSET ${offset}`, values
    );
    response.json({ logs: rows.rows, total: total.rows[0].count, limit, offset });
  }));

  app.get(`${PREFIX}/activity/filters`, ...view("activity"), wrap(async (_request, response) => {
    const [actions, entities, admins, categories] = await Promise.all([
      pool.query("SELECT DISTINCT action FROM genealogy_audit ORDER BY action LIMIT 200"),
      pool.query("SELECT DISTINCT entity_type AS value FROM genealogy_audit ORDER BY 1 LIMIT 200"),
      pool.query("SELECT id::text AS value, email AS label FROM admins ORDER BY email"),
      pool.query("SELECT DISTINCT category FROM genealogy_audit ORDER BY category"),
    ]);
    response.json({
      actions: actions.rows.map(r => r.action),
      entities: entities.rows.map(r => r.value),
      admins: admins.rows,
      categories: categories.rows.map(r => r.category),
    });
  }));

  /* ── Role and permission management ────────────────────────────────── */

  app.get(`${PREFIX}/roles`, ...view("roles"), wrap(async (_request, response) => {
    const [roles, permissions, grants, adminCounts] = await Promise.all([
      pool.query("SELECT name, description, rank FROM admin_roles ORDER BY rank DESC, name"),
      pool.query("SELECT key, module, action, label FROM admin_permissions ORDER BY module, action"),
      pool.query("SELECT role, permission_key AS \"permissionKey\", allowed FROM admin_role_permissions"),
      pool.query("SELECT role, COUNT(*)::int AS count FROM admins WHERE is_active=TRUE GROUP BY role"),
    ]);
    const overrides = await pool.query(
      `SELECT o.admin_id::text AS "adminId", a.email, o.permission_key AS "permissionKey", o.allowed
         FROM admin_permission_overrides o JOIN admins a ON a.id=o.admin_id`
    );
    response.json({ roles: roles.rows, permissions: permissions.rows, grants: grants.rows, adminCounts: adminCounts.rows, overrides: overrides.rows });
  }));

  app.patch(`${PREFIX}/roles/:role/permissions`, ...approve("roles"), superOnly, wrap(async (request, response) => {
    const role = text(request.params.role, 40);
    const known = await pool.query("SELECT name FROM admin_roles WHERE name=$1", [role]);
    if (!known.rowCount) return response.status(404).json({ error: "Unknown role." });
    const grants = request.body?.grants && typeof request.body.grants === "object" ? request.body.grants : {};
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let updated = 0;
      for (const [key, allowed] of Object.entries(grants)) {
        if (!/^[a-z_]+:(view|edit|approve)$/.test(key)) continue;
        if (role === "super_admin" && ["roles:view", "roles:edit", "roles:approve"].includes(key) && !asBool(allowed, false)) {
          await client.query("ROLLBACK");
          return response.status(400).json({ error: "Super Admin role access cannot be revoked." });
        }
        const result = await client.query(
          `UPDATE admin_role_permissions SET allowed=$3 WHERE role=$1 AND permission_key=$2`,
          [role, key, asBool(allowed, false)]
        );
        if (!result.rowCount) {
          await client.query(
            "INSERT INTO admin_role_permissions (role, permission_key, allowed) VALUES ($1,$2,$3)",
            [role, key, asBool(allowed, false)]
          );
        }
        updated += 1;
      }
      await logAudit(client, request.admin.id, "update_role_permissions", "role", null, { role, updated, grants }, "warning");
      await client.query("COMMIT");
      response.json({ updated, message: "Role permissions updated." });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }));

  app.put(`${PREFIX}/roles/overrides/:adminId`, ...approve("roles"), superOnly, wrap(async (request, response) => {
    const adminId = cid(request.params.adminId);
    const key = text(request.body?.permissionKey, 80);
    if (!/^[a-z_]+:(view|edit|approve)$/.test(key)) return response.status(400).json({ error: "Invalid permission key." });
    const allowed = asBool(request.body?.allowed, false);
    await pool.query(
      `INSERT INTO admin_permission_overrides (admin_id, permission_key, allowed, updated_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (admin_id, permission_key) DO UPDATE SET allowed=EXCLUDED.allowed, updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
      [adminId, key, allowed, request.admin.id]
    );
    await logAdminAction(request, "set_permission_override", "admin", adminId, { key, allowed }, "warning");
    response.json({ message: "Permission override saved." });
  }));

  app.delete(`${PREFIX}/roles/overrides/:adminId/:key`, ...approve("roles"), superOnly, wrap(async (request, response) => {
    await pool.query(
      "DELETE FROM admin_permission_overrides WHERE admin_id=$1 AND permission_key=$2",
      [cid(request.params.adminId), text(request.params.key, 80)]
    );
    await logAdminAction(request, "remove_permission_override", "admin", cid(request.params.adminId), { key: request.params.key }, "warning");
    response.json({ message: "Permission override removed." });
  }));
};
