# Kul-Kirti website audit — 20 November 2026

## Scope and method

This report audits the **current working tree**, including the 20 Nov simplification that removed the legacy `submit.html` / `mera-pariwar.html` pages and collapsed the admin panel to one verification view.

Methods used:

- Static review of server/API code, schema, build/deploy files, all remaining frontend modules, locale files, env examples and prior audit reports.
- Three independent deep-dive reviews (backend/security, frontend/a11y, data/build) plus direct verification of the highest-impact claims.
- Automated checks: `npm run build`, `npm test`, `git diff --check`, locale key coverage, sitemap XML validation, dependency listing.
- Runtime checks against a **local mock server only** (CSP mirrored from `server.js`, mocked API responses). Nine HTML pages were loaded in Chromium; console errors, DOM structure, internal links, language switching and Lighthouse (accessibility / best practices / SEO) were checked.
- **No production site and no live database were contacted.** `.env.local` contains live Neon credentials and points to a live endpoint, so DB-backed SQL flows could not be exercised.

---

## Executive summary

| Severity | Count | Main themes |
|---|---:|---|
| Critical | 1 | Deploy-time admin password reset |
| High | 6 | Incomplete/stale RBAC, disabled DB TLS verification, live secrets on disk, unverified DB flows, token-based ownership, missing privacy/consent |
| Medium | ~25 | Session revocation, login abuse, public-data privacy boundaries, transaction/audit consistency, migration gaps, accessibility/keyboard gaps, incomplete localisation |
| Low | ~15 | Dead code/assets, stale i18n/sitemap metadata, minor headers, focus ring, operational lifecycle |

**Overall:** the simplified site is coherent, has strict script CSP, consistent output escaping, and a working core flow. The highest priorities are operational/security correctness (password reset on deploy, RBAC, TLS, secrets) and database-backed verification. UI accessibility and clean-up issues are secondary but numerous.

### Top 5 actions before production reliance

1. Change `scripts/init-db.js:15` from `DO UPDATE` to `DO NOTHING` so deploys stop resetting the admin password.
2. Replace role fallback/stale JWT claims with a per-request DB role check; apply `requireRole` to all `/api/admin/*` routes.
3. Enable verified PostgreSQL TLS; rotate the credentials currently stored in `.env.local` and move that file out of the OneDrive-synced workspace.
4. Create a seeded local/branch database and run integration tests for approval, linking, RBAC, rate limits and transactions.
5. Address keyboard-inaccessible tree nodes and missing programmatic labels on search/filter inputs.

---

## A. Security and backend

### Critical / High

| ID | Severity | Finding | Evidence | Fix |
|---|---|---|---|---|
| SEC-01 | **Critical** | Admin password is overwritten on every deploy. | `scripts/init-db.js:15` uses `ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash`; `render.yaml:5` runs `npm run db:init` on every build. The startup-safe path at `server.js:119-120` correctly uses `DO NOTHING` but runs later. Docs claim the opposite (`README.md:75`). | Make init bootstrap-only (`DO NOTHING`); add an explicit `npm run admin:rotate-password`; correct docs. |
| SEC-02 | **High** | RBAC is incomplete and role claims are trusted/stale. | `requireRole()` at `server.js:183-191` falls back to `"super_admin"` when a token lacks a role; `auth()` (`server.js:167-178`) never checks the current `admins` row. Only newer Vanshawali routes apply `requireRole`; core admin routes such as gotra create/update (`server.js:480,501`), submissions (`:574`), people (`:989,1065,1123`) and branches (`:1202`) use `auth` only. | Load current role from `admins` per request in one central middleware; remove fallback; apply explicit roles to every `/api/admin/*` route; revoke tokens on role change. |
| SEC-03 | **High** | Database TLS certificate verification is disabled in production. | `server.js:23` and `scripts/init-db.js:9`: `ssl: { rejectUnauthorized: false }` when `NODE_ENV=production`. | Use `sslmode=verify-full` with the provider CA; fail startup if the CA is missing. |
| SEC-04 | **High** | Live production secrets are present in a cloud-synced workspace. | `.env.local` holds Neon pooled/unpooled URLs, realtime URL/secret, JWT secret and admin credentials under `OneDrive\Desktop`; mitigated by `.gitignore:3` and absent git history. | Rotate all credentials; move env file outside OneDrive; use Render secret manager/OS keychain; broaden ignore to `.env.*`. |
| SEC-05 | **High** | Database-backed behaviour is entirely unverified. | No seeded local DB; `.env.local` points to live Neon. Integrations for approval/link/reverse, RBAC 403s, rate-limit 429s and persisted XSS payloads have never run. | Create disposable local DB/branch and integration suite before release. |
| SEC-06 | **High** | Tree ownership is an unexpiring bearer token and sensitive JSON is cacheable. | `GET/PUT /api/vanshawali/trees/:token` (`lib/vanshawali-routes.js:321,345`); no `Cache-Control: no-store` on admin/token endpoints (`server.js:304-305,563-570,1867-1880`). | Add token expiry/rotation/revocation; set `no-store` on all authenticated/token responses; avoid URL-borne tokens where practical. |
| SEC-07 | **High** | Contributor PII is collected with no consent, retention notice or deletion path. | Submitter name/contact and person data stored in schema; earlier audit §8. | Add consent checkbox, purpose/retention statement, privacy link and data-request workflow. |

