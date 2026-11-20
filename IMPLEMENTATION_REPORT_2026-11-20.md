# Admin Control Console — Implementation Report

**Date:** 2026-11-20  
**Repository:** `kulkirti` (working tree, uncommitted)  
**Scope:** Complete, DB-backed administrative control system for the deployed Vanshawali website, added without replacing the verified public flow.

---

## 1. Outcome

All 16 requested administrative modules are implemented as database-backed routes and a responsive admin console. The original Home → Search / Vanshawali → Create Tree → Save/Submit → Admin verification workflow remains intact and is preserved inside the console as **Original Verification Flow**.

Security invariants were retained:

- Every `/api/admin/console/*` operation is authenticated and checked against database-backed permissions; access denies by default.
- No token-claim role is trusted for privilege escalation; the current DB role and per-admin overrides are authoritative.
- Gotra-first hierarchy remains intact; only Admin/Super Admin can create or manage Gotras.
- Token-based tree ownership, immutable verification history, and `person_relationships` as the genealogy source of truth are unchanged.
- Verification and tree-link handlers are reused from `lib/vanshawali-routes.js`; no auto-merge based only on Gotra, village, or name is performed.
- Changes to verified records create revisions and re-enter verification.
- Daughter records remain name-only leaves; sons retain recursive branches.

---

## 2. Completed modules

| # | Module | Backend capability |
|---:|---|---|
| 1 | Admin Overview Dashboard | Counters, status chart, top Gotras, recent trees, recent audit timeline |
| 2 | Gotra Management | List, create, edit, activate/deactivate, delete with duplicate-name validation |
| 3 | Complete Family Tree Management | List/filter, detail, edit, archive/restore, delete, revision history, tree content |
| 4 | Individual Member Management | List/filter, detail, edit, branch assignment, archive |
| 5 | Family Tree Verification | Queue, assignment, due dates, decisions via the existing verification handler |
| 6 | Master Vanshawali Management | Tree index, branch comparison, ancestor lookup, hierarchy and link listing |
| 7 | Family Branch Linking / Unlinking | Create branch, link/unlink branches, inspect hierarchy, reverse link |
| 8 | Duplicate Detection | Candidate scan, score/reason storage, review decisions and audit trail |
| 9 | Village Management | Aggregated village data, rename and merge with safeguards |
| 10 | User and Account Management | Admin accounts, contributors, sessions, create/edit/reset-password/deactivate |
| 11 | Notifications | Create, recipient targeting, read/unread tracking, mark-all-read, delete |
| 12 | Reports and Analytics | Period filters, tree/verification/link/contribution/audit metrics, charts |
| 13 | Excel / CSV / PDF Exports | Dataset exports using dependency-free CSV, real XLSX OOXML, and PDF generators |
| 14 | Backup and Restore Management | Logical JSON snapshots, checksums, row counts, download, two restore modes, audit |
| 15 | Admin Activity Logs | Filterable log with action/entity/category/date scope and detail records |
| 16 | Role and Permission Management | Role permission matrix, Super Admin-only updates, per-admin overrides |

The console also includes a 17th navigation entry, **Original Verification Flow**, which mounts the pre-existing verification UI unchanged.

---

## 3. Changed files

### Modified

- `admin.html` — loads the new console CSS/JS and contains `#admin-console-root`; preserves the original verification markup.
- `app.js` — removed the invalid brand `data-i18n-aria-label` accessible-name override.
- `lib/vanshawali-routes.js` — exposes `decisionHandler`, `linkHandler`, and `reverseLinkHandler` for reuse by the console.
- `pages.css` — admin tree card heading level/style aligned with the console heading structure.
- `public/js/admin-vanshawali.js` — admin tree card heading changed from `h4` to `h3` to restore heading order.
- `scripts/build-check.js` — syntax-checks all new JS and requires the migration, CSS, and test files.
- `scripts/init-db.js` — runs additive migrations after bootstrap and fixes the double-release path.
- `server.js` — migration startup, admin session tracking, hardened login lockout, DB role refresh, central `/api/admin` gate, console route registration, retired endpoint `410` middleware, Render origin/CORS fallback.

### Added

- `db/migrations/2026-11-20-admin-console.sql`
- `lib/admin-console-core.js`
- `lib/admin-console-routes.js`
- `lib/admin-exports.js`
- `lib/migration-runner.js`
- `public/css/admin-console.css`
- `public/js/admin-console.js`
- `test/admin-console.test.js`
- `test/admin-exports.test.js`
- `IMPLEMENTATION_REPORT_2026-11-20.md`

Prior audit context is retained in `AUDIT_REPORT_2026-11-19.md` and `AUDIT_REPORT_2026-11-20.md`.

---

## 4. Database migrations

`db/migrations/2026-11-20-admin-console.sql` is additive and replay-safe. It is applied by `lib/migration-runner.js`, which owns the `schema_migrations` ledger and runs each migration in its own transaction after `db/schema.sql`.

### Schema additions

- `admins`: `display_name`, `is_active`, `last_login_at`, `failed_login_count`, `locked_until`, `password_changed_at`, `created_by`, and `admins_role_check`.
- RBAC: `admin_roles`, `admin_permissions`, `admin_role_permissions`, `admin_permission_overrides`.
- Sessions: `admin_sessions` with per-JTI tracking and admin-indexed lookup.
- Audit metadata: `genealogy_audit` gains `ip`, `user_agent`, `request_id`, `severity`, `category` plus created/category indexes.
- Workflow: `family_tree_revisions`, `verification_assignments`.
- Linking: `branch_links`.
- Data quality: `duplicate_candidates`.
- Messaging: `notifications`.
- Backup/restore: `admin_backups`, `admin_restore_jobs`.
- Expression indexes on normalized names/villages for duplicate and village queries.

