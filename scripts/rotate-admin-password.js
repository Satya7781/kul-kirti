/**
 * Explicit admin password rotation.  `npm run db:init` will never overwrite an
 * existing password, so deployments are safe; run this only when you intend to
 * change credentials, then update the ADMIN_PASSWORD secret in the host too.
 */
require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { poolOptions } = require("../lib/db-config");

async function main() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || process.env.NEW_ADMIN_PASSWORD || "";
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!email) throw new Error("ADMIN_EMAIL is required.");
  if (password.length < 12) throw new Error("Password must be at least 12 characters (set ADMIN_PASSWORD or NEW_ADMIN_PASSWORD).");

  const pool = new Pool(poolOptions());
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "UPDATE admins SET password_hash = $1 WHERE email = $2",
      [hash, email]
    );
    if (!result.rowCount) throw new Error(`No admin found for ${email}.`);
    console.log(`Password rotated for ${email}. Remember to update the host's ADMIN_PASSWORD secret.`);
  } finally { await pool.end(); }
}
main().catch((error) => { console.error(error.message); process.exit(1); });