### Medium

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| SEC-08 | Logout revocation is process-local. | `jti` denylist at `server.js:72,172,291-299`; revoked tokens become valid after restart or on another instance until expiry (8 h). | Store denylist in Postgres/Redis with TTL, or shorten token life. |
| SEC-09 | Login enumeration/spraying risk. | `server.js:280-288`: unknown emails skip `bcrypt.compare` (timing oracle); limiter key includes email, giving each account a fresh bucket. | Always run a dummy compare; key limiter by IP plus global backoff. |
| SEC-10 | Origin guard can be bypassed/weakens without configuration. | `server.js:155-159` skips requests with no `Origin` and derives allowed origin from headers when `FRONTEND_ORIGIN` is unset. | Require `FRONTEND_ORIGIN` in production; require `Origin` on authenticated mutations; do not derive trust from client headers. |
| SEC-11 | Error middleware converts client errors to `500`. | `server.js:2100`; JSON parser `413`/`400` at `:65`. | Use `error.status \|\| 500`; map parse/payload errors explicitly. |
| SEC-12 | Audit rows can escape transactions. | `server.js:527,1218,1740,1768`; `lib/vanshawali-routes.js:468,502` pass shared `pool` to `logAudit`. | Pass the same transaction client to audit writes. |
| SEC-13 | Relationship validation race. | `server.js:1137` validates on shared `pool`, then `BEGIN` at `:1149`; concurrent inserts can bypass cycle/parent checks. | Begin transaction before validation and pass `client`; add DB invariants. |
| SEC-14 | Tree-link lock ordering can deadlock. | `lib/vanshawali-routes.js:637-638` locks source then target. | Lock in deterministic UUID order; retry on `40P01`. |
| SEC-15 | Public profile endpoints leak internal fields. | `server.js:783-786,806-810,837-845`; `stripId()` only cleans related arrays. `id`, `status`, `visibility` are returned. | Whitelist public fields explicitly. |
| SEC-16 | `visibility='members'` has no member authentication and inconsistent filtering. | `server.js:795-810`; deceased/private handling varies. | Define a real members policy or collapse to public/private; apply one field filter everywhere. |
| SEC-17 | Unfiltered public datasets. | `/api/records` returns raw `family_details` (`server.js:240`); village counts include draft/pending people (`:1411-1420`); gotra detail returns draft branches (`:742-745`). | Filter to `status='verified'` and per-person visibility. |
| SEC-18 | Public visual can reference hidden people. | `lib/vanshawali-routes.js:51-69` filters relationships only by child/status; private parents are returned as IDs. | Require both endpoints verified + public. |
| SEC-19 | Public Gotra directory counts non-public people. | `lib/vanshawali-routes.js:280-281`. | Add `status='verified' AND visibility='public'`. |
| SEC-20 | Root-name search assumes array element 0. | `lib/vanshawali-routes.js:225-226,232-233,407-408,415,528-529` use `current_revision->0->>'name'`, contradicting the unordered-input contract (`lib/vanshawali.js:32-36`). | Search JSONB for `memberType='root'` or persist `root_name`. |
| SEC-21 | Public search has unbounded N+1 recursion and incomplete status filtering. | `lib/vanshawali-routes.js:175-219`: up to 40 extra queries; ancestor/descendant joins filter `visibility` but not `status`. | Batch with CTE/LATERAL; add status filter and pagination. |
| SEC-22 | Tree save/submit endpoints lack rate limits. | `lib/vanshawali-routes.js:293` limits creation only; `:345` and `:372` do not. | Apply per-token/IP limits. |
| SEC-23 | Legacy APIs for removed pages remain live. | `/api/submissions` (`server.js:270`), `/api/admin/family-records` (`:535`), `/api/pariwar/create` (`:1814`), `/api/pariwar/:token` (`:1868`) etc. remain while UI is removed. | Remove/deprecate or document as retained API. |

