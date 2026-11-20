/**
 * migration-runner.js — tiny additive migration runner.
 *
 * db/schema.sql remains the bootstrap baseline. Numbered SQL files in
 * db/migrations are applied in filename order, each in its own transaction,
 * and recorded in schema_migrations. Re-running is safe.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");

async function runMigrations(pool, directory = MIGRATIONS_DIR) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  if (!fs.existsSync(directory)) return [];
  const files = fs.readdirSync(directory)
    .filter(name => /^\d{4}-\d{2}-\d{2}[-\w]*\.sql$/i.test(name))
    .sort();
  const applied = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/i, "");
    const existing = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
    if (existing.rowCount) continue;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(fs.readFileSync(path.join(directory, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await client.query("COMMIT");
      applied.push(version);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${version} failed: ${error.message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

module.exports = { runMigrations, MIGRATIONS_DIR };
