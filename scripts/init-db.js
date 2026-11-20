require("dotenv").config({ path: process.env.DOTENV_CONFIG_PATH || ".env.local" });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const { poolOptions } = require("../lib/db-config");
const { runMigrations } = require("../lib/migration-runner");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = new Pool(poolOptions());
  let client = await pool.connect();
  try {
    await client.query(fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8"));
    client.release();
    client = null;
    const applied = await runMigrations(pool);
    client = await pool.connect();
    if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);
    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      /* Bootstrap only.  Never overwrite an existing password on deploy — use
         `npm run admin:rotate-password` for an explicit password change. */
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      const result = await client.query(
        "INSERT INTO admins (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING",
        [process.env.ADMIN_EMAIL.trim().toLowerCase(), hash]
      );
      console.log(result.rowCount
        ? "Database schema initialized and admin account created."
        : "Database schema initialized; existing admin password was preserved.");
    } else {
      console.log("Database schema initialized. No admin account was created because ADMIN_EMAIL/ADMIN_PASSWORD are not configured.");
    }
  } finally { client?.release(); await pool.end(); }
}
main().catch((error) => { console.error(error.message); process.exit(1); });