### Low

- Latent XSS sink in unreachable `initTree()` renderer: `app.js:616-624` interpolates record fields unescaped; `#published-tree` no longer exists. Escape or delete.
- Input validation gaps: unchecked enums/IDs at `server.js:1005-1011,1095,1214-1216,1731`; return `400` rather than relying on DB CHECK errors.
- Branch update ignores `rowCount` (`server.js:1736-1741`) — return `404`.
- Rejection is unaudited and has no state guard (`server.js:2051-2058`).
- CSV import staging has no explicit row cap (`server.js:1482-1496`); body is capped at 1 MB.
- Post-commit `refreshTreeProjection()` calls are not awaited (`lib/vanshawali-routes.js:611,697,728`).
- `crypto.randomUUID()` without fallback in dead `app.js` paths (`:516,1033,1406`); editor has a proper fallback.
- URL sinks are HTML-escaped but not scheme-validated (`app.js:372`, `explorer.js:102`, API builders); safe today because server emits relative URLs.
- `style-src 'unsafe-inline'` remains for legacy inline styles (`server.js:49-52`).

### Positive controls

- **No SQL injection found**: all reviewed user values are parameterized; dynamic fragments come from fixed whitelists (`server.js:506-524,1085-1106,1736-1739`).
- Strict CSP: `default-src 'self'`, `script-src 'self'`, `script-src-attr 'none'`, `object-src 'none'`, `frame-ancestors 'none'` (`server.js:42-63`); local mirror confirmed headers.
- Static exposure fixed: `/public`, `/locales` and an explicit file allowlist (`server.js:2079-2095`); repo root files not served.
- Admin-page gate hardened against encoded-path bypass (`server.js:1793-1803`); admin pages are `noindex`.
- Reachable stored XSS appears fixed: `escapeHtml()`/`esc()` used across `app.js` and all active public/admin modules; no inline handlers or `javascript:` URLs remain.
- Session basics: JWT `jti`, `httpOnly`/`SameSite=lax`/production-`secure` cookie, 8 h expiry, bcrypt cost 12, generic login errors.
- Rate limiting on public writes with `trust proxy` and pruning (`server.js:29,74-100,270,891,1814`).
- UUID normalization helper (`server.js:196-200`) and bounded pagination (`:102-110`).
- Most relationship/import/link flows use the transaction client; decisions, links and reversals are audited.

---

## B. Data and schema

