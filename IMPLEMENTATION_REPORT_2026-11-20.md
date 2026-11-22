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
| `npm test` | **51 passed, 0 failed** |
| `npm run build` | Passed; all required files and syntax checks present |
| `git diff --check` | No whitespace errors; only LF→CRLF notices on pre-existing Windows-normalized files |
| Lighthouse on local admin mock | Accessibility **1.00**, Best Practices **1.00**, SEO **1.00**, zero failures |
| 17-module browser pass | 17/17 modules rendered; zero console errors, duplicate IDs, inline handlers, overflow, or broken internal links |
| Family-tree browser pass | Box click expands sons/daughters, `Expand all` reaches the fourth generation, verified detail collapses cleanly; zero console errors |
| Admin tree-preview browser pass | Verification review opens the connected box tree, approve moves the filter to `verified`; zero console errors |
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

### Post-report verification defects (2026-11-21)

- **Approve did not visibly persist:** decision buttons rendered in the detail panel were outside the delegated click handler. The same handler is now attached to `#admin-detail-body`, and after a decision the verification filter follows the returned status so an approved tree appears under **Verified** instead of staying on the stale pending queue.
- **Message overwritten by reload:** the confirmation message is written after the queue reloads.
- **Verified records were editable:** direct tree/member value edits now require `revisionIntent`; the original snapshot is preserved, a new revision is stored (rebuilt from canonical people and verified relationships for member edits), `current_revision` is updated to the proposed values, and the tree returns to `under_review` for re-verification.
- **Bulk village rename bypass:** renames/merges touching verified trees now require `revisionIntent` and reopen each affected tree for re-verification.
- UI edit buttons now read **Revise** for verified trees/members and open revision dialogs; server-side guards remain the final authority.

Targeted regression coverage was added for the delegated decision handler, status handoff from the shared decision handler, verified tree/member revision intent, and verified-tree-aware village changes. The browser pass confirmed: approve → `verified` filter + message, no console errors, and revise labels/dialogs for verified trees and members. Lighthouse remained 1.00/1.00/1.00 with zero failures.

### Family-tree visual fix (2026-11-22)

- All three visual tree surfaces — the public person tree, the verified tree detail view, and the token-editor preview — now use one shared renderer (`public/js/family-tree.js`). This removes the previous divergence where one view expanded on box click, another only on a small `+` button, and each drew different connectors.
- Clicking a person box reveals that person's verified sons and daughters. A separate `↗` link still opens the person profile from public/detailed trees.
- Connector lines are drawn as orthogonal parent → sibling-bar → child paths, making each parent/child relationship visually traceable. Daughters remain dashed, name-only leaves; only sons and roots can branch.
- `Expand all` now recursively lazy-loads every deeper generation in the public person tree instead of only expanding nodes already rendered. `Collapse all` keeps the root visible so the tree never disappears.
- Child queries now return `wife_name`, `member_type`, `birth_order`, and a `child_count`, so boxes show the correct metadata and children in birth order.
- Regression tests cover relationship-based hierarchy building, cycle/daughter protection, editor parent-map hierarchy, script wiring, and query metadata.

Local browser verification with seeded mock data confirmed: initial root + 3 children, box click reveals children, `Expand all` reveals the fourth generation, verified tree detail shows 8 boxes with 15 connector segments and collapses back to the root generation, and no console errors.

### Admin verification preview and decision-error hardening (2026-11-22)

- **Decision endpoint no longer collapses recoverable failures into a bare 500.** The admin console route now validates the decision before calling the shared handler, treats the console audit row as non-fatal, preserves explicit handler 4xx responses, maps data conflicts to `409`, and maps unexpected write failures to `422` with a user-readable message.
- **Audit writes inside the shared decision transaction are now non-fatal too.** `materialize()` and `decideTree()` wrap each genealogy audit insert in its own `SAVEPOINT`; a broken/outdated audit table is rolled back independently, logged, and never aborts the approval commit. This closes the remaining path by which an audit-only failure could surface as a `422` after the console-level fix.
- **Root cause of the remaining `08P01` approval failure fixed.** The relationship INSERT in `materialize()` supplied four bind values (`created_by` and `approved_by`) but only three placeholders (`$3, $3`). PostgreSQL rejected every parent-child insert with `bind message supplies 4 parameters … requires 3` (`08P01`), which surfaced as the generic 422. The statement now uses `$3, $4`. The same mismatch in the admin tree-link INSERT was corrected. The test mock now enforces placeholder/argument counts exactly like `pg`, so this class of bug fails the suite instead of production.
- **Database integrity-trigger rejections are handled at the edge level.** `db/schema.sql` installs `person_relationships_integrity`, which raises SQLSTATE `P0001` for a third biological parent or a cycle. That exception used to abort the whole approval and surface as a generic `422`. Each relationship insert now uses `SAVEPOINT kk_relationship_write`; a trigger rejection is rolled back, recorded in `skipped`, and the rest of the tree is approved. Any `P0001` that escapes elsewhere is mapped to `409` with the actual genealogy rule in the message.
- **Decision errors stay visible while the confirmation dialog is open.** The dialog renders the failure reason inline (`role="alert"`) instead of relying only on a toast behind the modal backdrop.
- **Schema drift is now self-diagnosing.** Missing columns/tables/functions (`42703`, `42P01`, `42883`, `42P10`, `42601`) return `503` with a "restart so migrations apply" instruction; transient capacity errors (`40001`, `40P01`, `57014`, `53300`) return `503` with a retry instruction. A non-blocking `information_schema` probe names any missing materialisation column in the error response. Every decision error response includes the DB `code`/`constraint` and a short `detail`, and the admin toast displays the message, so the next failure can be diagnosed without provider log access.
- **Corrupted revision entries are handled as validation errors.** A `null` or primitive member inside `current_revision` used to throw during validation and become a 500; it now fails validation cleanly with a 400 instead of crashing the decision route.
- **Admin review now has the same box-style tree preview.** Both **Tree details** and **Verification review** expose **View box tree**, which opens a large preview using the shared `public/js/family-tree.js` renderer. It uses the submitted `current_revision` members, so the reviewer sees the exact proposed parent-child hierarchy before approving.
- The preview supports box-click expansion, zoom, fit, expand-all and collapse-all, and keeps daughters as dashed name-only leaves. `admin.html` loads the shared renderer; `public/css/admin-console.css` provides the modal/canvas layout.
- Regression coverage now asserts that console- and transaction-level audit failures do not block approval, that handler failures return `409`/`422`/`503` rather than `500`, that the DB code is surfaced in the response, and that the admin preview is wired to the shared renderer.

Local browser verification against the admin mock confirmed: review opens, **View box tree** renders the proposed root + sons + daughter + grandchildren with 9 connector segments, the preview closes cleanly, approve shows `निर्णय सहेजा गया: verified।`, the verification filter moves to `verified`, and no console errors occur.

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
