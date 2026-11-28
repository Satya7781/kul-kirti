/**
 * vanshawali-routes.js
 * --------------------
 * Gotra-first family tree API. Registered from server.js so the existing
 * server (auth, rate limits, audit helper, projection refresh) is reused
 * rather than duplicated.
 */
"use strict";

const crypto = require("crypto");
const vsh = require("./vanshawali");
const { noStore } = require("./http-security");

const wrap = fn => (request, response, next) => Promise.resolve(fn(request, response, next)).catch(next);
const newToken = () => crypto.randomBytes(18).toString("hex").toUpperCase();
const TOKEN_TTL_DAYS = 30;
const tokenExpiry = () => new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
/* Revision members are deliberately unordered — find the root by type. */
const ROOT_NAME_SQL = `(SELECT e->>'name' FROM jsonb_array_elements(t.current_revision) e WHERE e->>'memberType' = 'root' LIMIT 1)`;

/** Tokens are bearer credentials: revoked or expired tokens are not accepted. */
async function treeByToken(pool, token) {
  const result = await pool.query(
    `SELECT t.*, g.name AS gotra_name, g.status AS gotra_status, g.is_active AS gotra_is_active
       FROM family_trees t JOIN gotras g ON g.id = t.gotra_id
      WHERE t.edit_token = $1
        AND t.token_revoked_at IS NULL
        AND (t.token_expires_at IS NULL OR t.token_expires_at > NOW())`,
    [token]
  );
  return result.rows[0] || null;
}

