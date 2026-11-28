/**
 * admin-console-core.js — shared definitions for the 17-module admin console.
 */
"use strict";

const crypto = require("crypto");

const MODULES = [
  { id: "overview", group: "control", icon: "◎", hi: "एडमिन ओवरव्यू", en: "Admin Overview", descHi: "सिस्टम की स्थिति और लंबित कार्य", descEn: "System health and pending work" },
  { id: "gotras", group: "genealogy", icon: "◈", hi: "गोत्र प्रबंधन", en: "Gotra Management", descHi: "गोत्र बनाएँ, संपादित करें और सक्रियता नियंत्रित करें", descEn: "Create, edit and control active Gotras" },
  { id: "trees", group: "genealogy", icon: "♣", hi: "वृक्ष प्रबंधन", en: "Family Tree Management", descHi: "सभी वृक्ष, संस्करण और वृक्ष सामग्री", descEn: "All trees, revisions and tree content" },
  { id: "members", group: "genealogy", icon: "♙", hi: "सदस्य प्रबंधन", en: "Member Management", descHi: "व्यक्ति, संबंध और शाखा आवंटन", descEn: "People, relationships and branch assignment" },
  { id: "verification", group: "workflow", icon: "✓", hi: "वृक्ष सत्यापन", en: "Tree Verification", descHi: "सत्यापन कतार, असाइनमेंट और निर्णय", descEn: "Verification queue, assignment and decisions" },
  { id: "master", group: "workflow", icon: "⌘", hi: "मास्टर वंशावली", en: "Master Vanshawali", descHi: "शाखाओं की तुलना, पूर्वज और लिंक", descEn: "Compare branches, ancestors and links" },
  { id: "branches", group: "workflow", icon: "⑂", hi: "शाखा लिंकिंग", en: "Branch Linking", descHi: "शाखा जोड़ना, हटाना और पदानुक्रम", descEn: "Link, unlink and inspect branch hierarchy" },
  { id: "duplicates", group: "quality", icon: "⧉", hi: "डुप्लिकेट पहचान", en: "Duplicate Detection", descHi: "संभावित डुप्लिकेट और उनकी समीक्षा", descEn: "Candidate duplicates and review decisions" },
  { id: "villages", group: "quality", icon: "⌂", hi: "गांव प्रबंधन", en: "Village Management", descHi: "गांव एकीकरण, नाम बदलना और आँकड़े", descEn: "Merge, rename and report village data" },
  { id: "accounts", group: "system", icon: "♟", hi: "खाते और उपयोगकर्ता", en: "Accounts & Users", descHi: "एडमिन खाते, भूमिकाएँ और सत्र", descEn: "Admin accounts, roles and sessions" },
  { id: "notifications", group: "system", icon: "◔", hi: "सूचनाएँ", en: "Notifications", descHi: "सूचना भेजें और पढ़ी हुई स्थिति", descEn: "Send notifications and track read state" },
  { id: "reports", group: "insights", icon: "▤", hi: "रिपोर्ट और विश्लेषण", en: "Reports & Analytics", descHi: "सत्यापन, वृक्ष और गतिविधि विश्लेषण", descEn: "Verification, tree and activity analytics" },
  { id: "exports", group: "insights", icon: "⇩", hi: "डेटा निर्यात", en: "Exports", descHi: "CSV, Excel और PDF डाउनलोड", descEn: "CSV, Excel and PDF downloads" },
  { id: "backups", group: "system", icon: "▣", hi: "बैकअप और रिस्टोर", en: "Backup & Restore", descHi: "लॉजिकल बैकअप और नियंत्रित रिस्टोर", descEn: "Logical snapshots and controlled restore" },
  { id: "activity", group: "system", icon: "≡", hi: "एडमिन गतिविधि लॉग", en: "Activity Logs", descHi: "हर एडमिन ऑपरेशन का इतिहास", descEn: "History of every administrative operation" },
  { id: "roles", group: "system", icon: "⚿", hi: "भूमिका और अनुमतियाँ", en: "Roles & Permissions", descHi: "मॉड्यूल-स्तरीय पहुँच नियंत्रण", descEn: "Module-level access control" },
  { id: "samiti", group: "content", icon: "★", hi: "समिति निर्देशिका", en: "Samiti Directory", descHi: "अध्यक्ष, सदस्य, पद और फ़ोटो प्रकाशित करें", descEn: "Publish president, members, positions and photos" },
];

const GROUPS = {
  control: "System",
  genealogy: "Genealogy",
  workflow: "Workflow",
  quality: "Data quality",
  system: "Administration",
  insights: "Insights",
  content: "Public content",
};

const MODULE_BY_ID = new Map(MODULES.map(module => [module.id, module]));