| ID | Severity | Finding | Evidence | Fix |
|---|---|---|---|---|
| DATA-01 | **High** | No migration versioning; "additive only" claim is false. | `db/schema.sql:326,391` ADD COLUMN; `:434,440,443,446` DROP NOT NULL; `:458-460` one-way `UPDATE gotras`; full schema re-executed at boot (`server.js:112-114`) and on every build (`scripts/init-db.js:12`). | Adopt versioned migrations; run DDL once; make backfills explicit. |
| DATA-02 | Medium | Graph integrity is application-only. | Only no-self-parenting/unique triple at `db/schema.sql:185-187`; comment at `:528-529` claims cycle protection. Concurrency can bypass `lib/genealogy.js:34-59,372-382`. | Add constraint triggers/advisory locks; correct the comment. |
| DATA-03 | Medium | Tree projection accumulates stale rows. | `lib/genealogy.js:406-445` only INSERT/UPDATE; no DELETE for archived people or removed links. | Delete missing IDs in the rebuild transaction. |
| DATA-04 | Medium | Indexes do not match queries. | GIN FTS indexes (`db/schema.sql:74-75,142`) unused because searches use `ILIKE`; no indexes for `submissions` sort, `genealogy_contributions.submitted_at`, `people.created_at`. | Add B-tree/trigram indexes or switch to FTS. |
| DATA-05 | Medium | Duplicate canonical records possible. | No unique `(gotra_id, person_name)` (`db/schema.sql:26-36`); admin add inserts unconditionally (`server.js:372-380`). | Add constraints or dedupe checks. |
| DATA-06 | Low | "Immutable" verification history is not enforced. | Comment at `db/schema.sql:516-526`; no trigger or revoked privileges. | Add `BEFORE UPDATE/DELETE` trigger. |
| DATA-07 | Medium | Deployment/build gaps. | `render.yaml:5` omits `npm run build`; health check is static `/`; no graceful shutdown/`pool.end()` (`server.js:2101-2106`); Node unpinned while `@neon/*` need `>=20.19.0`. | Add build, `/healthz`, SIGTERM handling, pin Node 20.19+/22. |
| DATA-08 | Medium | Realtime advertised but not deployable. | `README.md:11`; `render.yaml:8-20` lacks realtime env; `server.js:25,262` returns 503 without secret; optional `ws` absent. | Add env + `ws`, or remove the claim. |
| DATA-09 | Low | Dependency hygiene. | `@neon/config` is production-only for `neon.ts:1`; `bcryptjs 2.4.3` old; `npm audit` not run (network prohibited). | Move to devDependencies, upgrade bcryptjs, scan in CI. |

**Positive data notes:** `IF NOT EXISTS`, FKs with cascades/SET NULL, CHECK enums, unique identity tokens, genealogy indexes (`db/schema.sql:92-107,141-163,190-193,467-536`); startup admin insert is non-destructive (`server.js:120`); schema.sql parses and the build check passes.

---

## C. Frontend, accessibility and i18n

### High

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| UI-01 | **High** | Genealogy trees are not keyboard accessible and have no accessible name. | Tree nodes are clickable `div`s with no `tabindex`/`role`/key handlers (`vanshawali-explorer.js:315-328,615-639`; `vanshawali-editor.js:379-391`; `vanshawali.html:153`). SVGs are unnamed or `aria-hidden` with no text alternative. | Render nodes as buttons or add `role="button" tabindex="0"` plus Enter/Space; add named SVG + offscreen relationship summary. |
| UI-02 | **High** | Blocked `localStorage` breaks i18n bootstrap. | `i18n.js:228,248,259` unguarded; `app.js:171-174` only has `.then()`. If storage throws, language switcher/footer stay uninitialised and `languagechange` never fires. | Wrap storage in `try/catch`; apply UI state in `.catch()`/`.finally()`. |

### Medium