async function treeById(pool, id) {
  const result = await pool.query(
    `SELECT t.*, g.name AS gotra_name, g.status AS gotra_status, g.is_active AS gotra_is_active
       FROM family_trees t JOIN gotras g ON g.id = t.gotra_id
      WHERE t.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/** Build the box/edge data the visual renderer consumes. */
async function visualForTree(ctx, tree, publicView) {
  const peopleResult = await ctx.pool.query(
    `SELECT id, public_id, full_name, wife_name, wife_gotra, married_gotra,
            village, member_type, birth_order, gender, visibility, family_tree_id
       FROM people WHERE family_tree_id = $1 AND status = 'verified'
      ORDER BY birth_order NULLS LAST, full_name`,
    [tree.id]
  );
  let people = publicView
    ? peopleResult.rows.filter(p => p.visibility === "public")
    : peopleResult.rows;
  const ids = people.map(p => p.id);
  let relationships = [];

  if (ids.length) {
    const relResult = await ctx.pool.query(
      `SELECT id, parent_id, child_id, relation_type, status
         FROM person_relationships
        WHERE child_id = ANY($1::uuid[]) AND status = 'verified'`,
      [ids]
    );
    relationships = relResult.rows;
    const inside = new Set(ids);
    const outsideIds = [...new Set(relationships.map(r => r.parent_id))].filter(id => !inside.has(id));
    if (outsideIds.length) {
      const outside = await ctx.pool.query(
        `SELECT id, public_id, full_name, wife_name, wife_gotra, married_gotra,
                village, member_type, birth_order, gender, visibility, family_tree_id
           FROM people WHERE id = ANY($1::uuid[]) AND status = 'verified'`,
        [outsideIds]
      );
      const safe = publicView ? outside.rows.filter(p => p.visibility === "public") : outside.rows;
      people = people.concat(safe);
    }
    /* A public visual must never expose an edge to a private/non-public person. */
    if (publicView) {
      const visible = new Set(people.map(p => p.id));
      relationships = relationships.filter(r => visible.has(r.parent_id) && visible.has(r.child_id));
    }
  }
  const links = await ctx.pool.query(
    `SELECT l.id, l.source_tree_id, l.target_tree_id, l.common_ancestor_person_id,
            l.notes, l.created_at, s.tree_reference AS source_reference,
            t.tree_reference AS target_reference
       FROM tree_links l
       JOIN family_trees s ON s.id = l.source_tree_id
       JOIN family_trees t ON t.id = l.target_tree_id
      WHERE l.status = 'active' AND (l.source_tree_id = $1 OR l.target_tree_id = $1)`,
    [tree.id]
  );
  return {
    treeId: tree.id,
    treeReference: tree.tree_reference,
    rootPersonId: tree.root_person_id,
    gotraName: tree.gotra_name,
    people,
    relationships,
    links: links.rows,
  };
}

/* Audit rows are evidence, not a commit condition.  A failure writing one must
   not abort the decision transaction, so each audit write gets its own
   savepoint and is rolled back independently. */
async function safeAudit(client, logAudit, adminId, action, entityType, entityId, changes, label) {
  try {
    await client.query("SAVEPOINT kk_audit_write");
    await logAudit(client, adminId, action, entityType, entityId, changes);
    await client.query("RELEASE SAVEPOINT kk_audit_write");
  } catch (error) {
    console.error(`[vanshawali] ${label} audit failed:`, error?.message || error);
    try {
      await client.query("ROLLBACK TO SAVEPOINT kk_audit_write");
      await client.query("RELEASE SAVEPOINT kk_audit_write");
    } catch (cleanupError) {
      console.error("[vanshawali] audit savepoint cleanup failed:", cleanupError?.message || cleanupError);
    }
  }
}

/* The DB has integrity triggers that can reject an edge even after the
   application pre-checks pass (concurrent writes, third biological parent,
   cycle).  A rejected edge must be skipped like any other invalid edge — it
   must never abort the whole approval with an opaque P0001. */
async function safeRelationshipInsert(client, parentId, childId, adminId, memberName, skipped) {
  try {
    await client.query("SAVEPOINT kk_relationship_write");
    await client.query(
      `INSERT INTO person_relationships (parent_id, child_id, relation_type, status, created_by, approved_by)
       VALUES ($1,$2,'biological','verified',$3,$4)
       ON CONFLICT (parent_id, child_id, relation_type) DO NOTHING`,
      [parentId, childId, adminId, adminId]
    );
    await client.query("RELEASE SAVEPOINT kk_relationship_write");
    return true;
  } catch (error) {
    const recoverable = ["P0001", "23514", "23505", "23503"].includes(error?.code);
    try {
      await client.query("ROLLBACK TO SAVEPOINT kk_relationship_write");
      await client.query("RELEASE SAVEPOINT kk_relationship_write");
    } catch (cleanupError) {
      console.error("[vanshawali] relationship savepoint cleanup failed:", cleanupError?.message || cleanupError);
    }
    if (!recoverable) throw error;
    console.error("[vanshawali] relationship rejected by database:", error?.message || error);
    skipped.push({ member: memberName, reason: `relationship_rejected:${String(error?.message || "unknown").slice(0, 120)}` });
    return false;
  }
}

/** Turn a validated revision into canonical people + relationships atomically. */
async function materialize(ctx, client, tree, members, adminId) {
  const { clean, uuidOrNull, genealogy, logAudit, pool } = ctx;
  const gotraId = tree.gotra_id;
  const idMap = new Map();
  const skipped = [];

  // Pass 1: people (entry order is irrelevant).
  for (const m of members) {
    let personId = null;
    if (m.existingPersonId) {
      const found = await client.query("SELECT id FROM people WHERE id = $1", [uuidOrNull(m.existingPersonId)]);
      personId = found.rows[0]?.id || null;
      if (!personId) skipped.push({ member: m.name, reason: "existing_person_not_found" });
    }
    if (!personId) {
      if (!m.name) { skipped.push({ member: m.clientId, reason: "missing_name" }); continue; }
      const isDaughter = m.memberType === "daughter";
      const inserted = await client.query(
        `INSERT INTO people
           (full_name, wife_name, wife_gotra, married_gotra, village, member_type,
            birth_order, gender, family_tree_id, status, visibility, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified','public',$10,$11)
         RETURNING id, public_id`,
        [m.name, isDaughter ? null : (m.wifeName || null),
         isDaughter ? null : (m.wifeGotra || null),
         isDaughter ? (m.marriedGotra || null) : null,
         isDaughter ? null : m.village, m.memberType, m.birthOrder,
         m.gender || null, tree.id, adminId, adminId]
      );
      personId = inserted.rows[0].id;
    }
    idMap.set(m.clientId, personId);
    await client.query(
      `INSERT INTO person_gotra_links (person_id, gotra_id, is_root)
       VALUES ($1,$2,$3) ON CONFLICT (person_id, gotra_id) DO NOTHING`,
      [personId, gotraId, m.memberType === "root"]
    );
  }

  // Pass 2: parent-child edges, validated against committed + just-created rows.
  for (const m of members) {
    if (m.memberType === "root" || !m.parentId) continue;
    const childId = idMap.get(m.clientId);
    const parentId = idMap.get(m.parentId);
    if (!childId || !parentId) {
      skipped.push({ member: m.name, reason: "parent_not_resolved" });
      continue;
    }
    const check = await genealogy.validateRelationship(client, parentId, childId, "biological");
    if (!check.valid) {
      skipped.push({ member: m.name, reason: check.error, role: "father" });
      continue;
    }
    await safeRelationshipInsert(client, parentId, childId, adminId, m.name, skipped);
  }

  await safeAudit(client, logAudit, adminId, "verify_family_tree", "family_tree", tree.id, {
    treeReference: tree.tree_reference,
    gotraId,
    membersLinked: idMap.size,
    skipped,
  }, "verification materialisation");
  return { idMap, skipped };
}

module.exports = function registerVanshawaliRoutes(app, ctx) {
  const { pool, auth, requireRole, clean, uuidOrNull, msg, logAudit, refreshTreeProjection,
          genealogy, rateLimit } = ctx;
  const admin = ["super_admin", "admin"];
  const superOnly = ["super_admin"];

  /* Token-bearing tree endpoints must never be cached by a proxy or browser. */
  app.use("/api/vanshawali/trees", noStore);
  const tokenReadLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 120 });
  const saveLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 60 });
  const submitLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

  /* ── Public: unified search (Gotra / person / root / village / ref) ──── */
  app.get("/api/vanshawali/search", wrap(async (request, response) => {
    const q = clean(request.query.q, 120);
    const type = clean(request.query.type, 20);
    if (q.length < 2) return response.json({ results: [], total: 0 });
    const like = `%${q}%`;
    const results = [];

    if (type === "" || type === "person") {
      const matched = await pool.query(
        `SELECT p.id, p.public_id, p.full_name, p.wife_name, p.village, p.member_type,
                g.name AS gotra_name, t.id AS tree_id, t.tree_reference
           FROM people p
           LEFT JOIN family_trees t ON t.id = p.family_tree_id
           LEFT JOIN gotras g ON g.id = t.gotra_id
          WHERE p.status = 'verified' AND p.visibility = 'public'
            AND (p.full_name ILIKE $1 OR p.wife_name ILIKE $1 OR p.village ILIKE $1)
          ORDER BY p.full_name LIMIT 20`, [like]
      );
      /* Two batched recursive queries replace the old 40-per-request N+1.
         Both endpoints must be verified and public before an edge is shown. */
      const personIds = matched.rows.map(p => p.id);
      const ancestorsByPerson = new Map();
      const descendantsByPerson = new Map();
      if (personIds.length) {
        const ancestorRows = await pool.query(
          `WITH RECURSIVE chain AS (
             SELECT r.child_id AS start_id, r.parent_id AS id, 1 AS depth
               FROM person_relationships r
              WHERE r.child_id = ANY($1::uuid[]) AND r.status = 'verified'
            UNION ALL
             SELECT c.start_id, r.parent_id, c.depth + 1
               FROM chain c
               JOIN person_relationships r ON r.child_id = c.id AND r.status = 'verified'
              WHERE c.depth < 30
           )
           SELECT c.start_id, p.public_id, p.full_name, c.depth
             FROM chain c
             JOIN people p ON p.id = c.id
              AND p.status = 'verified' AND p.visibility = 'public'
            ORDER BY c.start_id, c.depth DESC`, [personIds]
        );
        for (const row of ancestorRows.rows) {
          if (!ancestorsByPerson.has(row.start_id)) ancestorsByPerson.set(row.start_id, []);
          ancestorsByPerson.get(row.start_id).push(row);
        }
        const descendantRows = await pool.query(
          `WITH RECURSIVE down AS (
             SELECT r.parent_id AS start_id, r.child_id AS id, 1 AS depth
               FROM person_relationships r
              WHERE r.parent_id = ANY($1::uuid[]) AND r.status = 'verified'
            UNION ALL
             SELECT d.start_id, r.child_id, d.depth + 1
               FROM down d
               JOIN person_relationships r ON r.parent_id = d.id AND r.status = 'verified'
              WHERE d.depth < 30
           )
           SELECT d.start_id, COUNT(DISTINCT d.id)::int AS n
             FROM down d
             JOIN people p ON p.id = d.id
              AND p.status = 'verified' AND p.visibility = 'public'
            GROUP BY d.start_id`, [personIds]
        );
        for (const row of descendantRows.rows) descendantsByPerson.set(row.start_id, row.n);
      }
      for (const p of matched.rows) {
        results.push({
          kind: "person", id: p.public_id, name: p.full_name, wifeName: p.wife_name,
          village: p.village, gotraName: p.gotra_name, treeReference: p.tree_reference,
          treeId: p.tree_id,
          path: ancestorsByPerson.get(p.id) || [],
          descendantCount: descendantsByPerson.get(p.id) || 0,
          deepLink: p.tree_id
            ? `/vanshawali.html?tree=${encodeURIComponent(p.tree_id)}&person=${encodeURIComponent(p.public_id)}`
            : `/vanshawali.html?person=${encodeURIComponent(p.public_id)}`,
        });
      }
    }

    if (type === "" || type === "tree") {
      const trees = await pool.query(
        `SELECT t.id, t.tree_reference, t.village, g.name AS gotra_name,
                coalesce((SELECT p.full_name FROM people p WHERE p.id = t.root_person_id),
                         ${ROOT_NAME_SQL}) AS root_name,
                (SELECT COUNT(*) FROM people p WHERE p.family_tree_id = t.id
                  AND p.status = 'verified' AND p.visibility = 'public') AS member_count
           FROM family_trees t JOIN gotras g ON g.id = t.gotra_id
          WHERE t.status = 'verified'
            AND (t.tree_reference ILIKE $1 OR t.village ILIKE $1
                 OR coalesce((SELECT p.full_name FROM people p WHERE p.id = t.root_person_id),
                             ${ROOT_NAME_SQL}) ILIKE $1)
          ORDER BY t.verified_at DESC LIMIT 20`, [like]
      );
      trees.rows.forEach(t => results.push({
        kind: "tree", id: t.id, name: t.root_name || t.tree_reference,
        treeReference: t.tree_reference, gotraName: t.gotra_name,
        village: t.village, memberCount: Number(t.member_count),
        deepLink: `/vanshawali.html?tree=${encodeURIComponent(t.id)}`,
      }));
    }

    if (type === "" || type === "gotra") {
      const gotras = await pool.query(
        `SELECT g.id, g.name, g.description,
                (SELECT COUNT(*) FROM family_trees t WHERE t.gotra_id = g.id AND t.status = 'verified') AS tree_count
           FROM gotras g WHERE g.is_active AND g.status = 'verified' AND g.name ILIKE $1
          ORDER BY g.name LIMIT 20`, [like]
      );
      gotras.rows.forEach(g => results.push({
        kind: "gotra", id: g.id, name: g.name, gotraName: g.name,
        description: g.description, treeCount: Number(g.tree_count),
        deepLink: `/vanshawali.html?gotra=${encodeURIComponent(g.id)}`,
      }));
    }

    if (type === "" || type === "village") {
      const villages = await pool.query(
        `SELECT p.village, COUNT(DISTINCT p.family_tree_id)::int AS tree_count
           FROM people p
          WHERE p.status = 'verified' AND p.visibility = 'public' AND p.village ILIKE $1
          GROUP BY p.village ORDER BY p.village LIMIT 20`, [like]
      );
      villages.rows.forEach(v => results.push({
        kind: "village", id: v.village, name: v.village, village: v.village,
        treeCount: v.tree_count,
        deepLink: `/vanshawali.html?q=${encodeURIComponent(v.village)}`,
      }));
    }
    response.json({ results, total: results.length });
  }));

  /* ── Public: Gotra directory for new tree creation ───────────────────── */
  app.get("/api/vanshawali/gotras", wrap(async (request, response) => {
    const q = clean(request.query.q, 120).toLowerCase();
    const result = await pool.query(
      `SELECT g.id, g.name, g.description, g.status,
              (SELECT COUNT(*) FROM family_trees t WHERE t.gotra_id = g.id AND t.status = 'verified') AS tree_count,
              (SELECT COUNT(*) FROM people p JOIN family_trees t ON t.id = p.family_tree_id
                WHERE t.gotra_id = g.id AND p.status = 'verified' AND p.visibility = 'public') AS member_count
         FROM gotras g
        WHERE g.is_active AND g.status = 'verified'
          AND ($1 = '' OR lower(g.name) LIKE '%' || $1 || '%'
                       OR coalesce(g.normalized_name, '') LIKE '%' || $1 || '%')
        ORDER BY g.name LIMIT 200`,
      [q]
    );
    response.json({ gotras: result.rows });
  }));

  /* ── Public: create a draft tied to an existing Gotra ────────────────── */
  app.post("/api/vanshawali/trees", rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }), wrap(async (request, response) => {
    const input = request.body || {};
    const gotraId = uuidOrNull(input.gotraId);
    const submitterName = clean(input.submitterName, 120);
    if (!gotraId || !submitterName) {
      return response.status(400).json({ error: msg(request, "गोत्र और आपका नाम आवश्यक है।", "Gotra and your name are required.") });
    }
    if (input.consent !== true) {
      return response.status(400).json({
        error: msg(request, "कृपया गोपनीयता नीति और डेटा retention सूचना पढ़कर सहमति दें।",
          "Please read the privacy notice and consent before creating a tree."),
      });
    }
    const gotra = await pool.query(
      "SELECT id FROM gotras WHERE id = $1 AND is_active AND status = 'verified'", [gotraId]
    );
    if (!gotra.rows.length) {
      return response.status(400).json({ error: msg(request, "यह गोत्र नए वृक्ष के लिए उपलब्ध नहीं है। कृपया प्रशासक से संपर्क करें।", "This Gotra is not available for new trees. Please contact the administrator.") });
    }
    const result = await pool.query(
      `INSERT INTO family_trees
         (gotra_id, edit_token, token_expires_at, consent_at,
          submitter_name, submitter_contact, village, district, state)
       VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8)
       RETURNING id, tree_reference, edit_token, status, revision_number, created_at`,
      [gotraId, newToken(), tokenExpiry(), submitterName, clean(input.submitterContact, 120),
       clean(input.village, 120), clean(input.district, 120), clean(input.state, 120)]
    );
    response.status(201).json({
      tree: result.rows[0],
      message: msg(request, "वंशावली ड्राफ्ट तैयार है।", "Family tree draft created."),
    });
  }));

  /* ── Public: token-owned view / preview / status ─────────────────────── */
  app.get("/api/vanshawali/trees/:token", tokenReadLimit, wrap(async (request, response) => {
    const tree = await treeByToken(pool, clean(request.params.token, 40));
    if (!tree) return response.status(404).json({ error: msg(request, "वृक्ष नहीं मिला।", "Tree not found.") });
    const records = await pool.query(
      `SELECT revision_number, decision, remarks, created_at
         FROM verification_records WHERE family_tree_id = $1 ORDER BY created_at DESC`,
      [tree.id]
    );
    const visual = tree.status === "verified" ? await visualForTree(ctx, tree, true) : null;
    response.json({
      tree: {
        id: tree.id, treeReference: tree.tree_reference, gotraId: tree.gotra_id,
        gotraName: tree.gotra_name, status: tree.status, revisionNumber: tree.revision_number,
        reviewNotes: tree.review_notes, village: tree.village, district: tree.district,
        state: tree.state, submitterName: tree.submitter_name,
        submittedAt: tree.submitted_at, verifiedAt: tree.verified_at,
      },
      members: tree.current_revision || [],
      verificationRecords: records.rows,
      visual,
    });
  }));

  /* ── Public: save a draft (or a correction after admin feedback) ─────── */
  app.put("/api/vanshawali/trees/:token", saveLimit, wrap(async (request, response) => {
    const tree = await treeByToken(pool, clean(request.params.token, 40));
    if (!tree) return response.status(404).json({ error: msg(request, "वृक्ष नहीं मिला।", "Tree not found.") });
    if (!["draft", "correction_required"].includes(tree.status)) {
      return response.status(409).json({ error: msg(request, "यह वृक्ष अब संपादित नहीं किया जा सकता।", "This tree can no longer be edited.") });
    }
    const input = request.body || {};
    const checked = vsh.validateTreeMembers(input.members);
    if (!checked.valid) {
      return response.status(400).json({ error: msg(request, `ड्राफ्ट अमान्य है: ${checked.error}`, `Invalid draft: ${checked.error}`) });
    }
    await pool.query(
      `UPDATE family_trees
          SET current_revision = $1::jsonb,
              village = $2, district = $3, state = $4,
              revision_number = CASE WHEN status = 'correction_required' THEN revision_number + 1 ELSE revision_number END,
              status = CASE WHEN status = 'correction_required' THEN 'pending' ELSE status END,
              submitted_at = CASE WHEN status = 'correction_required' THEN NOW() ELSE submitted_at END,
              updated_at = NOW()
        WHERE id = $5`,
      [JSON.stringify(checked.members), clean(input.village, 120), clean(input.district, 120),
       clean(input.state, 120), tree.id]
    );
    response.json({ message: msg(request, "ड्राफ्ट सहेजा गया।", "Draft saved.") });
  }));

  /* ── Public: submit for verification ─────────────────────────────────── */
  app.post("/api/vanshawali/trees/:token/submit", submitLimit, wrap(async (request, response) => {
    const tree = await treeByToken(pool, clean(request.params.token, 40));
    if (!tree) return response.status(404).json({ error: msg(request, "वृक्ष नहीं मिला।", "Tree not found.") });
    if (!["draft", "correction_required"].includes(tree.status)) {
      return response.status(409).json({ error: msg(request, "यह वृक्ष पहले ही सबमिट हो चुका है।", "This tree was already submitted.") });
    }
    const input = request.body || {};
    const checked = vsh.validateTreeMembers(input.members || tree.current_revision);
    if (!checked.valid) {
      return response.status(400).json({ error: msg(request, `वृक्ष अधूरा है: ${checked.error}`, `Incomplete tree: ${checked.error}`) });
    }
    /* The edit token is a bearer credential.  Rotate it at submit so anyone who
       saw the draft link (browser history, screenshots) cannot keep editing. */
    const rotatedToken = newToken();
    const result = await pool.query(
      `UPDATE family_trees
          SET current_revision = $1::jsonb, status = 'pending', revision_number = revision_number + 1,
              edit_token = $2, token_expires_at = $3, submitted_at = NOW(), updated_at = NOW()
        WHERE id = $4 AND edit_token = $5 AND token_revoked_at IS NULL
        RETURNING tree_reference, revision_number, edit_token`,
      [JSON.stringify(checked.members), rotatedToken, tokenExpiry(), tree.id, tree.edit_token]
    );
    if (!result.rows[0]) {
      return response.status(409).json({ error: msg(request, "यह लिंक अब मान्य नहीं है।", "This link is no longer valid.") });
    }
    response.json({
      token: result.rows[0].edit_token,
      treeReference: result.rows[0].tree_reference,
      revisionNumber: result.rows[0].revision_number,
      message: msg(request, "वृक्ष सत्यापन के लिए भेजा गया। कृपया नया टोकन सुरक्षित रखें; पुराना टोकन अब मान्य नहीं है।",
        "Tree submitted for verification. Save the new token; the old token is no longer valid."),
    });
  }));

  /* ── Public: holder-initiated token revocation ─────────────────────────── */
  app.post("/api/vanshawali/trees/:token/revoke", tokenReadLimit, wrap(async (request, response) => {
    const tree = await treeByToken(pool, clean(request.params.token, 40));
    if (!tree) return response.status(404).json({ error: msg(request, "वृक्ष नहीं मिला।", "Tree not found.") });
    await pool.query(
      "UPDATE family_trees SET token_revoked_at = NOW(), updated_at = NOW() WHERE id = $1",
      [tree.id]
    );
    response.json({ message: msg(request, "संपादन लिंक नष्ट कर दिया गया।", "Edit link destroyed.") });
  }));

  /* ── Public: contributor data requests ────────────────────────────────── */
  app.delete("/api/vanshawali/trees/:token", submitLimit, wrap(async (request, response) => {
    const tree = await treeByToken(pool, clean(request.params.token, 40));
    if (!tree) return response.status(404).json({ error: msg(request, "वृक्ष नहीं मिला।", "Tree not found.") });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (tree.status === "verified") {
        /* Verified genealogical rows are public history; queue for admin review
           rather than silently erasing links and audit records. */
        await client.query(
          `INSERT INTO privacy_requests (family_tree_id, request_type, details)
           VALUES ($1,'delete',$2)
           ON CONFLICT DO NOTHING`,
          [tree.id, "Contributor requested removal of verified tree data"]
        );
        await client.query(
          "UPDATE family_trees SET delete_requested_at = NOW(), token_revoked_at = NOW(), updated_at = NOW() WHERE id = $1",
          [tree.id]
        );
        await client.query("COMMIT");
        return response.json({
          queued: true,
          message: msg(request, "आपका अनुरोध प्रशासक की समीक्षा के लिए दर्ज कर लिया गया है।",
            "Your request has been queued for administrator review."),
        });
      }
      /* Draft/pending data has not entered the public genealogy — remove it now. */
      await client.query(
        `UPDATE family_trees
            SET submitter_name = '[हटाया गया]', submitter_contact = NULL,
                current_revision = '[]'::jsonb, status = 'rejected',
                token_revoked_at = NOW(), deleted_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [tree.id]
      );
      await client.query("COMMIT");
      response.json({
        queued: false,
        message: msg(request, "आपका डेटा हटा दिया गया और लिंक निष्क्रिय कर दिया गया।",
          "Your data has been deleted and the link disabled."),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }));

  /* ── Public: verified tree list + visual (master view data) ──────────── */
  app.get("/api/vanshawali/trees", wrap(async (request, response) => {
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(Number.parseInt(request.query.offset, 10) || 0, 0);
    const q = clean(request.query.q, 120);
    const gotraId = uuidOrNull(request.query.gotraId);
    const result = await pool.query(
      `SELECT t.id, t.tree_reference, t.gotra_id, t.village, t.district, t.state,
              g.name AS gotra_name,
              coalesce((SELECT p.full_name FROM people p WHERE p.id = t.root_person_id),
                       ${ROOT_NAME_SQL}) AS root_name,
              (SELECT COUNT(*) FROM tree_links l
                WHERE l.status = 'active' AND (l.source_tree_id = t.id OR l.target_tree_id = t.id)) AS link_count,
              COUNT(*) OVER() AS total
         FROM family_trees t JOIN gotras g ON g.id = t.gotra_id
        WHERE t.status = 'verified'
          AND ($1::uuid IS NULL OR t.gotra_id = $1)
          AND ($2 = '' OR coalesce(${ROOT_NAME_SQL},'') ILIKE '%' || $2 || '%'
                       OR t.village ILIKE '%' || $2 || '%'
                       OR t.tree_reference ILIKE '%' || $2 || '%')
        ORDER BY t.verified_at DESC LIMIT $3 OFFSET $4`,
      [gotraId, q, limit, offset]
    );
    response.json({ trees: result.rows, total: result.rows[0] ? Number(result.rows[0].total) : 0, limit, offset });
  }));

  app.get("/api/vanshawali/trees/:id/visual", wrap(async (request, response) => {
    const tree = await treeById(pool, uuidOrNull(request.params.id));
    if (!tree || tree.status !== "verified") {
      return response.status(404).json({ error: msg(request, "सार्वजनिक वृक्ष नहीं मिला।", "Verified tree not found.") });
    }
    response.json(await visualForTree(ctx, tree, true));
  }));

  /* ═══ ADMIN: Gotra management (enhanced) ═══════════════════════════════ */
  app.get("/api/admin/vanshawali/gotras", auth, requireRole(...admin), wrap(async (request, response) => {
    const q = clean(request.query.q, 120).toLowerCase();
    const result = await pool.query(
      `SELECT g.id, g.name, g.normalized_name, g.description, g.status, g.is_active,
              (SELECT COUNT(*) FROM family_trees t WHERE t.gotra_id = g.id) AS tree_count,
              (SELECT COUNT(*) FROM people p JOIN family_trees t ON t.id = p.family_tree_id
                WHERE t.gotra_id = g.id) AS member_count,
              COUNT(*) OVER() AS total
         FROM gotras g
        WHERE ($1 = '' OR lower(g.name) LIKE '%' || $1 || '%'
                       OR coalesce(g.normalized_name, '') LIKE '%' || $1 || '%')
        ORDER BY g.name LIMIT 200`,
      [q]
    );
    response.json({ gotras: result.rows, total: result.rows[0] ? Number(result.rows[0].total) : 0 });
  }));

  app.post("/api/admin/vanshawali/gotras", auth, requireRole(...superOnly), wrap(async (request, response) => {
    const input = request.body || {};
    const name = clean(input.name, 120);
    const normalized = vsh.normalizeName(name);
    if (!name || !normalized) {
      return response.status(400).json({ error: msg(request, "गोत्र का नाम आवश्यक है।", "Gotra name is required.") });
    }
    const duplicate = await pool.query("SELECT id FROM gotras WHERE normalized_name = $1", [normalized]);
    if (duplicate.rows.length) {
      return response.status(409).json({ error: msg(request, "यह गोत्र पहले से मौजूद है।", "This Gotra already exists.") });
    }
    const status = ["draft", "verified"].includes(input.status) ? input.status : "verified";
    try {
      const result = await pool.query(
        `INSERT INTO gotras (name, normalized_name, description, status, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, status, is_active`,
        [name, normalized, clean(input.description, 500), status, input.isActive !== false, request.admin.id]
      );
      await logAudit(pool, request.admin.id, "create_gotra", "gotra", result.rows[0].id,
        { name, status, isActive: result.rows[0].is_active });
      response.status(201).json({ gotra: result.rows[0], message: msg(request, "गोत्र जोड़ा गया।", "Gotra created.") });
    } catch (error) {
      if (error.code === "23505") {
        return response.status(409).json({ error: msg(request, "यह गोत्र पहले से मौजूद है।", "This Gotra already exists.") });
      }
      throw error;
    }
  }));

  app.patch("/api/admin/vanshawali/gotras/:id", auth, requireRole(...superOnly), wrap(async (request, response) => {
    const input = request.body || {};
    const id = uuidOrNull(request.params.id);
    if (!id) return response.status(400).json({ error: "Invalid gotra id." });
    const current = await pool.query("SELECT * FROM gotras WHERE id = $1", [id]);
    if (!current.rows.length) return response.status(404).json({ error: "Gotra not found." });
    const name = input.name !== undefined ? clean(input.name, 120) : current.rows[0].name;
    const normalized = vsh.normalizeName(name);
    if (!normalized) return response.status(400).json({ error: "Gotra name is required." });
    const duplicate = await pool.query("SELECT id FROM gotras WHERE normalized_name = $1 AND id <> $2", [normalized, id]);
    if (duplicate.rows.length) {
      return response.status(409).json({ error: msg(request, "यह गोत्र पहले से मौजूद है।", "This Gotra already exists.") });
    }
    const status = ["draft", "verified"].includes(input.status) ? input.status : current.rows[0].status;
    const isActive = input.isActive === undefined ? current.rows[0].is_active : Boolean(input.isActive);
    try {
      const result = await pool.query(
        `UPDATE gotras SET name=$1, normalized_name=$2, description=$3, status=$4,
                is_active=$5, updated_at=NOW() WHERE id=$6
         RETURNING id, name, normalized_name, description, status, is_active`,
        [name, normalized, input.description !== undefined ? clean(input.description, 500) : current.rows[0].description,
         status, isActive, id]
      );
      await logAudit(pool, request.admin.id, "update_gotra", "gotra", id,
        { before: current.rows[0], after: result.rows[0] });
      response.json({ gotra: result.rows[0], message: msg(request, "गोत्र अद्यतन किया गया।", "Gotra updated.") });
    } catch (error) {
      if (error.code === "23505") {
        return response.status(409).json({ error: msg(request, "यह गोत्र पहले से मौजूद है।", "This Gotra already exists.") });
      }
      throw error;
    }
  }));

  /* ═══ ADMIN: verification dashboard ═══════════════════════════════════ */
  app.get("/api/admin/vanshawali/trees", auth, requireRole(...admin), wrap(async (request, response) => {
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(Number.parseInt(request.query.offset, 10) || 0, 0);
    const q = clean(request.query.q, 120);
    const status = clean(request.query.status, 40);
    const gotraId = uuidOrNull(request.query.gotraId);
    const result = await pool.query(
      `SELECT t.*, g.name AS gotra_name,
              coalesce((SELECT p.full_name FROM people p WHERE p.id = t.root_person_id),
                       ${ROOT_NAME_SQL}) AS root_name,
              COUNT(*) OVER() AS total
         FROM family_trees t JOIN gotras g ON g.id = t.gotra_id
        WHERE ($1 = '' OR t.status = $1)
          AND ($2::uuid IS NULL OR t.gotra_id = $2)
          AND ($3 = '' OR coalesce(${ROOT_NAME_SQL},'') ILIKE '%' || $3 || '%'
                       OR t.village ILIKE '%' || $3 || '%'
                       OR t.tree_reference ILIKE '%' || $3 || '%')
        ORDER BY t.created_at DESC LIMIT $4 OFFSET $5`,
      [status, gotraId, q, limit, offset]
    );
    response.json({
      trees: result.rows.map(r => ({
        ...r,
        memberCount: Array.isArray(r.current_revision) ? r.current_revision.length : 0,
        total: Number(r.total),
      })),
      total: result.rows[0] ? Number(result.rows[0].total) : 0,
      limit, offset,
    });
  }));

  app.get("/api/admin/vanshawali/trees/:id", auth, requireRole(...admin), wrap(async (request, response) => {
    const tree = await treeById(pool, uuidOrNull(request.params.id));
    if (!tree) return response.status(404).json({ error: "Tree not found." });
    const records = await pool.query(
      `SELECT v.*, a.email AS admin_email FROM verification_records v
         LEFT JOIN admins a ON a.id = v.admin_id
        WHERE v.family_tree_id = $1 ORDER BY v.created_at DESC`, [tree.id]
    );
    response.json({
      tree,
      members: tree.current_revision || [],
      verificationRecords: records.rows,
      visual: tree.status === "verified" ? await visualForTree(ctx, tree, false) : null,
    });
  }));

  /* Exposed on ctx so the unified admin console can reuse the exact same
     verification/materialisation logic instead of duplicating business rules. */
  async function decideTree(request, response) {
    const id = uuidOrNull(request.params.id);
    const decision = clean(request.body?.decision, 40);
    const notes = clean(request.body?.notes, 500);
    const allowed = ["under_review", "correction_required", "reject", "approve"];
    if (!allowed.includes(decision)) {
      return response.status(400).json({ error: msg(request, "अमान्य निर्णय।", "Invalid decision.") });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM family_trees WHERE id = $1 FOR UPDATE", [id]);
      const tree = found.rows[0];
      if (!tree) { await client.query("ROLLBACK"); return response.status(404).json({ error: "Tree not found." }); }
      if (["verified", "rejected"].includes(tree.status)) {
        await client.query("ROLLBACK");
        return response.status(409).json({ error: msg(request, "इस वृक्ष पर पहले ही निर्णय हो चुका है।", "A decision has already been made on this tree.") });
      }

      let skipped = [];
      let rootPersonId = null;
      if (decision === "approve") {
        const checked = vsh.validateTreeMembers(tree.current_revision);
        if (!checked.valid) {
          await client.query("ROLLBACK");
          return response.status(400).json({ error: msg(request, `वृक्ष अमान्य है: ${checked.error}`, `Invalid tree: ${checked.error}`) });
        }
        const result = await materialize(ctx, client, tree, checked.members, request.admin.id);
        skipped = result.skipped;
        rootPersonId = result.idMap.get(checked.members.find(m => m.memberType === "root").clientId) || null;
      }

      const newStatus = { approve: "verified", reject: "rejected" }[decision] || decision;
      await client.query(
        `UPDATE family_trees
            SET status=$1, review_notes=$2, reviewed_by=$3,
                root_person_id=coalesce($4, root_person_id),
                verified_at=CASE WHEN $1='verified' THEN NOW() ELSE verified_at END,
                updated_at=NOW()
          WHERE id=$5`,
        [newStatus, notes, request.admin.id, rootPersonId, id]
      );
      await client.query(
        `INSERT INTO verification_records (family_tree_id, revision_number, admin_id, decision, remarks)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, tree.revision_number, request.admin.id, decision, notes]
      );
      await safeAudit(client, logAudit, request.admin.id, "verify_decision", "family_tree", id,
        { decision, notes, treeReference: tree.tree_reference, skipped }, "verification decision");
      await client.query("COMMIT");
      if (decision === "approve") refreshTreeProjection();
      response.json({
        status: newStatus, skipped,
        message: msg(request, "निर्णय सहेजा गया।", "Decision saved."),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  ctx.decisionHandler = decideTree;
  app.post("/api/admin/vanshawali/trees/:id/decision", auth, requireRole(...admin), wrap(decideTree));

  /* ═══ ADMIN: master-tree linking (non-destructive, reversible) ════════ */
  async function linkTrees(request, response) {
    const sourceId = uuidOrNull(request.params.id);
    const input = request.body || {};
    const targetId = uuidOrNull(input.targetTreeId);
    const ancestorId = uuidOrNull(input.commonAncestorPersonId);
    const anchorId = uuidOrNull(input.sourceAnchorPersonId);
    if (!targetId || !ancestorId || !anchorId || sourceId === targetId) {
      return response.status(400).json({ error: msg(request, "लिंक के लिए सभी फ़ील्ड आवश्यक हैं।", "All link fields are required.") });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      /* Lock both trees in deterministic order to avoid deadlocks when two
         admins link different pairs concurrently. */
      const [firstId, secondId] = sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId];
      const firstRes = await client.query("SELECT * FROM family_trees WHERE id = $1 FOR UPDATE", [firstId]);
      const secondRes = await client.query("SELECT * FROM family_trees WHERE id = $1 FOR UPDATE", [secondId]);
      const byId = new Map([...firstRes.rows, ...secondRes.rows].map(tree => [tree.id, tree]));
      const source = byId.get(sourceId);
      const target = byId.get(targetId);
      if (!source || !target || source.status !== "verified" || target.status !== "verified") {
        await client.query("ROLLBACK");
        return response.status(400).json({ error: msg(request, "केवल सत्यापित वृक्ष जोड़े जा सकते हैं।", "Only verified trees can be linked.") });
      }
      if (source.gotra_id !== target.gotra_id) {
        await client.query("ROLLBACK");
        return response.status(400).json({ error: msg(request, "दोनों वृक्ष एक ही गोत्र के होने चाहिए।", "Both trees must belong to the same Gotra.") });
      }
      const ancestor = await client.query("SELECT id FROM people WHERE id = $1 AND status = 'verified'", [ancestorId]);
      const anchor = await client.query(
        "SELECT id FROM people WHERE id = $1 AND family_tree_id = $2 AND status = 'verified'", [anchorId, sourceId]
      );
      if (!ancestor.rows.length || !anchor.rows.length) {
        await client.query("ROLLBACK");
        return response.status(400).json({ error: msg(request, "चुना हुआ व्यक्ति मान्य नहीं है।", "The selected person is not valid.") });
      }
      const existingParent = await client.query(
        `SELECT r.id FROM person_relationships r
          WHERE r.child_id = $1 AND r.status = 'verified' AND r.relation_type = 'biological' LIMIT 1`,
        [anchorId]
      );
      if (existingParent.rows.length) {
        await client.query("ROLLBACK");
        return response.status(409).json({ error: msg(request, "इस व्यक्ति के पहले से माता-पिता हैं; लिंक विरोधाभासी होगा।", "This person already has parents; the link would be contradictory.") });
      }
      if (genealogy.detectCycle) {
        const cyclic = await genealogy.detectCycle(client, ancestorId, anchorId);
        if (cyclic) {
          await client.query("ROLLBACK");
          return response.status(409).json({ error: msg(request, "यह लिंक चक्रीय वंशावली बनाएगा।", "This link would create a circular genealogy.") });
        }
      }
      const check = await genealogy.validateRelationship(client, ancestorId, anchorId, "biological");
      if (!check.valid) {
        await client.query("ROLLBACK");
        return response.status(400).json({ error: msg(request, `लिंक अस्वीकृत: ${check.error}`, `Link rejected: ${check.error}`) });
      }
      const rel = await client.query(
        `INSERT INTO person_relationships (parent_id, child_id, relation_type, status, created_by, approved_by, evidence_source)
         VALUES ($1,$2,'biological','verified',$3,$4,'admin_link')
         RETURNING id`,
        [ancestorId, anchorId, request.admin.id, request.admin.id]
      );
      const link = await client.query(
        `INSERT INTO tree_links
           (source_tree_id, target_tree_id, common_ancestor_person_id, source_anchor_person_id,
            created_relationship_id, linking_admin_id, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, created_at`,
        [sourceId, targetId, ancestorId, anchorId, rel.rows[0].id, request.admin.id, clean(input.notes, 500)]
      );
      await logAudit(client, request.admin.id, "link_family_trees", "tree_link", link.rows[0].id, {
        sourceTreeId: sourceId, targetTreeId: targetId, commonAncestorPersonId: ancestorId,
        sourceAnchorPersonId: anchorId, notes: clean(input.notes, 500),
      });
      await client.query("COMMIT");
      refreshTreeProjection();
      response.json({ link: link.rows[0], message: msg(request, "वृक्ष सफलतापूर्वक जोड़ा गया।", "Trees linked successfully.") });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  ctx.linkHandler = linkTrees;
  app.post("/api/admin/vanshawali/trees/:id/link", auth, requireRole(...superOnly), wrap(linkTrees));

  async function reverseTreeLink(request, response) {
    const id = uuidOrNull(request.params.id);
    const notes = clean(request.body?.notes, 500);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM tree_links WHERE id = $1 FOR UPDATE", [id]);
      const link = found.rows[0];
      if (!link || link.status !== "active") {
        await client.query("ROLLBACK");
        return response.status(404).json({ error: msg(request, "सक्रिय लिंक नहीं मिला।", "Active link not found.") });
      }
      if (link.created_relationship_id) {
        await client.query("DELETE FROM person_relationships WHERE id = $1", [link.created_relationship_id]);
      }
      await client.query(
        `UPDATE tree_links SET status='reversed', reversed_at=NOW(), reversed_by=$1, reversal_notes=$2 WHERE id=$3`,
        [request.admin.id, notes, id]
      );
      await logAudit(client, request.admin.id, "reverse_tree_link", "tree_link", id, { notes });
      await client.query("COMMIT");
      refreshTreeProjection();
      response.json({ message: msg(request, "लिंक हटाया गया और अभिलेख सुरक्षित है।", "Link reversed and history preserved.") });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  ctx.reverseLinkHandler = reverseTreeLink;
  app.post("/api/admin/vanshawali/tree-links/:id/reverse", auth, requireRole(...superOnly), wrap(reverseTreeLink));

  app.get("/api/admin/vanshawali/tree-links", auth, requireRole(...admin), wrap(async (request, response) => {
    const result = await pool.query(
      `SELECT l.*, s.tree_reference AS source_reference, t.tree_reference AS target_reference,
              a.email AS admin_email
         FROM tree_links l
         JOIN family_trees s ON s.id = l.source_tree_id
         JOIN family_trees t ON t.id = l.target_tree_id
         LEFT JOIN admins a ON a.id = l.linking_admin_id
        ORDER BY l.created_at DESC LIMIT 200`
    );
    response.json({ links: result.rows });
  }));

  /* ═══ ADMIN: verification history + audit + stats ═════════════════════ */
  app.get("/api/admin/vanshawali/verifications", auth, requireRole(...admin), wrap(async (request, response) => {
    const result = await pool.query(
      `SELECT v.*, t.tree_reference, a.email AS admin_email
         FROM verification_records v
         JOIN family_trees t ON t.id = v.family_tree_id
         LEFT JOIN admins a ON a.id = v.admin_id
        ORDER BY v.created_at DESC LIMIT 200`
    );
    response.json({ records: result.rows });
  }));

  app.get("/api/admin/vanshawali/audit", auth, requireRole(...superOnly), wrap(async (request, response) => {
    const entity = clean(request.query.entityType, 60);
    const result = await pool.query(
      `SELECT a.*, adm.email AS admin_email
         FROM genealogy_audit a LEFT JOIN admins adm ON adm.id = a.admin_id
        WHERE ($1 = '' OR a.entity_type = $1)
        ORDER BY a.created_at DESC LIMIT 200`, [entity]
    );
    response.json({ logs: result.rows });
  }));

  /* ═══ ADMIN: contributor privacy requests ══════════════════════════════ */
  app.get("/api/admin/vanshawali/privacy-requests", auth, requireRole(...admin), wrap(async (request, response) => {
    const result = await pool.query(
      `SELECT p.*, t.tree_reference, t.status AS tree_status
         FROM privacy_requests p JOIN family_trees t ON t.id = p.family_tree_id
        WHERE p.status = 'pending'
        ORDER BY p.created_at ASC LIMIT 200`
    );
    response.json({ requests: result.rows });
  }));

  app.post("/api/admin/vanshawali/privacy-requests/:id/fulfil", auth, requireRole(...admin), wrap(async (request, response) => {
    const id = uuidOrNull(request.params.id);
    if (!id) return response.status(400).json({ error: "Invalid request id." });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        `SELECT p.*, t.status AS tree_status FROM privacy_requests p
          JOIN family_trees t ON t.id = p.family_tree_id
         WHERE p.id = $1 FOR UPDATE OF p`, [id]
      );
      const row = found.rows[0];
      if (!row) { await client.query("ROLLBACK"); return response.status(404).json({ error: "Privacy request not found." }); }
      if (row.status !== "pending") {
        await client.query("ROLLBACK");
        return response.status(409).json({ error: "This request has already been handled." });
      }
      /* Anonymise contributor PII and the submitted revision. Canonical verified
         people are kept by an administrator with an explicit audit entry. */
      await client.query(
        `UPDATE family_trees
            SET submitter_name = '[हटाया गया]', submitter_contact = NULL,
                current_revision = '[]'::jsonb, token_revoked_at = NOW(),
                deleted_at = NOW(), updated_at = NOW()
          WHERE id = $1`, [row.family_tree_id]
      );
      await client.query(
        `UPDATE privacy_requests
            SET status = 'fulfilled', fulfilled_at = NOW(), fulfilled_by = $2
          WHERE id = $1`, [id, request.admin.id]
      );
      await logAudit(client, request.admin.id, "fulfil_privacy_request", "privacy_request", id,
        { treeId: row.family_tree_id, requestType: row.request_type });
      await client.query("COMMIT");
      response.json({ message: msg(request, "गोपनीयता अनुरोध पूरी किया गया।", "Privacy request fulfilled.") });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }));

  app.get("/api/admin/vanshawali/stats", auth, requireRole(...admin), wrap(async (request, response) => {
    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM gotras) AS gotras,
         (SELECT COUNT(*) FROM family_trees) AS trees,
         (SELECT COUNT(*) FROM people) AS persons,
         (SELECT COUNT(*) FROM family_trees WHERE status='pending') AS pending,
         (SELECT COUNT(*) FROM family_trees WHERE status='verified') AS verified,
         (SELECT COUNT(*) FROM family_trees WHERE status='correction_required') AS corrections,
         (SELECT COUNT(*) FROM family_trees WHERE status='rejected') AS rejected,
         (SELECT COUNT(*) FROM tree_links WHERE status='active') AS connections`
    );
    response.json(result.rows[0]);
  }));

  /* Rich person search used by the tree-linking comparison panel. */
  app.get("/api/admin/vanshawali/person-search", auth, requireRole(...admin), wrap(async (request, response) => {
    const q = clean(request.query.q, 120);
    if (q.length < 2) return response.json({ people: [] });
    const result = await pool.query(
      `SELECT p.id, p.public_id, p.full_name, p.wife_name, p.village, p.member_type,
              g.name AS gotra_name, t.tree_reference, t.id AS tree_id,
              (SELECT string_agg(parent.full_name, ' → ' ORDER BY parent.full_name)
                 FROM person_relationships r JOIN people parent ON parent.id = r.parent_id
                WHERE r.child_id = p.id AND r.status = 'verified') AS parents
         FROM people p
         LEFT JOIN family_trees t ON t.id = p.family_tree_id
         LEFT JOIN gotras g ON g.id = t.gotra_id
        WHERE p.status = 'verified' AND p.full_name ILIKE '%' || $1 || '%'
        ORDER BY p.full_name LIMIT 20`, [q]
    );
    response.json({ people: result.rows });
  }));
};
