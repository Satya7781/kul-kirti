require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const crypto = require("crypto");
const { createRealtime, rawSql } = require("@neon/realtime/server");
const genealogy = require("./lib/genealogy");
const csvParser = require("./lib/csv-parser");

const app = express();
const port = Number(process.env.PORT || 5500);
const root = __dirname;
const jwtSecret = process.env.JWT_SECRET;
if (!process.env.DATABASE_URL || !jwtSecret) throw new Error("DATABASE_URL and JWT_SECRET are required.");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
const databaseName = new URL(process.env.DATABASE_URL).pathname.slice(1).split("?")[0] || "neondb";
const realtime = process.env.NEON_REALTIME_SECRET ? createRealtime({ secret: process.env.NEON_REALTIME_SECRET, db: databaseName }) : null;
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || `http://localhost:${port}`, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

async function initializeDatabase() {
  const schema = fs.readFileSync(path.join(root, "db", "schema.sql"), "utf8");
  await pool.query(schema);
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required to initialize the admin account.");
  }
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  await pool.query(
    "INSERT INTO admins (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash",
    [process.env.ADMIN_EMAIL.trim().toLowerCase(), passwordHash]
  );
  console.log(`Database schema ready; admin account synchronized for ${process.env.ADMIN_EMAIL.trim().toLowerCase()}.`);
}

function clean(value, max = 500) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

/** Return "hi" if the request prefers Hindi, "en" otherwise. */
function reqLocale(request) {
  const lang = clean(request.query.lang || request.headers["x-lang"] || "", 5);
  if (lang === "en") return "en";
  const accept = request.headers["accept-language"] || "";
  if (accept.startsWith("en")) return "en";
  return "hi"; /* Hindi-first default */
}

/** Bilingual error/success message helper. */
function msg(request, hi, en) {
  return reqLocale(request) === "en" ? en : hi;
}

function auth(request, response, next) {
  const token = request.cookies.kulkirti_admin || request.headers.authorization?.replace("Bearer ", "");
  try { request.admin = jwt.verify(token, jwtSecret); next(); }
  catch { response.status(401).json({ error: "Admin authentication required." }); }
}
function validateSubmission(input) {
  const rawPeople = Array.isArray(input.familyDetails) ? input.familyDetails.slice(0, 1000) : [];
  const clientToId = new Map(rawPeople.map((person) => [clean(person.clientId, 80), crypto.randomUUID()]));
  const familyDetails = rawPeople.map((person) => ({
    id: clientToId.get(clean(person.clientId, 80)) || crypto.randomUUID(),
    name: clean(person.name, 120), gender: clean(person.gender, 30), relation: clean(person.relation, 80),
    birthYear: clean(person.birthYear, 20), deathYear: clean(person.deathYear, 20), notes: clean(person.notes, 300),
    fatherId: clientToId.get(clean(person.fatherId, 80)) || null,
    motherId: clientToId.get(clean(person.motherId, 80)) || null
  })).filter((person) => person.name);
  return {
    type: ["gotra", "village", "family"].includes(input.type) ? input.type : "family",
    name: clean(input.name, 120), gotra: clean(input.gotra, 120), village: clean(input.village, 120), district: clean(input.district, 120),
    state: clean(input.state, 120), familyBranch: clean(input.familyBranch, 120), notes: clean(input.notes),
    familyDetails, contributorName: clean(input.contributorName, 120), contributorContact: clean(input.contributorContact, 120)
  };
}

app.get("/api/records", async (request, response, next) => {
  try {
    const type = clean(request.query.type, 20); const query = clean(request.query.q, 120);
    if (type === "gotra") {
      const result = await pool.query(`SELECT g.id, 'gotra' AS type, g.name, g.origin_place AS "originPlace", g.origin_period AS "originPeriod", g.founder_name AS "founderName", g.founder_notes AS "founderNotes", g.historical_details AS "historicalDetails", g.source_references AS "sourceReferences", COUNT(m.id)::int AS "memberCount" FROM gotras g LEFT JOIN gotra_members m ON m.gotra_id = g.id WHERE g.status = 'verified' AND ($1 = '' OR g.name ILIKE $2 OR g.origin_place ILIKE $2 OR g.founder_name ILIKE $2) GROUP BY g.id ORDER BY g.name LIMIT 100`, [query, `%${query}%`]);
      return response.json({ records: result.rows });
    }
    const values = []; const conditions = [];
    if (type) { values.push(type); conditions.push(`type = $${values.length}`); }
    if (query) { values.push(`%${query}%`); conditions.push(`(name ILIKE $${values.length} OR village ILIKE $${values.length} OR district ILIKE $${values.length} OR state ILIKE $${values.length})`); }
    const result = await pool.query(`SELECT id, type, name, village, district, state, family_branch AS "familyBranch", notes, family_details AS "familyDetails", verified_at AS "verifiedAt" FROM published_records ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY name LIMIT 100`, values);
    response.json({ records: result.rows });
  } catch (error) { next(error); }
});

app.get("/api/gotras/:id", async (request, response, next) => {
  try {
    const result = await pool.query(`SELECT id, name, origin_place AS "originPlace", origin_period AS "originPeriod", founder_name AS "founderName", founder_notes AS "founderNotes", historical_details AS "historicalDetails", source_references AS "sourceReferences" FROM gotras WHERE id = $1 AND status = 'verified'`, [request.params.id]);
    if (!result.rows[0]) return response.status(404).json({ error: "Verified Gotra not found." });
    const members = await pool.query(`SELECT id, person_name AS "personName", relation_or_role AS "relationOrRole", village, district, state, notes FROM gotra_members WHERE gotra_id = $1 ORDER BY person_name`, [request.params.id]);
    response.json({ gotra: result.rows[0], members: members.rows });
  } catch (error) { next(error); }
});

app.get("/api/records/:id/tree", async (request, response, next) => {
  try {
    const result = await pool.query(`SELECT id, type, name, village, district, state, family_branch AS "familyBranch", family_details AS "familyDetails", verified_at AS "verifiedAt" FROM published_records WHERE id = $1`, [request.params.id]);
    if (!result.rows[0]) return response.status(404).json({ error: "Published family record not found." });
    response.json({ record: result.rows[0] });
  } catch (error) { next(error); }
});

app.post("/api/realtime/published-records", async (request, response, next) => {
  try {
    if (!realtime) return response.status(503).json({ error: "Neon Realtime is not configured." });
    const sealed = await realtime.seal({ query: rawSql(`SELECT id, type, name, village, district, state, family_branch, notes, family_details, verified_at FROM published_records ORDER BY verified_at DESC LIMIT 100`) });
    response.json(sealed);
  } catch (error) { next(error); }
});