| ID | Finding | Evidence | Fix |
|---|---|---|---|
| UI-03 | Search tabs lack full ARIA tab pattern. | `search.html:44,73`; `app.js:264-281,385-395`: no arrow-key navigation/roving tabindex; `#search-results` lacks `role="tabpanel"`. | Implement Arrow/Home/End and roving tabindex; add panel role/label. |
| UI-04 | Functional inputs rely on placeholders, not labels. | `vanshawali.html:50`; `vanshawali-create.html:37,48`; `admin.html:91,98,107,108`. Runtime DOM check confirmed no label/aria-label. | Add visually hidden `<label>` or `aria-label` with i18n keys. |
| UI-05 | English switch leaves core pages untranslated. | `vanshawali-create.html` is almost entirely hardcoded Hindi though it loads i18n; `_pageKey()` (`i18n.js:111-121`) falls through to index meta; admin/admin-login are Hindi-only. | Add `meta.create`, `meta.notFound`, `meta.adminLogin`; annotate visible copy. |
| UI-06 | Hardcoded dynamic strings in active scripts. | `app.js:355-366`; `vanshawali-explorer.js:94,199-210,248-253,318,484`; `vanshawali-editor.js:67-69,105-139,223-225,248-297`. | Move to locale keys; re-render on `languagechange`. |
| UI-07 | Two missing locale keys render raw key text. | `genealogy.members` and `genealogy.shareCopied` are absent from both locale files (`explorer.js:388,505`); `I18n.t()` returns the leaf key, so fallbacks never fire. | Add keys to both locales; CI-check all `I18n.t()` literals. |
| UI-08 | Simplification left large dead frontend blocks. | `app.js:421-560,562-595,601-629,654-867,975-1442,1450-1472`; `i18n.js:116`; unreferenced `admin-workflow.js`/`admin-pariwar.js`. | Remove after confirming no API consumers. |
| UI-09 | Admin tab map is stale and untranslatable. | `app.js:152-162,930-957,1450-1471` still maps `submissions`/`gotras`/`family-builder`; the only tab is hardcoded Hindi `admin.html:68-72`. `vsh.tabVerification` exists in locales. | Map `vanshawali` → `vsh.tabVerification`; remove obsolete keys. |
| UI-10 | Sitemap contradicts page directives. | `vanshawali-create.html:9` is `noindex` but is listed in `sitemap.xml:73-80` with untranslated hreflang variants; placeholder domain and 2024 dates remain. | Remove from sitemap or drop `noindex`; use real domain and refresh dates. |
| UI-11 | Duplicate clipboard handlers. | `.profile-share-btn` handled globally (`app.js:1543-1552`) and locally (`explorer.js:502-512`); two writes/label restorations. | Keep one handler using `data-share-url`. |
| UI-12 | Multiple error paths fail silently. | `app.js:628,926,1221`; `explorer.js:554`; `i18n.js:217-220`; `admin-vanshawali.js:104,170`. | Route failures to existing `role="status"`/`role="alert"` regions. |

### Low / defence in depth

- Language-switch accessible-name mismatch (WCAG 2.5.3): `app.js:133` sets `aria-label="Switch to English"` while visible text is "English"; axe reports this on every page. Include the visible text in the accessible name.
- Focus ring suppressed on focusable preview canvas (`pages.css:3200` vs `vanshawali.html:176`); add `:focus-visible` outline.
- Hardcoded Hindi ARIA labels on zoom controls (`vanshawali.html:180,182`; `vanshawali-create.html:85,87`).
- URL sinks HTML-escaped but not origin-validated (`app.js:372`; `explorer.js:102`); currently safe because server builds relative URLs.
- `style-src 'unsafe-inline'` retained for legacy inline styles.
- Unreferenced legacy scripts remain publicly fetchable under `/public/js/`.

### Positive frontend notes

- No inline event handlers; safe redirect validation in `admin-login.js:15-25`; escaping helpers used consistently.
- Locale parity exact for 439 flattened keys in each locale; 122 HTML `data-i18n*` keys all resolve; Hindi↔English switch verified in-browser with zero errors.
- Simplified nav/home cards; admin exposes one tab/panel; deep links `?gotra`, `?person`, `?tree`, `?id`, `?record`, `?q` handled.
- Accessibility primitives: skip link, `sr-only`, labelled search on `search.html`, live regions, `aria-expanded`, `aria-current`, global `:focus-visible`, reduced-motion support.
- Responsive breakpoints at 900/720/480 px and 721–1130 px header tightening; no overflow at 992 px in runtime checks.

---

## D. Performance and SEO

- Lighthouse scored **1.0 accessibility / 1.0 best practices / 1.0 SEO** on `/`, `/search.html`, `/vanshawali-create.html`, `/vanshawali.html` and `/admin.html`; the axe `label-content-name-mismatch` failure was still reported despite the 1.0 category score.
- Internal link crawl: 0 broken paths; no external `_blank` links; no duplicate IDs; no inline handlers.
- Sitemap XML well-formed, but has placeholder domain/stale dates and the `noindex`/hreflang contradiction above.
- No performance benchmark was run (the browser tool does not emulate devices or measure load performance); external Google Fonts remain render-referencing resources. Run a production-like performance pass once a seeded dataset exists.

---

## E. Build, tests and deployment

