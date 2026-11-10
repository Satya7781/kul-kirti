const fs = require("fs");
const { execFileSync } = require("child_process");

for (const file of ["server.js", "app.js", "scripts/init-db.js"]) execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
for (const file of ["index.html", "history.html", "search.html", "submit.html", "vanshawali.html", "samiti.html", "admin.html", "styles.css", "pages.css", "neon.ts", "db/schema.sql"]) if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
console.log("Build check passed.");