app.post("/api/submissions", async (request, response, next) => {
  try {
    const data = validateSubmission(request.body);
    if (!data.name || !data.state || !data.contributorName) return response.status(400).json({ error: msg(request, "नाम, राज्य और योगदानकर्ता का नाम आवश्यक है।", "Name, state, and contributor name are required.") });
    if (data.type === "family" && !data.gotra) return response.status(400).json({ error: msg(request, "परिवार रिकॉर्ड के लिए गोत्र आवश्यक है।", "Gotra is required for a family record.") });
    const result = await pool.query(`INSERT INTO submissions (type, name, village, district, state, family_branch, notes, family_details, contributor_name, contributor_contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [data.type, data.gotra ? `${data.gotra} | ${data.name}` : data.name, data.village, data.district, data.state, data.familyBranch, data.notes, JSON.stringify(data.familyDetails), data.contributorName, data.contributorContact]);
    response.status(201).json({ message: msg(request, "आपका रिकॉर्ड सत्यापन के लिए भेज दिया गया है।", "Your record has been submitted for verification."), id: result.rows[0].id });
  } catch (error) { next(error); }
});

app.post("/api/admin/login", async (request, response, next) => {
  try {
    const email = clean(request.body.email, 200).toLowerCase(); const password = request.body.password;
    const result = await pool.query("SELECT id, email, password_hash, role FROM admins WHERE email = $1", [email]);
    if (!result.rows[0] || !(await bcrypt.compare(password || "", result.rows[0].password_hash))) return response.status(401).json({ error: msg(request, "ईमेल या पासवर्ड गलत है।", "Incorrect email or password.") });
    const admin = result.rows[0]; const token = jwt.sign({ id: admin.id, email: admin.email, role: admin.role }, jwtSecret, { expiresIn: "8h" });
    response.cookie("kulkirti_admin", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 });
    response.json({ admin: { email: admin.email, role: admin.role } });
  } catch (error) { next(error); }
});
app.post("/api/admin/logout", (request, response) => { response.clearCookie("kulkirti_admin"); response.json({ ok: true }); });

app.get("/api/admin/gotras", auth, async (request, response, next) => {
  try {
    const result = await pool.query(`SELECT g.id, g.name, g.origin_place AS "originPlace", g.origin_period AS "originPeriod", g.founder_name AS "founderName", g.founder_notes AS "founderNotes", g.historical_details AS "historicalDetails", g.source_references AS "sourceReferences", g.status, COUNT(m.id)::int AS "memberCount" FROM gotras g LEFT JOIN gotra_members m ON m.gotra_id = g.id GROUP BY g.id ORDER BY g.created_at DESC`);
    response.json({ gotras: result.rows });
  } catch (error) { next(error); }
});

app.post("/api/admin/gotras", auth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    const input = request.body || {};
    const name = clean(input.name, 120);
    const members = Array.isArray(input.members) ? input.members.slice(0, 1000).map((member) => ({
      personName: clean(member.personName, 120), relationOrRole: clean(member.relationOrRole, 120),
      village: clean(member.village, 120), district: clean(member.district, 120), state: clean(member.state, 120), notes: clean(member.notes, 300)
    })).filter((member) => member.personName) : [];
    if (!name) return response.status(400).json({ error: msg(request, "गोत्र नाम आवश्यक है।", "Gotra name is required.") });
    await client.query("BEGIN");
    const gotra = await client.query(`INSERT INTO gotras (name, origin_place, origin_period, founder_name, founder_notes, historical_details, source_references, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [name, clean(input.originPlace, 200), clean(input.originPeriod, 120), clean(input.founderName, 120), clean(input.founderNotes), clean(input.historicalDetails), clean(input.sourceReferences), request.admin.id]);
    for (const member of members) await client.query(`INSERT INTO gotra_members (gotra_id, person_name, relation_or_role, village, district, state, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [gotra.rows[0].id, member.personName, member.relationOrRole, member.village, member.district, member.state, member.notes]);
    await client.query("COMMIT");
    response.status(201).json({ id: gotra.rows[0].id, message: msg(request, "गोत्र और सदस्य प्रकाशित सत्यापन सूची में जोड़ दिए गए हैं।", "Gotra and members have been added to the verified list.") });
  } catch (error) { await client.query("ROLLBACK"); if (error.code === "23505") return response.status(409).json({ error: msg(request, "यह गोत्र पहले से मौजूद है।", "This Gotra already exists.") }); next(error); } finally { client.release(); }
});

app.post("/api/admin/family-records", auth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    const data = validateSubmission({ ...request.body, type: "family", contributorName: request.admin.email });
    if (!data.name || !data.gotra || !data.state || !data.familyDetails.length) {
      return response.status(400).json({ error: msg(request, "गोत्र, राज्य और कम से कम एक परिवार सदस्य आवश्यक है।", "Gotra, state, and at least one family member are required.") });
    }
    await client.query("BEGIN");
    const submission = await client.query(
      `INSERT INTO submissions (type, name, village, district, state, family_branch, notes, family_details, contributor_name, status, reviewed_by, review_notes, reviewed_at)
       VALUES ('family',$1,$2,$3,$4,$5,$6,$7,$8,'approved',$9,'Admin-created verified record',NOW()) RETURNING id`,
      [data.name, data.village, data.district, data.state, data.familyBranch, `${data.gotra}${data.notes ? ` | ${data.notes}` : ""}`, JSON.stringify(data.familyDetails), data.contributorName, request.admin.id]
    );
    const published = await client.query(
      `INSERT INTO published_records (submission_id, type, name, village, district, state, family_branch, notes, family_details, verified_by)
       VALUES ($1,'family',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [submission.rows[0].id, data.name, data.village, data.district, data.state, data.familyBranch, `${data.gotra}${data.notes ? ` | ${data.notes}` : ""}`, JSON.stringify(data.familyDetails), request.admin.id]
    );
    await client.query("COMMIT");
    response.status(201).json({ id: published.rows[0].id, message: msg(request, "परिवार वृक्ष सत्यापित होकर प्रकाशित हो गया है।", "The family tree has been verified and published.") });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.get("/api/admin/submissions", auth, async (request, response, next) => {
  try {
    const result = await pool.query(`SELECT id, type, name, village, district, state, family_branch AS "familyBranch", notes, family_details AS "familyDetails", contributor_name AS "contributorName", contributor_contact AS "contributorContact", status, submitted_at AS "submittedAt", review_notes AS "reviewNotes" FROM submissions ORDER BY submitted_at DESC`);
    response.json({ submissions: result.rows });
  } catch (error) { next(error); }
});

app.patch("/api/admin/submissions/:id", auth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    const status = request.body.status; const reviewNotes = clean(request.body.reviewNotes);
    if (!["approved", "rejected"].includes(status)) return response.status(400).json({ error: "Invalid review status." });
    await client.query("BEGIN");
    const result = await client.query("SELECT * FROM submissions WHERE id = $1 FOR UPDATE", [request.params.id]);
    const submission = result.rows[0]; if (!submission) { await client.query("ROLLBACK"); return response.status(404).json({ error: "Submission not found." }); }
    const familyDetails = typeof submission.family_details === "string" ? JSON.parse(submission.family_details) : submission.family_details;
    await client.query("UPDATE submissions SET status=$1, reviewed_by=$2, review_notes=$3, reviewed_at=NOW() WHERE id=$4", [status, request.admin.id, reviewNotes, submission.id]);
    if (status === "approved") {
      await client.query(`INSERT INTO published_records (submission_id, type, name, village, district, state, family_branch, notes, family_details, verified_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (submission_id) DO UPDATE SET verified_by=EXCLUDED.verified_by, verified_at=NOW()`, [submission.id, submission.type, submission.name, submission.village, submission.district, submission.state, submission.family_branch, submission.notes, JSON.stringify(familyDetails || []), request.admin.id]);
    }
    await client.query("COMMIT"); response.json({ status, id: submission.id });
  } catch (error) { await client.query("ROLLBACK"); next(error); } finally { client.release(); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   GENEALOGY SYSTEM — Public API
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Public: list verified gotras with stats ────────────────────────────────
app.get("/api/genealogy/gotras", async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT g.id, g.name, g.origin_place AS "originPlace", g.origin_period AS "originPeriod",
             g.founder_name AS "founderName", g.historical_details AS "historicalDetails",
             g.source_references AS "sourceReferences",
             (SELECT COUNT(*)::int FROM person_gotra_links l JOIN people p ON p.id = l.person_id
              WHERE l.gotra_id = g.id AND p.status = 'verified' AND p.visibility = 'public') AS "personCount",
             (SELECT COUNT(*)::int FROM family_branches b WHERE b.gotra_id = g.id AND b.status <> 'archived') AS "branchCount"
      FROM gotras g
      WHERE g.status = 'verified'
      ORDER BY g.name
    `);
    response.json({ gotras: result.rows });
  } catch (error) { next(error); }
});

// ── Public: gotra detail with branches and roots ──────────────────────────
app.get("/api/genealogy/gotras/:id", async (request, response, next) => {
  try {
    const gotraResult = await pool.query(
      `SELECT id, name, origin_place AS "originPlace", origin_period AS "originPeriod",
              founder_name AS "founderName", founder_notes AS "founderNotes",
              historical_details AS "historicalDetails", source_references AS "sourceReferences"
       FROM gotras WHERE id = $1 AND status = 'verified'`,
      [request.params.id]
    );
    if (!gotraResult.rows[0]) return response.status(404).json({ error: "Gotra not found." });

    const branches = await pool.query(
      `SELECT id, name, slug, description, parent_branch_id AS "parentBranchId", status
       FROM family_branches WHERE gotra_id = $1 AND status <> 'archived' ORDER BY name`,
      [request.params.id]
    );

    // Root people (earliest documented ancestors)
    const roots = await pool.query(
      `SELECT p.id, p.public_id AS "publicId", p.full_name AS "fullName", p.gender,
              p.birth_year AS "birthYear", p.death_year AS "deathYear", p.is_living AS "isLiving",
              p.village, p.biography
       FROM person_gotra_links l
       JOIN people p ON p.id = l.person_id
       WHERE l.gotra_id = $1 AND l.is_root = TRUE AND p.status = 'verified' AND p.visibility = 'public'
       ORDER BY p.full_name`,
      [request.params.id]
    );

    response.json({ gotra: gotraResult.rows[0], branches: branches.rows, roots: roots.rows });
  } catch (error) { next(error); }
});

// ── Public: person profile by public_id ──────────────────────────────────
app.get("/api/genealogy/people/:publicId", async (request, response, next) => {
  try {
    const personResult = await pool.query(
      `SELECT id, public_id AS "publicId", full_name AS "fullName", alt_names AS "altNames",
              gender, birth_year AS "birthYear", death_year AS "deathYear",
              birthplace, village, district, state, biography, is_living AS "isLiving",
              status, visibility
       FROM people
       WHERE public_id = $1 AND status = 'verified'`,
      [request.params.publicId]
    );
    if (!personResult.rows[0]) return response.status(404).json({ error: "Person not found." });

    const person = personResult.rows[0];

    // Privacy: if visibility is private, only show name + public_id
    if (person.visibility === "private") {
      return response.json({
        person: { publicId: person.publicId, fullName: person.fullName, isLiving: person.isLiving },
        parents: [], children: [], siblings: [], ancestors: [], descendants: [], gotras: [],
        restricted: true,
      });
    }

    // Field-level privacy for living people
    const isPublic = person.visibility === "public";
    const safePerson = {
      ...person,
      birthYear: isPublic || !person.isLiving ? person.birthYear : null,
      birthplace: isPublic || !person.isLiving ? person.birthplace : null,
      biography: isPublic || !person.isLiving ? person.biography : null,
    };

    // Parents
    const parents = await genealogy.findParents(pool, person.id);
    // Children
    const children = await genealogy.findChildren(pool, person.id);
    // Siblings
    const siblings = await genealogy.findSiblings(pool, person.id);
    // Ancestors (limited depth)
    const ancestors = await genealogy.findAncestors(pool, person.id, 10);
    // Descendants (limited depth)
    const descendants = await genealogy.findDescendants(pool, person.id, 5);
    // Gotra memberships
    const gotras = await pool.query(
      `SELECT g.id, g.name, l.is_root AS "isRoot", l.branch_id AS "branchId"
       FROM person_gotra_links l JOIN gotras g ON g.id = l.gotra_id
       WHERE l.person_id = $1`, [person.id]
    );
    // Generation
    const generation = await genealogy.calculateGeneration(pool, person.id);

    // Remove internal IDs from public response
    const stripId = (arr) => arr.map(r => {
      const { id, ...rest } = r; return rest;
    });

    response.json({
      person: { ...safePerson, generation },
      parents: stripId(parents),
      children: stripId(children),
      siblings: stripId(siblings),
      ancestors: stripId(ancestors),
      descendants: stripId(descendants),
      gotras: gotras.rows.map(g => ({ id: g.id, name: g.name, isRoot: g.isRoot })),
      restricted: false,
    });
  } catch (error) { next(error); }
});

// ── Public: person tree (limited depth for rendering) ────────────────────
app.get("/api/genealogy/people/:publicId/tree", async (request, response, next) => {
  try {
    const personResult = await pool.query(
      `SELECT id FROM people WHERE public_id = $1 AND status = 'verified'`,
      [request.params.publicId]
    );
    if (!personResult.rows[0]) return response.status(404).json({ error: "Person not found." });
    const tree = await genealogy.getFamilyTree(pool, personResult.rows[0].id, 5);
    response.json({ tree });
  } catch (error) { next(error); }
});

// ── Public: search people ─────────────────────────────────────────────────
app.get("/api/genealogy/search", async (request, response, next) => {
  try {
    const query = clean(request.query.q, 120);
    if (!query) return response.json({ people: [] });
    const result = await pool.query(
      `SELECT id, public_id AS "publicId", full_name AS "fullName", gender,
              birth_year AS "birthYear", death_year AS "deathYear",
              is_living AS "isLiving", village
       FROM people
       WHERE status = 'verified' AND visibility = 'public'
         AND full_name ILIKE $1
       ORDER BY full_name LIMIT 50`,
      [`%${query}%`]
    );
    response.json({ people: result.rows.map(r => { const { id, ...rest } = r; return rest; }) });
  } catch (error) { next(error); }
});

// ── Public: submit a genealogy contribution ───────────────────────────────
app.post("/api/genealogy/contributions", async (request, response, next) => {
  try {
    const input = request.body || {};
    const type = ["new_person", "new_relationship", "correction", "branch_addition", "gotra_info", "dispute"]
      .includes(input.contributionType) ? input.contributionType : "new_person";

    const contributorName = clean(input.contributorName, 120);
    if (!contributorName) return response.status(400).json({
      error: msg(request, "योगदानकर्ता का नाम आवश्यक है।", "Contributor name is required.")
    });

    const result = await pool.query(
      `INSERT INTO genealogy_contributions
        (contribution_type, proposed_name, proposed_gender, proposed_birth_year,
         proposed_death_year, proposed_village, proposed_gotra_id, proposed_branch_id,
         proposed_father_id, proposed_mother_id, existing_person_id, existing_rel_id,
         description, evidence, contributor_name, contributor_contact)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [type, clean(input.proposedName, 120), clean(input.proposedGender, 30),
       clean(input.proposedBirthYear, 20), clean(input.proposedDeathYear, 20),
       clean(input.proposedVillage, 120),
       input.proposedGotraId || null, input.proposedBranchId || null,
       input.proposedFatherId || null, input.proposedMotherId || null,
       input.existingPersonId || null, input.existingRelId || null,
       clean(input.description, 2000), clean(input.evidence, 2000),
       contributorName, clean(input.contributorContact, 120)]
    );
    response.status(201).json({
      message: msg(request,
        "आपका योगदान समीक्षा के लिए भेज दिया गया है।",
        "Your contribution has been submitted for review."),
      id: result.rows[0].id
    });
  } catch (error) { next(error); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   GENEALOGY SYSTEM — Admin API (auth required)
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Admin: list people with search and pagination ────────────────────────
app.get("/api/admin/people", auth, async (request, response, next) => {
  try {
    const query = clean(request.query.q, 120);
    const page = Math.max(1, parseInt(request.query.page) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(request.query.limit) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    const values = [];
    if (query) {
      values.push(`%${query}%`);
      conditions.push(`full_name ILIKE $${values.length}`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int FROM people ${whereClause}`, values
    );
    const total = countResult.rows[0].count;

    values.push(limit, offset);
    const result = await pool.query(
      `SELECT id, public_id AS "publicId", full_name AS "fullName", alt_names AS "altNames",
              gender, birth_year AS "birthYear", death_year AS "deathYear",
              birthplace, village, district, state, biography,
              is_living AS "isLiving", status, visibility,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM people ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    response.json({ people: result.rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) { next(error); }
});

// ── Admin: search people for parent autocomplete ─────────────────────────
app.get("/api/admin/people/search", auth, async (request, response, next) => {
  try {
    const query = clean(request.query.q, 120);
    if (!query || query.length < 2) return response.json({ people: [] });
    const result = await pool.query(
      `SELECT id, public_id AS "publicId", full_name AS "fullName", gender,
              birth_year AS "birthYear", death_year AS "deathYear", village
       FROM people
       WHERE status <> 'archived' AND full_name ILIKE $1
       ORDER BY full_name LIMIT 20`,
      [`%${query}%`]
    );
    response.json({ people: result.rows });
  } catch (error) { next(error); }
});

// ── Admin: create person ──────────────────────────────────────────────────
app.post("/api/admin/people", auth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    const input = request.body || {};
    const fullName = clean(input.fullName, 120);
    if (!fullName) return response.status(400).json({
      error: msg(request, "नाम आवश्यक है।", "Name is required.")
    });

    await client.query("BEGIN");
    const person = await client.query(
      `INSERT INTO people
        (full_name, alt_names, gender, birth_year, death_year, birthplace,
         village, district, state, biography, is_living, status, visibility, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
       RETURNING id, public_id`,
      [fullName, clean(input.altNames, 500), clean(input.gender, 30),
       clean(input.birthYear, 20), clean(input.deathYear, 20), clean(input.birthplace, 200),
       clean(input.village, 120), clean(input.district, 120), clean(input.state, 120),
       clean(input.biography, 5000),
       input.isLiving !== undefined ? input.isLiving : (input.deathYear ? false : true),
       clean(input.status, 20) || "verified", clean(input.visibility, 20) || "public",
       request.admin.id]
    );

    // Link to gotra if provided
    if (input.gotraId) {
      await client.query(
        `INSERT INTO person_gotra_links (person_id, gotra_id, branch_id, is_root)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (person_id, gotra_id) DO NOTHING`,
        [person.rows[0].id, input.gotraId, input.branchId || null, input.isRoot || false]
      );
    }

    // Create relationships if father/mother provided
    if (input.fatherId) {
      const validation = await genealogy.validateRelationship(client._pool || pool, input.fatherId, person.rows[0].id, "biological");
      if (validation.valid) {
        await client.query(
          `INSERT INTO person_relationships (parent_id, child_id, relation_type, status, evidence_source, created_by, approved_by)
           VALUES ($1, $2, 'biological', 'verified', $3, $4, $4)`,
          [input.fatherId, person.rows[0].id, clean(input.evidence, 500), request.admin.id]
        );
      }
    }
    if (input.motherId) {
      const validation = await genealogy.validateRelationship(pool, input.motherId, person.rows[0].id, "biological");
      if (validation.valid) {
        await client.query(
          `INSERT INTO person_relationships (parent_id, child_id, relation_type, status, evidence_source, created_by, approved_by)
           VALUES ($1, $2, 'biological', 'verified', $3, $4, $4)`,
          [input.motherId, person.rows[0].id, clean(input.evidence, 500), request.admin.id]
        );
      }
    }

    await genealogy.logAudit(client._pool || pool, request.admin.id, "create_person", "person", person.rows[0].id,
      { fullName, gender: input.gender || null });
    await client.query("COMMIT");

    response.status(201).json({
      id: person.rows[0].id,
      publicId: person.rows[0].public_id,
      message: msg(request, "व्यक्ति सफलतापूर्वक जोड़ा गया।", "Person added successfully.")
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

// ── Admin: update person ─────────────────────────────────────────────────
app.patch("/api/admin/people/:id", auth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    const input = request.body || {};
    const personId = request.params.id;

    await client.query("BEGIN");

    // Fetch current values for audit
    const current = await client.query(
      `SELECT full_name, gender, birth_year, death_year, village, biography, is_living, status, visibility
       FROM people WHERE id = $1`, [personId]
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Person not found." });
    }

    const updates = [];
    const values = [];
    const fields = ["full_name", "alt_names", "gender", "birth_year", "death_year", "birthplace",
                    "village", "district", "state", "biography", "is_living", "status", "visibility"];
    const inputMap = {
      full_name: "fullName", alt_names: "altNames", birth_year: "birthYear", death_year: "deathYear",
      is_living: "isLiving",
    };

    fields.forEach(field => {
      const inputKey = inputMap[field] || field;
      if (input[inputKey] !== undefined) {
        values.push(input[inputKey]);
        updates.push(`${field} = $${values.length}`);
      }
    });

    if (updates.length) {
      values.push(request.admin.id);
      updates.push(`updated_by = $${values.length}`);
      values.push(personId);
      await client.query(
        `UPDATE people SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${values.length}`,
        values
      );
      await genealogy.logAudit(pool, request.admin.id, "update_person", "person", personId,
        { before: current.rows[0], after: input });
    }

    await client.query("COMMIT");
    response.json({ id: personId, message: msg(request, "व्यक्ति अद्यतन किया गया।", "Person updated.") });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

// ── Admin: create relationship (with cycle detection) ────────────────────
app.post("/api/admin/relationships", auth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    const input = request.body || {};
    const parentId = clean(input.parentId, 80);
    const childId = clean(input.childId, 80);
    const relationType = ["biological", "adoptive", "step", "guardian", "other"]
      .includes(input.relationType) ? input.relationType : "biological";

    if (!parentId || !childId) return response.status(400).json({
      error: msg(request, "अभिभावक और संतान आवश्यक हैं।", "Parent and child are required.")
    });

    // Full validation pipeline
    const validation = await genealogy.validateRelationship(pool, parentId, childId, relationType);
    if (!validation.valid) {
      const errorMessages = {
        self_parenting: msg(request, "स्व-अभिभावक संबंध नहीं हो सकता।", "Self-parenting is not allowed."),
        person_not_found: msg(request, "व्यक्ति नहीं मिला।", "Person not found."),
        duplicate_relationship: msg(request, "यह संबंध पहले से मौजूद है।", "This relationship already exists."),
        circular_genealogy: msg(request, "यह संबंध चक्रीय वंशावली बनाएगा।", "This relationship would create a circular genealogy."),
        max_biological_parents: msg(request, "अधिकतम दो जैविक अभिभावक हो सकते हैं।", "A person can have at most two biological parents."),
      };
      return response.status(400).json({ error: errorMessages[validation.error] || validation.error });
    }

    await client.query("BEGIN");
    const rel = await client.query(
      `INSERT INTO person_relationships (parent_id, child_id, relation_type, status, evidence_source, created_by, approved_by)
       VALUES ($1, $2, $3, 'verified', $4, $5, $5) RETURNING id`,
      [parentId, childId, relationType, clean(input.evidence, 500), request.admin.id]
    );
    await genealogy.logAudit(pool, request.admin.id, "add_relationship", "relationship", rel.rows[0].id,
      { parentId, childId, relationType });
    await client.query("COMMIT");

    response.status(201).json({
      id: rel.rows[0].id,
      message: msg(request, "संबंध सफलतापूर्वक जोड़ा गया।", "Relationship added successfully.")
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return response.status(409).json({
      error: msg(request, "यह संबंध पहले से मौजूद है।", "This relationship already exists.")
    });
    next(error);
  } finally {
    client.release();
  }
});

// ── Admin: remove relationship ────────────────────────────────────────────
app.delete("/api/admin/relationships/:id", auth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "DELETE FROM person_relationships WHERE id = $1 RETURNING parent_id, child_id",
      [request.params.id]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Relationship not found." });
    }
    await genealogy.logAudit(pool, request.admin.id, "remove_relationship", "relationship", request.params.id,
      result.rows[0]);
    await client.query("COMMIT");
    response.json({ id: request.params.id, message: msg(request, "संबंध हटा दिया गया।", "Relationship removed.") });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

// ── Admin: create family branch ────────────────────────────────────────────
app.post("/api/admin/branches", auth, async (request, response, next) => {
  try {
    const input = request.body || {};
    const name = clean(input.name, 120);
    const gotraId = clean(input.gotraId, 80);
    if (!name || !gotraId) return response.status(400).json({
      error: msg(request, "शाखा नाम और गोत्र आवश्यक हैं।", "Branch name and Gotra are required.")
    });

    const result = await pool.query(
      `INSERT INTO family_branches (gotra_id, parent_branch_id, name, slug, description, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'verified', $6) RETURNING id`,
      [gotraId, input.parentBranchId || null, name,
       clean(input.slug, 120) || name.toLowerCase().replace(/\s+/g, "-"),
       clean(input.description, 500), request.admin.id]
    );
    await genealogy.logAudit(pool, request.admin.id, "create_branch", "branch", result.rows[0].id, { name, gotraId });
    response.status(201).json({
      id: result.rows[0].id,
      message: msg(request, "शाखा सफलतापूर्वक बनाई गई।", "Branch created successfully.")
    });
  } catch (error) {
    if (error.code === "23505") return response.status(409).json({
      error: msg(request, "यह शाखा पहले से मौजूद है।", "This branch already exists.")
    });
    next(error);
  }
});

// ── Admin: list branches ─────────────────────────────────────────────────
app.get("/api/admin/branches", auth, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.name, b.slug, b.description, b.status,
              b.parent_branch_id AS "parentBranchId",
              g.name AS "gotraName", g.id AS "gotraId"
       FROM family_branches b
       JOIN gotras g ON g.id = b.gotra_id
       WHERE b.status <> 'archived'
       ORDER BY g.name, b.name`
    );
    response.json({ branches: result.rows });
  } catch (error) { next(error); }
});

// ── Admin: list genealogy contributions ──────────────────────────────────
app.get("/api/admin/contributions", auth, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id, contribution_type AS "contributionType",
              proposed_name AS "proposedName", proposed_gender AS "proposedGender",
              proposed_birth_year AS "proposedBirthYear", proposed_death_year AS "proposedDeathYear",
              proposed_village AS "proposedVillage", proposed_gotra_id AS "proposedGotraId",
              proposed_father_id AS "proposedFatherId", proposed_mother_id AS "proposedMotherId",
              existing_person_id AS "existingPersonId", existing_rel_id AS "existingRelId",
              description, evidence, contributor_name AS "contributorName",
              contributor_contact AS "contributorContact", status,
              submitted_at AS "submittedAt", review_notes AS "reviewNotes"
       FROM genealogy_contributions
       ORDER BY submitted_at DESC`
    );
    response.json({ contributions: result.rows });
  } catch (error) { next(error); }
});

// ── Admin: approve/reject contribution ────────────────────────────────────
app.patch("/api/admin/contributions/:id", auth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    const status = request.body.status;
    const reviewNotes = clean(request.body.reviewNotes);
    if (!["approved", "rejected", "under_review", "needs_info", "disputed"].includes(status))
      return response.status(400).json({ error: "Invalid status." });

    await client.query("BEGIN");
    const result = await client.query(
      "SELECT * FROM genealogy_contributions WHERE id = $1 FOR UPDATE", [request.params.id]
    );
    const contribution = result.rows[0];
    if (!contribution) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "Contribution not found." });
    }

    await client.query(
      "UPDATE genealogy_contributions SET status = $1, reviewed_by = $2, review_notes = $3, reviewed_at = NOW() WHERE id = $4",
      [status, request.admin.id, reviewNotes, contribution.id]
    );

    // If approved and it's a new_person contribution, create the person
    if (status === "approved" && contribution.contribution_type === "new_person" && contribution.proposed_name) {
      const personResult = await client.query(
        `INSERT INTO people
          (full_name, gender, birth_year, death_year, village, status, visibility, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, 'verified', 'public', $6, $6)
         RETURNING id, public_id`,
        [contribution.proposed_name, contribution.proposed_gender,
         contribution.proposed_birth_year, contribution.proposed_death_year,
         contribution.proposed_village, request.admin.id]
      );
      const newPersonId = personResult.rows[0].id;

      // Link to gotra if provided
      if (contribution.proposed_gotra_id) {
        await client.query(
          `INSERT INTO person_gotra_links (person_id, gotra_id, branch_id, is_root)
           VALUES ($1, $2, $3, false)
           ON CONFLICT (person_id, gotra_id) DO NOTHING`,
          [newPersonId, contribution.proposed_gotra_id, contribution.proposed_branch_id]
        );
      }

      // Create parent relationships if provided
      if (contribution.proposed_father_id) {
        const v = await genealogy.validateRelationship(pool, contribution.proposed_father_id, newPersonId, "biological");
        if (v.valid) {
          await client.query(
            `INSERT INTO person_relationships (parent_id, child_id, relation_type, status, evidence_source, created_by, approved_by)
             VALUES ($1, $2, 'biological', 'verified', $3, $4, $4)`,
            [contribution.proposed_father_id, newPersonId, contribution.evidence, request.admin.id]
          );
        }
      }
      if (contribution.proposed_mother_id) {
        const v = await genealogy.validateRelationship(pool, contribution.proposed_mother_id, newPersonId, "biological");
        if (v.valid) {
          await client.query(
            `INSERT INTO person_relationships (parent_id, child_id, relation_type, status, evidence_source, created_by, approved_by)
             VALUES ($1, $2, 'biological', 'verified', $3, $4, $4)`,
            [contribution.proposed_mother_id, newPersonId, contribution.evidence, request.admin.id]
          );
        }
      }

      await genealogy.logAudit(pool, request.admin.id, "approve_contribution", "contribution", contribution.id,
        { personCreated: newPersonId });
    }

    await client.query("COMMIT");
    response.json({ status, id: contribution.id });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

// ── Admin: get person detail (admin view, includes internal data) ────────
app.get("/api/admin/people/:id", auth, async (request, response, next) => {
  try {
    const personResult = await pool.query(
      `SELECT id, public_id AS "publicId", full_name AS "fullName", alt_names AS "altNames",
              gender, birth_year AS "birthYear", death_year AS "deathYear",
              birthplace, village, district, state, biography,
              is_living AS "isLiving", status, visibility,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM people WHERE id = $1`, [request.params.id]
    );
    if (!personResult.rows[0]) return response.status(404).json({ error: "Person not found." });

    const person = personResult.rows[0];
    const parents = await genealogy.findParents(pool, person.id);
    const children = await genealogy.findChildren(pool, person.id);
    const gotras = await pool.query(
      `SELECT g.id, g.name, l.is_root AS "isRoot", l.branch_id AS "branchId"
       FROM person_gotra_links l JOIN gotras g ON g.id = l.gotra_id
       WHERE l.person_id = $1`, [person.id]
    );
    const generation = await genealogy.calculateGeneration(pool, person.id);

    response.json({ person: { ...person, generation }, parents, children, gotras: gotras.rows });
  } catch (error) { next(error); }
});

/* ═══════════════════════════════════════════════════════════════════════════
   VANSHAWALI ENHANCEMENT — STATS, VILLAGES, IMPORT, BRANCH UPDATES, PERSON DELETE
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Public: dashboard stats ────────────────────────────────────────────────
app.get("/api/vanshawali/stats", async (request, response, next) => {
  try {
    const [peopleCount, villageCount, branchCount, relCount, pendingCount, recentPeople] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int FROM people WHERE status <> 'archived'`),
      pool.query(`SELECT COUNT(DISTINCT village)::int FROM people WHERE village IS NOT NULL AND village <> '' AND status <> 'archived'`),
      pool.query(`SELECT COUNT(*)::int FROM family_branches WHERE status <> 'archived'`),
      pool.query(`SELECT COUNT(*)::int FROM person_relationships WHERE status = 'verified'`),
      pool.query(`SELECT COUNT(*)::int FROM genealogy_contributions WHERE status = 'pending'`),
      pool.query(`SELECT id, public_id AS "publicId", full_name AS "fullName", village, created_at AS "createdAt"
                  FROM people WHERE status <> 'archived' ORDER BY created_at DESC LIMIT 10`),
    ]);
    response.json({
      totalPeople: peopleCount.rows[0].count,
      totalVillages: villageCount.rows[0].count,
      totalBranches: branchCount.rows[0].count,
      totalRelationships: relCount.rows[0].count,
      pendingSubmissions: pendingCount.rows[0].count,
      recentPeople: recentPeople.rows,
    });
  } catch (error) { next(error); }
});

// ── Public: list villages with people counts ─────────────────────────────
app.get("/api/vanshawali/villages", async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT village, COUNT(*)::int AS "personCount",
              MAX(district) AS district, MAX(state) AS state
       FROM people
       WHERE village IS NOT NULL AND village <> '' AND status <> 'archived' AND visibility = 'public'
       GROUP BY village ORDER BY "personCount" DESC LIMIT 200`
    );
    response.json({ villages: result.rows });
  } catch (error) { next(error); }
});

// ── Public: list all branches ──────────────────────────────────────────────
app.get("/api/vanshawali/branches", async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.name, b.slug, b.description, b.status,
              b.parent_branch_id AS "parentBranchId",
              g.name AS "gotraName",
              (SELECT COUNT(*)::int FROM person_gotra_links l
               JOIN people p ON p.id = l.person_id
               WHERE l.branch_id = b.id AND p.status <> 'archived') AS "personCount"
       FROM family_branches b
       LEFT JOIN gotras g ON g.id = b.gotra_id
       WHERE b.status <> 'archived'
       ORDER BY g.name, b.name`
    );
    response.json({ branches: result.rows });
  } catch (error) { next(error); }
});

// ── Admin: download CSV template ──────────────────────────────────────────
app.get("/api/admin/vanshawali/import/template", auth, (request, response) => {
  const template = csvParser.generateTemplate();
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", 'attachment; filename="vanshawali-template.csv"');
  response.send(template);
});

// ── Admin: import preview (parse + validate, store in staging) ────────────
app.post("/api/admin/vanshawali/import/preview", auth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    const csvText = request.body.csv || "";
    if (!csvText.trim()) return response.status(400).json({
      error: msg(request, "CSV डेटा खाली है।", "CSV data is empty.")
    });

    // Parse CSV
    const parsed = csvParser.parseCSV(csvText);
    if (parsed.rows.length === 0) return response.status(400).json({
      error: msg(request, "CSV में कोई डेटा पंक्ति नहीं है।", "CSV contains no data rows.")
    });

    // Validate
    const validated = csvParser.validateImport(parsed);
    if (!validated.valid) return response.status(400).json({ error: validated.error });

    // Create import job
    await client.query("BEGIN");
    const job = await client.query(
      `INSERT INTO import_jobs (admin_id, filename, total_rows, valid_rows, invalid_rows, status, summary)
       VALUES ($1, $2, $3, $4, $5, 'previewing', $6) RETURNING id`,
      [request.admin.id, clean(request.body.filename, 200) || "upload.csv",
       validated.summary.total, validated.summary.valid, validated.summary.invalid,
       JSON.stringify(validated.summary)]
    );
    const jobId = job.rows[0].id;

    // Store all rows (valid + invalid) in staging
    const allRows = [...validated.validRows, ...validated.invalidRows];
    for (const row of allRows) {
      await client.query(
        `INSERT INTO import_rows (job_id, row_number, external_id, full_name,
          father_external_id, mother_external_id, village, city, district, state,
          branch_name, living_status, is_valid, errors, warnings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [jobId, row._rowNumber, clean(row.external_id, 80), clean(row.full_name, 120),
         clean(row.father_external_id, 80), clean(row.mother_external_id, 80),
         clean(row.village, 120), clean(row.city, 120), clean(row.district, 120),
         clean(row.state, 120), clean(row.branch_name, 120), clean(row.living_status, 20),
         row.is_valid,
         JSON.stringify(row.errors || []), JSON.stringify(row.warnings || [])]
      );
    }

    await client.query("UPDATE import_jobs SET status = 'validated' WHERE id = $1", [jobId]);
    await client.query("COMMIT");

    response.json({
      jobId,
      summary: validated.summary,
      validRows: validated.validRows.map(r => ({
        row: r._rowNumber, external_id: r.external_id, full_name: r.full_name,
        village: r.village, living_status: r.living_status,
      })),
      invalidRows: validated.invalidRows.map(r => ({
        row: r._rowNumber, external_id: r.external_id, full_name: r.full_name,
        errors: r.errors,
      })),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

// ── Admin: commit import (transactional batch insert) ─────────────────────
app.post("/api/admin/vanshawali/import/commit", auth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    const jobId = clean(request.body.jobId, 80);
    if (!jobId) return response.status(400).json({
      error: msg(request, "import job ID आवश्यक है।", "Import job ID is required.")
    });

    // Fetch job
    const jobResult = await client.query(
      "SELECT * FROM import_jobs WHERE id = $1 AND status = 'validated'",
      [jobId]
    );
    if (!jobResult.rows[0]) return response.status(404).json({
      error: msg(request, "Import job नहीं मिला या पहले से committed है।", "Import job not found or already committed.")
    });

    // Fetch valid rows
    const rowsResult = await client.query(
      "SELECT * FROM import_rows WHERE job_id = $1 AND is_valid = TRUE ORDER BY row_number",
      [jobId]
    );
    const rows = rowsResult.rows;

    if (!rows.length) return response.status(400).json({
      error: msg(request, "कोई valid rows नहीं हैं।", "No valid rows to import.")
    });

    await client.query("BEGIN");

    // Map: external_id → people.id (for parent resolution)
    const idMap = new Map();
    let importedCount = 0;

    // First pass: create all people (resolve locations + branches)
    for (const row of rows) {
      // Resolve or create location
      let locationId = null;
      if (row.village) {
        const locResult = await client.query(
          `INSERT INTO locations (village_name, city, district, state)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (village_name, district, state) DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [row.village, row.city || null, row.district || null, row.state || null]
        );
        locationId = locResult.rows[0].id;
      }

      // Resolve branch
      let branchId = null;
      if (row.branch_name) {
        const branchResult = await client.query(
          `SELECT id FROM family_branches WHERE name = $1 LIMIT 1`,
          [row.branch_name]
        );
        branchId = branchResult.rows[0]?.id || null;
      }

      // Create person
      const isLiving = row.living_status === "deceased" ? false : true;
      const personResult = await client.query(
        `INSERT INTO people (full_name, village, city, district, state, is_living, status, visibility, location_id, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'verified', 'public', $7, $8, $8)
         RETURNING id, public_id`,
        [row.full_name, row.village || null, row.city || null, row.district || null,
         row.state || null, isLiving, locationId, request.admin.id]
      );
      const personId = personResult.rows[0].id;
      idMap.set(row.external_id, personId);
      importedCount++;

      // Link to branch if found
      if (branchId) {
        // Find gotra for this branch
        const gotraResult = await client.query(
          `SELECT gotra_id FROM family_branches WHERE id = $1`, [branchId]
        );
        if (gotraResult.rows[0]?.gotra_id) {
          await client.query(
            `INSERT INTO person_gotra_links (person_id, gotra_id, branch_id, is_root)
             VALUES ($1, $2, $3, false)
             ON CONFLICT (person_id, gotra_id) DO NOTHING`,
            [personId, gotraResult.rows[0].gotra_id, branchId]
          );
        }
      }

      // Mark row as resolved
      await client.query(
        "UPDATE import_rows SET resolved_person_id = $1 WHERE id = $2",
        [personId, row.id]
      );
    }

    // Second pass: create parent-child relationships
    for (const row of rows) {
      const childId = idMap.get(row.external_id);
      if (!childId) continue;

      if (row.father_external_id && idMap.has(row.father_external_id)) {
        const fatherId = idMap.get(row.father_external_id);
        const validation = await genealogy.validateRelationship(client._pool || pool, fatherId, childId, "biological");
        if (validation.valid) {
          await client.query(
            `INSERT INTO person_relationships (parent_id, child_id, relation_type, status, created_by, approved_by)
             VALUES ($1, $2, 'biological', 'verified', $3, $3)
             ON CONFLICT DO NOTHING`,
            [fatherId, childId, request.admin.id]
          );
        }
      }

      if (row.mother_external_id && idMap.has(row.mother_external_id)) {
        const motherId = idMap.get(row.mother_external_id);
        const validation = await genealogy.validateRelationship(pool, motherId, childId, "biological");
        if (validation.valid) {
          await client.query(
            `INSERT INTO person_relationships (parent_id, child_id, relation_type, status, created_by, approved_by)
             VALUES ($1, $2, 'biological', 'verified', $3, $3)
             ON CONFLICT DO NOTHING`,
            [motherId, childId, request.admin.id]
          );
        }
      }
    }

    // Update job status
    await client.query(
      "UPDATE import_jobs SET status = 'committed', imported_rows = $1, committed_at = NOW() WHERE id = $2",
      [importedCount, jobId]
    );

    await genealogy.logAudit(pool, request.admin.id, "import_commit", "import_job", jobId,
      { imported: importedCount, total: rows.length });
    await client.query("COMMIT");

    response.json({
      jobId,
      imported: importedCount,
      message: msg(request,
        `${importedCount} व्यक्ति सफलतापूर्वक import हो गए।`,
        `${importedCount} people imported successfully.`)
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

// ── Admin: delete/archive person ──────────────────────────────────────────
app.delete("/api/admin/people/:id", auth, async (request, response, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check if person has relationships — if so, archive instead of delete
    const relCount = await client.query(
      "SELECT COUNT(*)::int FROM person_relationships WHERE parent_id = $1 OR child_id = $1",
      [request.params.id]
    );
    if (relCount.rows[0].count > 0) {
      // Archive: set status to 'archived' (preserves data)
      await client.query(
        "UPDATE people SET status = 'archived', updated_at = NOW(), updated_by = $2 WHERE id = $1",
        [request.params.id, request.admin.id]
      );
      await genealogy.logAudit(pool, request.admin.id, "archive_person", "person", request.params.id, null);
      await client.query("COMMIT");
      response.json({
        id: request.params.id,
        archived: true,
        message: msg(request,
          "व्यक्ति को archived कर दिया गया (संबंधों के कारण)।",
          "Person archived (has existing relationships).")
      });
    } else {
      // Safe to delete — no relationships
      await client.query("DELETE FROM people WHERE id = $1", [request.params.id]);
      await genealogy.logAudit(pool, request.admin.id, "delete_person", "person", request.params.id, null);
      await client.query("COMMIT");
      response.json({
        id: request.params.id,
        deleted: true,
        message: msg(request, "व्यक्ति हटा दिया गया।", "Person deleted.")
      });
    }
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

// ── Admin: update branch ──────────────────────────────────────────────────
app.put("/api/admin/branches/:id", auth, async (request, response, next) => {
  try {
    const input = request.body || {};
    const updates = [];
    const values = [];
    if (input.name) { values.push(clean(input.name, 120)); updates.push(`name = $${values.length}`); }
    if (input.description !== undefined) { values.push(clean(input.description, 500)); updates.push(`description = $${values.length}`); }
    if (input.status) { values.push(clean(input.status, 20)); updates.push(`status = $${values.length}`); }
    if (input.parentBranchId !== undefined) { values.push(input.parentBranchId || null); updates.push(`parent_branch_id = $${values.length}`); }
    if (input.slug) { values.push(clean(input.slug, 120)); updates.push(`slug = $${values.length}`); }

    if (!updates.length) return response.status(400).json({ error: "No updates provided." });
    values.push(request.params.id);
    await pool.query(
      `UPDATE family_branches SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${values.length}`,
      values
    );
    await genealogy.logAudit(pool, request.admin.id, "update_branch", "branch", request.params.id, input);
    response.json({ id: request.params.id, message: msg(request, "शाखा अद्यतन की गई।", "Branch updated.") });
  } catch (error) { next(error); }
});

// ── Admin: assign person to branch ────────────────────────────────────────
app.post("/api/admin/vanshawali/assign-branch", auth, async (request, response, next) => {
  try {
    const input = request.body || {};
    const personId = clean(input.personId, 80);
    const branchId = clean(input.branchId, 80);
    if (!personId || !branchId) return response.status(400).json({
      error: msg(request, "व्यक्ति और शाखा आवश्यक हैं।", "Person and branch are required.")
    });

    // Get gotra_id from branch
    const branchResult = await pool.query(
      "SELECT gotra_id FROM family_branches WHERE id = $1", [branchId]
    );
    if (!branchResult.rows[0]) return response.status(404).json({ error: "Branch not found." });
    const gotraId = branchResult.rows[0].gotra_id;

    await pool.query(
      `INSERT INTO person_gotra_links (person_id, gotra_id, branch_id, is_root)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (person_id, gotra_id) DO UPDATE SET branch_id = EXCLUDED.branch_id`,
      [personId, gotraId, branchId]
    );
    await genealogy.logAudit(pool, request.admin.id, "assign_branch", "person", personId, { branchId });
    response.json({ message: msg(request, "व्यक्ति को शाखा में जोड़ा गया।", "Person assigned to branch.") });
  } catch (error) { next(error); }
});

app.use(express.static(root));
/* Custom 404 — served for any URL that doesn't match a static file or API route */
app.use((request, response) => {
  response.status(404).sendFile(path.join(root, "404.html"));
});
app.use((error, request, response, next) => { console.error(error); response.status(500).json({ error: "Server error." }); });
initializeDatabase()
  .then(() => app.listen(port, "0.0.0.0", () => console.log(`Kul-Kirti running on port ${port}`)))
  .catch((error) => {
    console.error("Startup initialization failed:", error.message);
    process.exit(1);
  });