| ID | Severity | Finding | Evidence | Fix |
|---|---|---|---|---|
| BUILD-01 | Medium | Tests are validation-only. | `test/vanshawali.test.js:17-89` = 9 pure helper cases; no genealogy cycle tests, API/RBAC/transaction/CSV/schema tests; missing helper cases `too_many_members` and `unreachable_member`. | Add `node:test` suites with mocked `pg` or ephemeral Postgres; add CI. |
| BUILD-02 | Medium | README omits `npm test` and documents password behaviour incorrectly. | `README.md:67-69,75`. | Update docs; document `npm test`. |
| BUILD-03 | Low | `render.yaml` does not run `npm run build`. | `render.yaml:5`. | Add build step or enforce in CI. |
| BUILD-04 | Low | No graceful shutdown/DB pool close; static health check. | `server.js:2101-2106`; `render.yaml:7`. | Handle SIGTERM, call `pool.end()`, add `/healthz`. |
| BUILD-05 | Info | Installed dependencies resolve cleanly; no secret committed. | `npm ls --depth=0`; `.env.local` and `.neon` gitignored and absent from git history. | Keep `npm audit` in CI (not run here to avoid network). |

Automated results: `npm run build` ✅ · `npm test` 9/9 ✅ · `git diff --check` ✅ · all JS `node --check` ✅ · sitemap XML valid · i18n HTML key coverage 0 missing.

---

## F. Prior-findings status

The 19 Nov audit (`AUDIT_REPORT_2026-11-19.md`) recorded stored XSS, missing escaping, admin tab clutter and the orphaned deep link as fixed/partially fixed. Current status:

- ✅ No inline handlers or `javascript:` URLs in shipped HTML; escaping helpers in active modules.
- ✅ `?record=` / `?tree=` deep-link handling present.
- ✅ Admin tab clutter resolved (one tab).
- ✅ The earlier ~13 px horizontal overflow at 992 px is no longer reproducible.
- ✅ Static allowlist and encoded admin-path gate fixed.
- ⚠️ Privacy/consent, seeded-DB verification, RBAC completeness and deploy-time password reset remain open.

---

## Prioritised remediation roadmap

1. **P0:** Fix deploy-time password reset (SEC-01); enable verified TLS (SEC-03); rotate/relocate live secrets (SEC-04).
2. **P0:** Centralise RBAC with live role lookup, remove fallback, apply to all admin routes (SEC-02).
3. **P0:** Seed a local/branch DB and run integration tests for transactions, RBAC, rate limits and persisted payloads (SEC-05).
4. **P1:** Privacy/consent controls (SEC-07); token expiry/revocation + `no-store` (SEC-06); durable session revocation (SEC-08); login/origin hardening (SEC-09/10); error status contract (SEC-11).
5. **P1:** Public-data filtering and field whitelists (SEC-15–19); transaction/audit consistency (SEC-12–14).
6. **P2:** Keyboard-accessible trees (UI-01), robust i18n bootstrap (UI-02), labels (UI-04), locale keys (UI-07), sitemap/i18n metadata (UI-05/10).
7. **P3:** Remove dead pages/scripts/CSS/code, add CI a11y/API tests, performance benchmark, dependency upgrades.

---

## Verification evidence

| Check | Result |
|---|---|
| `npm run build` / `npm test` / `git diff --check` | Passed / 9 of 9 / clean |
| Local browser console errors | 0 across 9 pages |
| Internal link crawl | 0 broken paths |
| Horizontal overflow at 992 px | 0 pages |
| Duplicate IDs / inline handlers | 0 / 0 |
| Language switch | Hindi → English labels changed correctly, no errors |
| Mock create flow | Gotra loaded → tree created with token → editor with save/submit controls |
| Mock admin login | One tab, one visible panel, 8 stats cards, no errors |
| CSP headers (local mirror) | Strict Helmet CSP, HSTS, `nosniff`, `no-referrer` |
| Lighthouse | 1.0 / 1.0 / 1.0 on five key pages; one axe name mismatch reported |
| Live DB / production | Not contacted |

## Limitations

- DB/API behaviour exercised only against mocked endpoints; **no SQL was executed**.
- Real `server.js` gates `/admin.html` to authenticated admins; the mock served it directly, so that gate was reviewed statically, not exercised.
- Lighthouse was run without device emulation; no performance score is reported.
- Colour-contrast and screen-reader verification were not performed manually beyond automated checks.
- `npm audit` was not run because it requires network access.