### Permission seed

16 modules × 3 actions = 48 permission keys:

- `super_admin`: all 48 permissions.
- `admin`: all `view` permissions; `edit` on `gotras`, `trees`, `members`, `verification`, `master`, `branches`, `duplicates`, `villages`, `notifications`, `reports`, `exports`, `activity`; `approve` only on `verification`, `master`, `branches`, `duplicates`.
- `accounts`, `roles`, and `backups` mutations remain Super Admin-only at the route layer.
- A corrective `UPDATE` realigns role grants if an earlier build of the migration was already applied.

---

## 5. Permission model

The server resolves access with:

1. `admin_permission_overrides` for the signed-in admin, if present.
2. `admin_role_permissions` for the current DB role.
3. `FALSE` by default.

The client receives only module visibility and action metadata from `/api/admin/console/meta`; the UI mirrors server guards so unauthorized controls are hidden, but every mutation re-checks permission server-side. Sensitive account, role, backup download/restore/delete, and master-link reversal routes also require `super_admin`.

Retired endpoints (`/api/submissions`, `/api/admin/submissions`, `/api/admin/family-records`, `/api/pariwar/*`, `/api/admin/pariwar/*`) are intercepted before route handling and return `410 Gone`. `submit.html`, `mera-pariwar.html`, and the old `mera-pariwar.js` remain absent and are enforced by the build check.

---

## 6. Validation performed

| Check | Result |
|---|---|
| `npm test` | **33 passed, 0 failed** |
| `npm run build` | Passed; all required files and syntax checks present |
| `git diff --check` | No whitespace errors; only LF→CRLF notices on pre-existing Windows-normalized files |
| Lighthouse on local admin mock | Accessibility **1.00**, Best Practices **1.00**, SEO **1.00**, zero failures |
| 17-module browser pass | 17/17 modules rendered; zero console errors, duplicate IDs, inline handlers, overflow, or broken internal links |
| HTML i18n check | 10 HTML files, 154 keys, no missing Hindi/English keys |
| JS i18n check | Only the known dynamic `genealogy.*` concatenation false positives |
| Sitemap check | 11 URLs, all local targets exist; `admin.html` excluded; no retired paths |
| Syntax checks | `server.js`, `app.js`, all new/modified `lib`, `public/js`, `scripts`, and `test` JS files pass `node --check` |
| Retired API guard | Middleware returns `410 Gone` before legacy handlers can run |

The browser and Lighthouse runs used the local mock server at `http://127.0.0.1:5599/admin.html` with an authenticated `super_admin` response. Database behavior was exercised by the Node test suite with a mock pool that asserts SQL shape, guards, pagination, validation, and audit writes.

---

## 7. Notable fixes during final verification

- Module loaders now cache the full API response, not just HTML, so edit dialogs and toggles use real rows.
- Corrected response keys for Gotra, tree, member, account, and activity caches.
- Reports date filters now use each table's own timestamp column (`genealogy_contributions.submitted_at`, `genealogy_audit.created_at`) with correct placeholder numbering.
- Overview "Top Gotras" chart labels use the endpoint's `name` field.
- UI controls are gated against the same module/action and Super Admin rules enforced by the server.
- `/api/admin/console/meta` is available to any authenticated admin so revoking `overview:view` cannot hide all remaining modules.
- Permission seed corrected to match the documented and tested policy.
- Accessibility fixes produce a clean Lighthouse accessibility audit.

---

## 8. Outstanding limitations

- **No live deployment was performed.** No production site, live Neon database, Render service, or live secret was contacted.
- **Live DB runtime verification remains pending.** A seeded local Postgres instance or disposable Neon branch is needed for end-to-end SQL execution against the full schema. Tests validate query construction and guards with a mock pool.
- **Secret rotation is user/provider action.** Live Neon, JWT, admin, and Realtime secrets were not rotated; this must be done in the Neon/Render consoles.
- **`.env.local` was not moved.** It remains under OneDrive/Desktop and points to a live Neon database; moving it out of the synced folder requires user action.
- **Backup/restore is logical, not physical.** Snapshots are JSON payloads with checksums and row counts. Restore is confirmation-gated and table-scoped; use Neon branch/restore tooling for disaster recovery or point-in-time recovery.
- **PDF Devanagari is romanised.** Standard PDF fonts cannot embed Unicode Devanagari; CSV and XLSX preserve original text.
- **`npm audit --omit=dev` was not run** because network/registry access was intentionally avoided.
- A few server endpoints are available but have no dedicated UI button: `GET /trees/:id/revisions`, `GET /trees/:id/restore`, `GET /verifications`, `GET /master/hierarchy`, `POST /master/link/:id`, and `GET /reports/export`. They remain valid API capabilities and are protected by the normal permission guards.

---

## 9. Deployment notes

1. Ensure `DATABASE_URL` is set for the target environment.
2. Start the app or run `npm run db:init`; `lib/migration-runner.js` applies `db/migrations/2026-11-20-admin-console.sql` once and records it in `schema_migrations`.
3. Seed or rotate the initial Super Admin account through the existing admin bootstrap/password tooling.
4. Verify `/healthz`, then log in at `/admin.html`.
5. Confirm that retired endpoints still return `410 Gone` and that only intended admins can see sensitive controls.