function clean(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function uuidOrNull(value) {
  const text = clean(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

function paginate(query = {}, defaultLimit = 50, maxLimit = 200) {
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(query.limit, 10) || defaultLimit));
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  return { limit, offset, page: Math.floor(offset / limit) + 1 };
}

function dateWindow(query = {}, column = "created_at", startIndex = 1) {
  const from = /^\d{4}-\d{2}-\d{2}/.test(clean(query.from, 10)) ? clean(query.from, 10) : null;
  const to = /^\d{4}-\d{2}-\d{2}/.test(clean(query.to, 10)) ? clean(query.to, 10) : null;
  const clauses = [];
  const params = [];
  if (from) { params.push(`${from} 00:00:00+00`); clauses.push(`${column} >= $${startIndex + params.length - 1}::timestamptz`); }
  if (to) { params.push(`${to} 23:59:59+00`); clauses.push(`${column} <= $${startIndex + params.length - 1}::timestamptz`); }
  return { from, to, clauses, params, where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "" };
}

/**
 * Build a module/action guard backed by admin_permissions (DB is the source of
 * truth). Denies by default; no client role claim is ever trusted.
 */
function makePermissionGuard(pool) {
  const permissionKey = (module, action) => `${module}:${action}`;
  return function requirePermission(module, action = "view") {
    return async (request, response, next) => {
      if (!request.admin) return response.status(401).json({ error: "Admin authentication required." });
      if (!MODULE_BY_ID.has(module) || !["view", "edit", "approve"].includes(action)) {
        return response.status(400).json({ error: "Unknown permission." });
      }
      try {
        const key = permissionKey(module, action);
        const result = await pool.query(
          `SELECT COALESCE(
             (SELECT allowed FROM admin_permission_overrides
               WHERE admin_id = $1 AND permission_key = $3),
             (SELECT allowed FROM admin_role_permissions
               WHERE role = $2 AND permission_key = $3),
             FALSE
           ) AS allowed`,
          [request.admin.id, request.admin.role, key]
        );
        if (!result.rows[0]?.allowed) {
          return response.status(403).json({ error: `You are not permitted to ${action} ${module}.` });
        }
        request.permission = { module, action, key };
        next();
      } catch {
        return response.status(503).json({ error: "Permission service is unavailable." });
      }
    };
  };
}

async function loadPermissions(pool, admin) {
  const result = await pool.query(
    `SELECT p.module, p.action,
            COALESCE(o.allowed, r.allowed, FALSE) AS allowed
       FROM admin_permissions p
       LEFT JOIN admin_role_permissions r
         ON r.permission_key = p.key AND r.role = $1
       LEFT JOIN admin_permission_overrides o
         ON o.permission_key = p.key AND o.admin_id = $2
      ORDER BY p.module, p.action`,
    [admin.role, admin.id]
  );
  const map = {};
  for (const row of result.rows) {
    map[row.module] = map[row.module] || {};
    map[row.module][row.action] = Boolean(row.allowed);
  }
  return map;
}

/** Insert an admin operation into genealogy_audit with request metadata. */
function makeAdminLogger(pool, fallbackLogAudit) {
  return async function logAdminAction(request, action, entityType, entityId, changes, severity = "info", category = "admin") {
    const changesJson = changes ? JSON.stringify(changes) : null;
    try {
      await pool.query(
        `INSERT INTO genealogy_audit
           (admin_id, action, entity_type, entity_id, changes, ip, user_agent, request_id, severity, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          request.admin?.id || null,
          action, entityType, uuidOrNull(entityId) || entityId || null, changesJson,
          request.ip || null,
          clean(request.headers?.["user-agent"], 300) || null,
          clean(request.headers?.["x-request-id"], 80) || crypto.randomUUID(),
          severity, category,
        ]
      );
    } catch (error) {
      if (fallbackLogAudit) {
        await fallbackLogAudit(pool, request.admin?.id, action, entityType, entityId, changes);
      } else {
        throw error;
      }
    }
  };
}

function makeNotifier(pool) {
  return async function notify(request, { title, body, type = "info", linkUrl = null, adminId = null }) {
    try {
      await pool.query(
        `INSERT INTO notifications (admin_id, type, title, body, link_url, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidOrNull(adminId), type, clean(title, 160), clean(body, 1000, 1000), clean(linkUrl, 300) || null, request.admin?.id || null]
      );
    } catch (error) {
      console.error("[notifications] insert failed:", error.message);
    }
  };
}

const EXPORT_DATASETS = {
  gotras: {
    title: "Gotra Directory",
    sql: `SELECT g.id::text, g.name, COALESCE(g.description,'') AS description, g.status,
                 g.is_active AS "isActive", g.created_at::text AS "createdAt",
                 (SELECT COUNT(*) FROM family_trees t WHERE t.gotra_id = g.id)::int AS "treeCount"
            FROM gotras g ORDER BY g.name LIMIT 10000`,
    columns: [{ key: "name", label: "Gotra", width: 2 }, { key: "description", label: "Description", width: 4 }, { key: "status", label: "Status" }, { key: "treeCount", label: "Trees" }, { key: "createdAt", label: "Created" }],
  },
  trees: {
    title: "Family Trees",
    sql: `SELECT t.id::text, t.tree_reference AS "treeReference", g.name AS gotra,
                 COALESCE(p.full_name, t.current_revision->0->>'name', '') AS "rootName",
                 COALESCE(t.village,'') AS village, t.status, t.revision_number AS "revisionNumber",
                 t.submitted_at::text AS "submittedAt", t.verified_at::text AS "verifiedAt"
            FROM family_trees t LEFT JOIN gotras g ON g.id = t.gotra_id
            LEFT JOIN people p ON p.id = t.root_person_id
           ORDER BY t.created_at DESC LIMIT 10000`,
    columns: [{ key: "treeReference", label: "Reference" }, { key: "gotra", label: "Gotra" }, { key: "rootName", label: "Root", width: 2 }, { key: "village", label: "Village" }, { key: "status", label: "Status" }, { key: "revisionNumber", label: "Rev" }, { key: "verifiedAt", label: "Verified" }],
  },
  members: {
    title: "Family Members",
    sql: `SELECT p.id::text, p.public_id AS "publicId", p.full_name AS name,
                 COALESCE(p.wife_name,'') AS "wifeName", COALESCE(p.village,'') AS village,
                 COALESCE(p.member_type,'') AS "memberType", p.status, g.name AS gotra,
                 t.tree_reference AS "treeReference", p.created_at::text AS "createdAt"
            FROM people p LEFT JOIN family_trees t ON t.id = p.family_tree_id
            LEFT JOIN gotras g ON g.id = t.gotra_id
           ORDER BY p.full_name LIMIT 10000`,
    columns: [{ key: "name", label: "Name", width: 2 }, { key: "wifeName", label: "Spouse", width: 2 }, { key: "village", label: "Village" }, { key: "memberType", label: "Role" }, { key: "gotra", label: "Gotra" }, { key: "treeReference", label: "Tree" }, { key: "status", label: "Status" }],
  },
  verifications: {
    title: "Verification History",
    sql: `SELECT v.id::text, t.tree_reference AS "treeReference", v.decision,
                 COALESCE(v.remarks,'') AS remarks, a.email AS admin,
                 v.created_at::text AS "createdAt"
            FROM verification_records v
            JOIN family_trees t ON t.id = v.family_tree_id
            LEFT JOIN admins a ON a.id = v.admin_id
           ORDER BY v.created_at DESC LIMIT 10000`,
    columns: [{ key: "treeReference", label: "Tree" }, { key: "decision", label: "Decision" }, { key: "remarks", label: "Remarks", width: 4 }, { key: "admin", label: "Admin" }, { key: "createdAt", label: "Created" }],
  },
  audit: {
    title: "Admin Activity",
    sql: `SELECT a.id::text, COALESCE(ad.email,'system') AS admin, a.action, a.entity_type AS "entityType",
                 COALESCE(a.category,'') AS category, COALESCE(a.severity,'') AS severity,
                 a.created_at::text AS "createdAt"
            FROM genealogy_audit a LEFT JOIN admins ad ON ad.id = a.admin_id
           ORDER BY a.created_at DESC LIMIT 10000`,
    columns: [{ key: "createdAt", label: "When" }, { key: "admin", label: "Admin" }, { key: "action", label: "Action", width: 2 }, { key: "entityType", label: "Entity" }, { key: "category", label: "Category" }, { key: "severity", label: "Severity" }],
  },
  duplicates: {
    title: "Duplicate Candidates",
    sql: `SELECT d.id::text, d.entity_type AS "entityType", d.score::text AS score,
                 d.status, COALESCE(d.reasons::text,'') AS reasons,
                 d.created_at::text AS "createdAt"
            FROM duplicate_candidates d ORDER BY d.score DESC, d.created_at DESC LIMIT 10000`,
    columns: [{ key: "entityType", label: "Type" }, { key: "score", label: "Score" }, { key: "status", label: "Status" }, { key: "reasons", label: "Reasons", width: 5 }, { key: "createdAt", label: "Detected" }],
  },
  villages: {
    title: "Village Directory",
    sql: `SELECT lower(btrim(v.village)) AS key, min(btrim(v.village)) AS village,
                 COUNT(*) FILTER (WHERE v.source = 'people')::int AS "peopleCount",
                 COUNT(*) FILTER (WHERE v.source = 'trees')::int AS "treeCount"
            FROM (
              SELECT village, 'people' AS source FROM people WHERE village IS NOT NULL AND btrim(village) <> ''
              UNION ALL
              SELECT village, 'trees' AS source FROM family_trees WHERE village IS NOT NULL AND btrim(village) <> ''
            ) v GROUP BY 1 ORDER BY 2 LIMIT 10000`,
    columns: [{ key: "village", label: "Village", width: 2 }, { key: "peopleCount", label: "People" }, { key: "treeCount", label: "Trees" }],
  },
  accounts: {
    title: "Admin Accounts",
    sql: `SELECT id::text, email, COALESCE(display_name, '') AS "displayName", role,
                 is_active AS "isActive", COALESCE(last_login_at::text,'') AS "lastLoginAt",
                 created_at::text AS "createdAt"
            FROM admins ORDER BY created_at DESC LIMIT 10000`,
    columns: [{ key: "email", label: "Email", width: 3 }, { key: "displayName", label: "Name", width: 2 }, { key: "role", label: "Role" }, { key: "isActive", label: "Active" }, { key: "lastLoginAt", label: "Last login" }],
  },
  links: {
    title: "Tree Links",
    sql: `SELECT l.id::text, s.tree_reference AS source, t.tree_reference AS target,
                 l.status, COALESCE(l.notes,'') AS notes, a.email AS admin,
                 l.created_at::text AS "createdAt"
            FROM tree_links l
            JOIN family_trees s ON s.id = l.source_tree_id
            JOIN family_trees t ON t.id = l.target_tree_id
            LEFT JOIN admins a ON a.id = l.linking_admin_id
           ORDER BY l.created_at DESC LIMIT 10000`,
    columns: [{ key: "source", label: "Source" }, { key: "target", label: "Target" }, { key: "status", label: "Status" }, { key: "admin", label: "Admin" }, { key: "createdAt", label: "Created" }],
  },
  branches: {
    title: "Family Branches",
    sql: `SELECT b.id::text, b.name, g.name AS gotra, b.status,
                 COALESCE(parent.name,'') AS parent, b.created_at::text AS "createdAt"
            FROM family_branches b JOIN gotras g ON g.id = b.gotra_id
            LEFT JOIN family_branches parent ON parent.id = b.parent_branch_id
           ORDER BY g.name, b.name LIMIT 10000`,
    columns: [{ key: "name", label: "Branch", width: 2 }, { key: "gotra", label: "Gotra" }, { key: "parent", label: "Parent" }, { key: "status", label: "Status" }, { key: "createdAt", label: "Created" }],
  },
  contributions: {
    title: "Public Contributions",
    sql: `SELECT c.id::text, c.contribution_type AS type, COALESCE(c.proposed_name,'') AS name,
                 COALESCE(c.proposed_village,'') AS village, c.contributor_name AS contributor,
                 c.status, c.submitted_at::text AS "submittedAt"
            FROM genealogy_contributions c ORDER BY c.submitted_at DESC LIMIT 10000`,
    columns: [{ key: "type", label: "Type" }, { key: "name", label: "Name", width: 2 }, { key: "village", label: "Village" }, { key: "contributor", label: "Contributor" }, { key: "status", label: "Status" }, { key: "submittedAt", label: "Submitted" }],
  },
  notifications: {
    title: "Notifications",
    sql: `SELECT n.id::text, n.type, n.title, COALESCE(n.body,'') AS body,
                 COALESCE(a.email,'All admins') AS recipient,
                 COALESCE(n.read_at::text,'') AS "readAt", n.created_at::text AS "createdAt"
            FROM notifications n LEFT JOIN admins a ON a.id = n.admin_id
           ORDER BY n.created_at DESC LIMIT 10000`,
    columns: [{ key: "createdAt", label: "Created" }, { key: "type", label: "Type" }, { key: "title", label: "Title", width: 2 }, { key: "body", label: "Message", width: 4 }, { key: "recipient", label: "Recipient" }],
  },
};

async function fetchExportData(pool, dataset) {
  const config = EXPORT_DATASETS[dataset];
  if (!config) return null;
  const result = await pool.query(config.sql);
  return { title: config.title, columns: config.columns, rows: result.rows };
}

module.exports = {
  MODULES,
  GROUPS,
  MODULE_BY_ID,
  makePermissionGuard,
  loadPermissions,
  makeAdminLogger,
  makeNotifier,
  paginate,
  dateWindow,
  asBool,
  clean,
  uuidOrNull,
  EXPORT_DATASETS,
  fetchExportData,
};
