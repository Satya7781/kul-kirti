require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const crypto = require("crypto");
const { createRealtime, rawSql } = require("@neon/realtime/server");

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

function clean(value, max = 500) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
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
    if (!data.name || !data.state || !data.contributorName) return response.status(400).json({ error: "नाम, राज्य और योगदानकर्ता का नाम आवश्यक है।" });
    if (data.type === "family" && !data.gotra) return response.status(400).json({ error: "परिवार रिकॉर्ड के लिए गोत्र आवश्यक है।" });
    const result = await pool.query(`INSERT INTO submissions (type, name, village, district, state, family_branch, notes, family_details, contributor_name, contributor_contact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [data.type, data.gotra ? `${data.gotra} | ${data.name}` : data.name, data.village, data.district, data.state, data.familyBranch, data.notes, JSON.stringify(data.familyDetails), data.contributorName, data.contributorContact]);
    response.status(201).json({ message: "आपका रिकॉर्ड सत्यापन के लिए भेज दिया गया है।", id: result.rows[0].id });
  } catch (error) { next(error); }
});

app.post("/api/admin/login", async (request, response, next) => {
  try {
    const email = clean(request.body.email, 200).toLowerCase(); const password = request.body.password;
    const result = await pool.query("SELECT id, email, password_hash, role FROM admins WHERE email = $1", [email]);
    if (!result.rows[0] || !(await bcrypt.compare(password || "", result.rows[0].password_hash))) return response.status(401).json({ error: "ईमेल या पासवर्ड गलत है।" });
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
    if (!name) return response.status(400).json({ error: "गोत्र नाम आवश्यक है।" });
    await client.query("BEGIN");
    const gotra = await client.query(`INSERT INTO gotras (name, origin_place, origin_period, founder_name, founder_notes, historical_details, source_references, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [name, clean(input.originPlace, 200), clean(input.originPeriod, 120), clean(input.founderName, 120), clean(input.founderNotes), clean(input.historicalDetails), clean(input.sourceReferences), request.admin.id]);
    for (const member of members) await client.query(`INSERT INTO gotra_members (gotra_id, person_name, relation_or_role, village, district, state, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [gotra.rows[0].id, member.personName, member.relationOrRole, member.village, member.district, member.state, member.notes]);
    await client.query("COMMIT");
    response.status(201).json({ id: gotra.rows[0].id, message: "गोत्र और सदस्य प्रकाशित सत्यापन सूची में जोड़ दिए गए हैं।" });
  } catch (error) { await client.query("ROLLBACK"); if (error.code === "23505") return response.status(409).json({ error: "यह गोत्र पहले से मौजूद है।" }); next(error); } finally { client.release(); }
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

app.use(express.static(root));
app.use((error, request, response, next) => { console.error(error); response.status(500).json({ error: "Server error." }); });
app.listen(port, "0.0.0.0", () => console.log(`Kul-Kirti running on port ${port}`));
