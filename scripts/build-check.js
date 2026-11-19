const fs = require("fs");
const { execFileSync } = require("child_process");

for (const file of [
  "server.js", "app.js", "scripts/init-db.js",
  "lib/genealogy.js", "lib/csv-parser.js", "lib/vanshawali.js", "lib/vanshawali-routes.js",
  "public/js/vanshawali-explorer.js", "public/js/mera-pariwar.js",
  "public/js/admin-login.js", "public/js/admin-pariwar.js", "public/js/admin-workflow.js",
  "public/js/vanshawali-editor.js", "public/js/admin-vanshawali.js",
]) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
for (const file of ["index.html", "history.html", "search.html", "submit.html", "vanshawali.html", "vanshawali-create.html", "samiti.html", "admin.html", "admin-login.html", "mera-pariwar.html", "styles.css", "pages.css", "neon.ts", "db/schema.sql"]) if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
for (const file of ["locales/en.json", "locales/hi.json"]) JSON.parse(fs.readFileSync(file, "utf8"));
console.log("Build check passed.");
