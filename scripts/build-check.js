const fs = require("fs");
const { execFileSync } = require("child_process");

const JS_FILES = [
  "server.js", "app.js",
  "scripts/init-db.js", "scripts/rotate-admin-password.js", "scripts/build-check.js",
  "lib/db-config.js", "lib/http-security.js", "lib/genealogy.js", "lib/csv-parser.js",
  "lib/vanshawali.js", "lib/vanshawali-routes.js", "lib/admin-exports.js",
  "lib/migration-runner.js", "lib/admin-console-core.js", "lib/admin-console-routes.js",
  "public/js/i18n.js", "public/js/family-tree.js", "public/js/vanshawali-explorer.js",
  "public/js/vanshawali-editor.js", "public/js/samiti-directory.js",
  "public/js/admin-login.js", "public/js/admin-vanshawali.js", "public/js/admin-console.js",
  "test/vanshawali.test.js", "test/family-tree.test.js", "test/http-security.test.js",
  "test/api-integration.test.js",
  "test/admin-exports.test.js", "test/admin-console.test.js", "test/samiti-directory.test.js",
  "test/decision-audit.test.js",
];
for (const file of JS_FILES) {
  if (!fs.existsSync(file)) throw new Error(`Missing required JS file: ${file}`);
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

const REQUIRED_FILES = [
  "index.html", "history.html", "search.html", "vanshawali.html", "vanshawali-create.html",
  "samiti.html", "admin.html", "admin-login.html", "privacy.html", "404.html",
  "styles.css", "pages.css", "public/css/admin-console.css", "neon.ts",
  "db/schema.sql", "db/migrations/2026-11-20-admin-console.sql",
  "db/migrations/2026-11-28-family-spouse-gotra.sql",
  "db/migrations/2026-11-28-samiti-directory.sql", "sitemap.xml",
  ".env.example", "render.yaml",
];
for (const file of REQUIRED_FILES) if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
for (const file of ["locales/en.json", "locales/hi.json"]) JSON.parse(fs.readFileSync(file, "utf8"));

/* The retired admin flows and legacy editor must not creep back into the build. */
for (const file of ["submit.html", "mera-pariwar.html", "public/js/mera-pariwar.js",
  "public/js/admin-pariwar.js", "public/js/admin-workflow.js"]) {
  if (fs.existsSync(file)) throw new Error(`Retired file is present: ${file}`);
}
console.log("Build check passed.");
