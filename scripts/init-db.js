require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
  const client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8"));
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      await client.query("INSERT INTO admins (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash", [process.env.ADMIN_EMAIL.toLowerCase(), hash]);
      console.log("Database schema initialized and admin account ready.");
    } else {
      console.log("Database schema initialized. No admin account was created because ADMIN_EMAIL/ADMIN_PASSWORD are not configured.");
    }
  } finally { client.release(); await pool.end(); }
}
main().catch((error) => { console.error(error.message); process.exit(1); });