**Report generated:** 20 November 2026 · **Working tree:** post-simplification, uncommitted changes included.

---

## G. Remediation status (same-day follow-up)

All findings above are preserved for the record. This section records what was changed in the working tree after the audit.

### Critical / High findings

| ID | Status | What changed |
|---|---|---|
| SEC-01 | ✅ Fixed | `scripts/init-db.js` now uses `ON CONFLICT (email) DO NOTHING`; added `npm run admin:rotate-password` (`scripts/rotate-admin-password.js`); `render.yaml` and `README.md` document the safe deploy behaviour. |
| SEC-02 | ✅ Fixed | `server.js` central `/api/admin/*` gate authenticates every request, loads the **current** admin row from Postgres, and fails closed (403) without a valid role. The `"super_admin"` fallback was removed. Sensitive Vanshawali/link/audit routes keep explicit `requireRole` narrowing via `lib/http-security.js`. |
| SEC-03 | ✅ Fixed | New `lib/db-config.js` supplies verified TLS (`rejectUnauthorized: true`) plus optional `DATABASE_CA` for both the app and init script. `.env.example`, `render.yaml` and README updated. |
| SEC-04 | ⚠️ External action required | `.gitignore` now covers `.env.*` except `.env.example`. Rotating the live Neon/JWT/admin/realtime secrets and moving `.env.local` out of OneDrive must be done in the provider consoles and on the user's machine; the repository cannot do that safely. |
| SEC-05 | ⚠️ Partially fixed | Added 12 offline tests with a fake DB/Express server (21 total). They cover consent, token rotation/revocation, deletion queue, admin privacy fulfilment, auth/RBAC, origin and rate limits. **A seeded local/branch Postgres run is still required** before claiming SQL-level verification. |
| SEC-06 | ✅ Fixed (mitigated) | 36-byte tokens, 30-day expiry, submit-time rotation, holder revocation and `no-store` on all token/admin responses. URL-borne tokens remain in the API contract, but replay windows are now bounded and revocable. |
| SEC-07 | ✅ Fixed | Consent checkbox + privacy notice in `vanshawali-create.html`, server-side consent validation, new `/privacy.html`, self-service revoke/delete, `privacy_requests` table and admin fulfil queue. |
| SEC-08 | ✅ Fixed | Durable `revoked_tokens` table with TTL, checked on every authenticated request; in-memory set is only a fast path. |
| SEC-09 | ✅ Fixed | Dummy bcrypt comparison for unknown accounts; per-IP and global login limits. |
| SEC-10 | ✅ Fixed | `FRONTEND_ORIGIN` is mandatory in production; authenticated mutations require an Origin header; no trust is derived from Host/forwarded headers. |
| SEC-11 | ✅ Fixed | `errorStatus()` preserves explicit 4xx statuses; 400/413 get clear messages. |

### Medium / Low findings addressed

