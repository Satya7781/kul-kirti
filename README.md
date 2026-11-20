# Kul-Kirti

Gehlot Rajput Kul-Kirti is a historical and genealogical archive with:

- Separate public pages for history, search, Vanshawali, Samiti information, and tree creation
- Neon PostgreSQL persistence with verified TLS in production
- Gotra-first family trees held for admin verification before publication
- Admin authentication with hashed passwords, HTTP-only cookies, and current-role checks on every request
- Token-owned drafts with 30-day expiry, submit-time rotation, revocation, and contributor deletion requests
- UUID-based family-member and parent relationships protected by database invariants
- Neon Realtime sealed-query support

## Local development

1. Install Node.js 20.19+ (Node 22 recommended).
2. Copy `.env.example` to `.env.local`.
3. Configure `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
4. Initialize the database:

   ```powershell
   npm install
   npm run db:init
   ```

   `db:init` is additive and **never overwrites an existing admin password**.

5. Start the server:

   ```powershell
   npm start
   ```

Open <http://localhost:5500>.

## Routes

- `/` — home
- `/history.html` — historical overview
- `/search.html` — approved Gotra/Village search
- `/vanshawali.html` — family tree view
- `/vanshawali-create.html` — user family-tree creation (select a Gotra, save/submit for verification)
- `/privacy.html` — privacy, retention, and contributor rights
- `/admin.html` — protected admin verification queue

## Render deployment

This repository includes `render.yaml`.

- Build command: `npm ci && npm run build && npm run db:init`
- Start command: `npm start`
- Health check: `/healthz` (checks the database, not just a static file)

Set these Render environment variables:

```text
DATABASE_URL=<Neon pooled PostgreSQL connection string>
DATABASE_CA=<provider CA bundle in PEM form, if required>
JWT_SECRET=<long random secret>
ADMIN_EMAIL=<production admin email>
ADMIN_PASSWORD=<initial strong password; never rotated by db:init>
FRONTEND_ORIGIN=https://<your-render-service>.onrender.com
NODE_ENV=production
```

Production requires `FRONTEND_ORIGIN` and verifies the database TLS certificate. Never commit `.env.local` or production credentials.

To intentionally rotate an admin password:

```powershell
$env:NEW_ADMIN_PASSWORD = '<new strong password>'
npm run admin:rotate-password
```

Then update the `ADMIN_PASSWORD` secret in the host, and remember that existing JWTs are honoured only until their 8-hour expiry unless explicitly revoked.

## Verification

```powershell
npm run build
npm test
npm audit --omit=dev
```

`npm run build` checks syntax, required files, sitemap/locale assets, and confirms retired legacy flows have not returned. Tests are offline and use fake databases/mocks — no production site or live database is contacted.

Historical and genealogical records should be published only after evidence review and explicit admin verification.

## Audit and security notes

The current audits are documented in [AUDIT_REPORT_2026-11-19.md](./AUDIT_REPORT_2026-11-19.md) and [AUDIT_REPORT_2026-11-20.md](./AUDIT_REPORT_2026-11-20.md). The 2026-11-20 report includes the remediation status for all findings.
