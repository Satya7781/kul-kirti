/**
 * db-config.js — a single, auditable place for PostgreSQL connection options.
 *
 * Production must verify the server certificate.  Set DATABASE_CA to the
 * provider CA bundle (PEM) when the system trust store is not enough; newlines
 * may be written literally as \n in a one-line environment variable.
 */
"use strict";

function productionSslOptions() {
  if (process.env.NODE_ENV !== "production") return false;
  const ca = process.env.DATABASE_CA
    ? process.env.DATABASE_CA.replace(/\\n/g, "\n")
    : undefined;
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

function poolOptions() {
  return {
    connectionString: process.env.DATABASE_URL,
    ssl: productionSslOptions(),
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
  };
}

module.exports = { productionSslOptions, poolOptions };