| ID(s) | Status | What changed |
|---|---|---|
| SEC-12 | ✅ Fixed for transactional paths | All audited writes that already use a transaction client now pass that client to `logAudit`, including the legacy parivar rejection route. Non-transactional single-statement handlers still use the pool correctly. |
| SEC-13 | ✅ Fixed | `BEGIN` now happens **before** relationship validation and validation uses the same client; `enforce_genealogy_integrity()` DB trigger closes the concurrency gap. |
| SEC-14 | ✅ Fixed | Tree-link locks are acquired in deterministic UUID order. |
| SEC-15 / SEC-16 | ✅ Fixed | Public person responses use an explicit field whitelist; related people are whitelisted by normalising snake_case aliases; anything non-public is treated as restricted until a real member-auth policy exists. |
| SEC-17 / SEC-19 | ✅ Fixed | Verified/public filters applied to village counts, branches, Gotra detail and the Gotra directory counts. Legacy public write APIs return `410 Gone`. |
| SEC-18 | ✅ Fixed | Public visuals require both ends of a relationship to be verified and public. |
| SEC-20 | ✅ Fixed | `ROOT_NAME_SQL` searches JSONB for `memberType='root'` instead of assuming array position 0. |
| SEC-21 | ✅ Fixed | Person search now uses two batched recursive CTEs instead of up to 40 queries, and ancestors/descendants require both `status='verified'` and `visibility='public'`. |
| SEC-22 | ✅ Fixed | Separate limits on tree reads (120/15m), saves (60/15m) and submits (20/15m). |
| SEC-23 | ✅ Deprecated | Retired `/api/submissions`, `/api/admin/submissions`, `/api/admin/family-records`, `/api/pariwar/*` and `/api/admin/pariwar/*` now return `410 Gone` with a pointer to the Vanshawali API. |
| UI-01 | ✅ Fixed | Preview/public tree nodes are real `<button>` elements (or keyboard-handled where nesting forbids it); SVGs get accessible names/text alternatives; focus-visible styles added. |
| UI-02 / UI-07 | ✅ Fixed | `localStorage` access is exception-safe; all literal `I18n.t()` keys resolve in both locales; new meta/page keys added for create/privacy/404. |
| UI-04 | ✅ Fixed | Programmatic labels added to genealogy, creator and admin search/filter inputs; zoom controls use `data-i18n-aria-label`. |
| UI-05 / UI-10 | ✅ Fixed | Sitemap no longer lists the `noindex` create page, adds `/privacy.html`, uses current dates and drops the placeholder comment. |
| Low frontend items | ✅ Fixed | Language-switch accessible name includes visible glyph/label; stale admin tab maps and duplicate clipboard handler removed; dead `#published-tree` renderer deleted. |
| BUILD-01 | ✅ Improved | 21 tests now include API/RBAC/security integration coverage; a real DB suite remains outstanding (see SEC-05). |
| BUILD-02 / BUILD-03 / BUILD-04 | ✅ Fixed | README documents `npm test`, safe password rotation and TLS; `render.yaml` runs `npm run build`, pins Node 22 and uses `/healthz`; server handles SIGTERM/SIGINT and closes the pool. |
| Remaining dead assets | ✅ Fixed | `public/js/admin-pariwar.js`, `public/js/admin-workflow.js` and the old `mera-pariwar.js` are deleted; `build-check.js` fails if retired files reappear. |

### Remaining operational work

1. Rotate the live Neon, JWT, admin and Realtime secrets; delete/move `.env.local` from the cloud-synced Desktop.
2. Run the schema against a disposable local Postgres or Neon branch and execute the DB-backed integration flows (approval, link/reverse, audit immutability, DB triggers).
3. Re-run the local browser/Lighthouse pass with the new privacy page and updated create flow; the earlier automated pass predates these UI edits.
4. `npm audit --omit=dev` in CI/network-enabled environment (intentionally not run offline).

### Post-remediation automated checks

| Check | Result |
|---|---|
| `npm run build` | ✅ passed |
| `npm test` | ✅ 21/21 |
| `git diff --check` | ✅ clean (line-ending warnings only) |
| `node --check` on all changed JS | ✅ passed |
| Sitemap XML | ✅ valid |
| Locale JSON | ✅ valid |
| Local mock browser pass (10 pages) | 0 console errors, 0 duplicate IDs, 0 inline handlers, 0 broken internal links, no overflow |
| Lighthouse (privacy, create, admin) | 1.0 accessibility / 1.0 best practices / 1.0 SEO, 0 axe failures after fixing the language-switch accessible name |
| Live DB / production | Still not contacted |

### Post-report deployment hotfix

After the user reported a 503 on the Render deployment:

- `makeOriginGuard()` no longer returns 503 for `GET`/`HEAD`/`OPTIONS`; it fails closed only for mutations.
- Render's trusted `RENDER_EXTERNAL_URL` is now accepted as a fallback when `FRONTEND_ORIGIN` is not set, and is also used for the CORS origin.
- Added a regression test for read requests, explicit origins, and the Render fallback.
- `npm run build` and `npm test` (21/21) still pass.

A remaining 503 is therefore most likely a failed `/healthz` database check or a missing runtime secret. Check the Render service log and confirm `DATABASE_URL`, `JWT_SECRET`, `DATABASE_CA` (only if required by Neon), and `FRONTEND_ORIGIN` / `RENDER_EXTERNAL_URL`.
