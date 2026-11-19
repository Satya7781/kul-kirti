# Kul-Kirti website audit — 19 November 2026

## Scope and method

This is a fresh, full-stack audit of the checkout at `e9cd4b6`. It covers security, privacy, functionality, accessibility, SEO, performance, data/infrastructure, and operational readiness. Backend, frontend and infrastructure were reviewed statically with exact source references; public pages were additionally exercised in Chromium from a **local static-only server** (no production database or live service was contacted). Lighthouse scores and DOM/network evidence below come from that local run.

Dynamic API journeys, authenticated admin flows, and production Neon/Render behavior could not be exercised because no safe test database is configured in this checkout. Those areas are marked as static-review-only.

## Browser-verified findings

| Severity | Area | Finding | Evidence | Status |
|---|---|---|---|---|
| Medium | Reliability | Homepage hero image is broken (HTTP 404 from Unsplash). | `index.html` requests `images.unsplash.com/photo-1599661046827-dacff0c0f09f?...`; network log shows 404. | Open — verify URL/licensing or replace with a local asset. |
| Medium | Layout | All main pages overflow the viewport horizontally by ~13–14 px at a 992 px desktop width. | `document.documentElement.scrollWidth` 1006 vs `clientWidth` 992; offending element is the `button.language-switch` in the shared header (right edge 1006). Affects index, history, search, vanshawali, mera-pariwar, samiti, submit, admin, 404. | Open — needs CSS fix and mobile re-test. |
| Medium | Accessibility | Visible brand and language-switch text is not contained in their accessible names. | Lighthouse `label-content-name-mismatch` on every page that includes the shared header (10 pages). Elements: `a.brand` (visible "कु / कुलकीर्ति / GEHLOT RAJPUT ARCHIVE", `aria-label="कुलकीर्ति होम"`) and `button.language-switch` (visible "अ / English / ⌄"). | Open. |
| Medium | Accessibility | Three search inputs rely on `placeholder` instead of a programmatic label. | Live DOM check: `#genealogy-search-input` (vanshawali), `#token-input` (mera-pariwar), `#people-search-input` (admin). | Open — needs browser/axe confirmation in context. |
| Low | Accessibility | `404.html` has no `<main>` landmark and its skip link is not focusable. | Lighthouse: `landmark-one-main`, `skip-link`. | Open. |
| Low | Accessibility/SEO | `admin-login.html` has no `<main>` landmark, no `<h1>`, no meta description and no canonical URL. | Lighthouse accessibility 0.97, SEO 0.75; live DOM check. | Open. |
| Low | Functionality | `mera-pariwar.html` contains a dead `#` link; `vanshawali.html` back link uses `javascript:history.back()` rather than a real URL. | Live DOM check. | Open. |
| Info | Performance | Local trace of home page: 1 long task (~4.8 ms blocking), 106 ms total script evaluation, 44 ms layout; no console errors. | Chromium trace `trace.json.gz`, Lighthouse a11y/SEO/best-practices all 1.0 on most pages. | No action; representative of static shell only. |
| Info | Third-party | Two Google Fonts stylesheets and an external Unsplash image are loaded; no `preconnect` observed in the inspected `<head>`. | Live network/DOM check. | Consider self-hosting or adding preconnect. |

> Note: Lighthouse "Best Practices" = 1.0 here because the static test server does not represent production security headers (Helmet/CSP/HSTS). Production headers must be verified separately.

## Detailed findings — infrastructure, data, dependencies

All findings in this section are confirmed by source inspection / local commands.

### Critical / high

1. **Admin password is overwritten on every deployment.** `scripts/init-db.js:15` still uses `ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`, and `render.yaml:5` runs `npm run db:init` on every build. `server.js:57` was fixed to `DO NOTHING`, but the deploy path was not. `AUDIT_REPORT.md:24,62` and `README.md:75` claim the opposite. Any password rotation is undone on the next deploy and the configured password is reset to the Render env value.
2. **Stored XSS in the main client script.** `app.js` has no `escapeHtml` helper and interpolates server/contributor values into `innerHTML` at `app.js:323` (`record.name`), `:592-597` (unreviewed submission person names/IDs), and `:334,957` (`err.message`). The previous audit's XSS fix covered only the three genealogy modules. This affects public search results and the admin review UI.
3. **The whole repository is served statically.** `server.js:1729` uses `express.static(root)`, exposing `/server.js`, `/db/schema.sql`, `/scripts/init-db.js`, `/package.json`, `/package-lock.json`, `/AUDIT_REPORT.md`, `/README.md`, `/neon.ts`, `/node_modules/*` and `.env.example` without authentication. Dotfiles such as `.env.local` are hidden only by Express's default dotfile rule. Only `/admin.html` has a JWT guard (`server.js:1473-1482`).

### Medium

4. **CSV import commit is broken.** `server.js:1279` inserts a `city` column into `people`, but `db/schema.sql` has no `people.city` (only `locations.city` at `:308` and `import_rows.city` at `:353`). The import commit endpoint will fail with `column "city" does not exist`.
5. **Database TLS verification disabled.** `ssl: { rejectUnauthorized: false }` at `server.js:22` and `scripts/init-db.js:9` accepts any certificate for the Neon connection.
6. **Rate limiting ineffective and unbounded.** `server.js:30-47` keys on `request.ip`, but there is no `trust proxy` setting, so behind Render all clients share one bucket (10 logins / 20 submissions per 15 minutes globally). The `requestWindows` Map is never pruned; keys accumulate for the life of the process. Only `/api/submissions` and `/api/admin/login` are throttled (`server.js:164,174`).
7. **CSRF/origin checks incomplete.** `server.js:88-98` applies the Origin check only when `auth()` runs and only when an `Origin` header is present, with a derived fallback from client-controlled `x-forwarded-proto`/`Host` when `FRONTEND_ORIGIN` is unset. Public mutating routes `POST /api/genealogy/contributions` (`:595`), `POST /api/pariwar/create` (`:1493`) and `POST /api/realtime/published-records` (`:156`) have no origin check.
8. **Privacy/consent controls absent.** `submit.html:120-127,203-209` collects contributor name, contact and detailed family data with no consent checkbox, purpose statement, retention notice or policy link. No privacy/terms/legal page exists. `db/schema.sql:48-49,249-250,406-412` stores PII indefinitely and no delete/rectify endpoint exists. `GET /api/pariwar/:token` (`server.js:1542-1556`) exposes a submitted tree to anyone with the 16-hex-char token, without expiry or auth.
9. **Search does not use its indexes.** GIN full-text indexes at `db/schema.sql:72-73,140` are unused; all searches use `ILIKE '%...%'` (`server.js:128,133-134,580-588,648,684`). No indexes on `submissions.status`, `submissions.submitted_at`, `people.created_at`, `genealogy_contributions.submitted_at` or `gotras.status`, all of which are filtered or sorted. Correlated per-gotra subqueries at `server.js:434-444` compound this.
10. **Deployment lifecycle gaps.** Health check is the static home page (`render.yaml:7`), not a DB probe; server listens only after `initializeDatabase()` succeeds (`server.js:1735-1740`) and has no retry for Neon scale-to-zero cold starts. No SIGTERM/SIGINT handler or `pool.end()`, so in-flight work can be dropped on deploys. Connection pool has no `max`/timeout tuning.
11. **Audit rows can escape transactions.** Despite the prior audit's claim, shared `pool` is still passed to audit helpers at `server.js:730,750,919,1017,1027,1432,1460`; those rows can commit even when the main transaction rolls back.

### Low / informational

12. `NEON_REALTIME_SECRET` is read at `server.js:24` but not declared in `render.yaml`; the realtime endpoint returns 503 without it (`server.js:158`), while `README.md:11` advertises the feature (`render.yaml:8-20`).
13. Node version is unpinned (`render.yaml:1-6`, `package.json:14` says `>=20`) and `npm run build` is not part of the deploy command.
14. "Additive only" schema claims (`db/schema.sql:81-84,296-299`, `AUDIT_REPORT.md:39,62`) are inaccurate: `ALTER TABLE ... ADD COLUMN` at `:322,387` and four `ALTER COLUMN ... DROP NOT NULL` at `:430-439` modify existing tables. No migration versioning exists.
15. Missing uniqueness allows duplicate gotra members (`server.js:1646` uses `ON CONFLICT DO NOTHING` without a matching unique key on `(gotra_id, person_name)`) and duplicate published records (`db/schema.sql:59`).
16. Soft-delete is inconsistent: `DELETE /api/admin/people/:id` (`server.js:1370-1412`) archives only when relationships exist, otherwise hard-deletes. Living-person field filtering (`server.js:499-515`) still exposes `gender`, `deathYear`, village/district/state and alt names, and `/api/records` (`:124-154`) returns `family_details` without visibility filtering.
17. **Good news:** `npm audit --omit=dev` reports 0 vulnerabilities across 109 production packages; no credentials were found in git-tracked files or any commit; `.env.local` and `.neon` were never tracked and are gitignored; `npm run build` and `git diff --check` pass. `render.yaml:13-14` generates a random JWT secret. There are no tests or CI workflows; `scripts/build-check.js` only checks syntax of four JS files and existence of 13 paths.

## Detailed findings — backend security and correctness

### Critical

**C1 — Stored XSS in public search and admin review (`app.js`).** `app.js` has no `escapeHtml` helper: search results interpolate `record.name` at `:323`; the admin submission/family lists interpolate contributor names, contacts and unreviewed person names at `:586-619`; error messages are inserted at `:334,957`. `server.js:63` only trims/slices input, and `server.js:25` disables CSP. A malicious submission such as `<img src=x onerror=...>` executes in the admin's origin (allowing same-origin authenticated writes) and, once approved, on every public visitor's search page. Fix: escape every interpolated value or use DOM APIs, and enable a strict CSP (`script-src 'self'`, no inline scripts, `object-src 'none'`, `base-uri 'self'`).

### High

**H1 — Parent/child relationships are silently never created.** Five flows call `genealogy.validateRelationship(client._pool || pool, ...)` (`server.js:730,1017,1319,1659` and the gotra-member flow at `:280`). `client._pool` is not a real `pg` property, so this always uses the shared pool — a different connection that cannot see the just-created, uncommitted person. `lib/genealogy.js:336-342` then reports `person_not_found` and the caller skips the relationship while still returning success. Affected: admin create-person with parents, gotra member with parents, approve contribution with parents, CSV import parent pass, public tree link. Fix: pass the transaction `client` itself.

**H2 — Audit rows can commit outside the data transaction.** Same wrong-connection pattern for `logAudit` at `server.js:750` and other sites noted in the infrastructure section; an audit row can survive a rollback.

**H3 — Cycle detection misses root-child cycles.** `lib/genealogy.js:44` anchors on `WHERE child_id = $1` (parents of the child) instead of walking descendants of the proposed parent, so a cycle such as existing `A → B` plus new `B → A` passes validation (`:329-373`) and no DB constraint blocks it.

**H4 — Rate limiter memory/keying defects.** `server.js:30-47` never deletes expired `requestWindows` entries, and with no `trust proxy` all Render users share one IP. Login keys include the email, enabling targeted lockout, while cross-account spraying gets fresh buckets.

**H5 — Admin password reset on deploy.** See infrastructure finding 1 (`scripts/init-db.js:15`).

### Medium

**M1 — Conditional CSRF check.** `server.js:88-98` checks `Origin` only when the header exists and only in `auth()` routes; the derived fallback trusts `x-forwarded-proto`/`Host`. Logout (`:184`) and all public POSTs lack the check.

**M2 — No session invalidation or role enforcement.** Logout only clears the cookie (`server.js:184`); the 8-hour JWT remains valid if stolen, and the embedded `role` (`:179`) is never verified against the current admin record.

**M3 — Account enumeration and spraying.** `bcrypt.compare` is skipped for unknown emails (`server.js:178`), giving a timing oracle; per-email buckets allow unlimited attempts across accounts.

**M4 — Repo-root static disclosure.** See infrastructure finding 3.

**M5 — No `Cache-Control: no-store`** on `/api/admin/*` or the token-gated `/api/pariwar/:token` (`server.js:1542-1555`); sensitive JSON can be cached by browsers/proxies.

**M6 — CSP disabled** (`server.js:25`), amplifying the XSS above.

**M7 — Public/private boundary leaks.** `visibility='members'` has no member authentication (`server.js:500-515`) and deceased "members" get full birth/biography data; `/api/vanshawali/villages` (`:1112`) counts draft/pending public people, unlike the stats endpoint (`:1086`); `/api/genealogy/gotras/:id` (`:463`) exposes draft branch data; the person profile response (`:511-542`) leaks internal `id`, `status`, `visibility` despite the comment claiming otherwise; `calculateGeneration` (`lib/genealogy.js:242-260`) reveals depth through private/archived ancestors.

**M8 — CSV import weaknesses.** `lib/csv-parser.js:108-110` writes attacker-controlled header names onto a plain object (`__proto__`/`constructor` risk); `:252-285` follows only the father branch in cycle detection; preview inserts one row per parsed row with no cap (`server.js:1178`) and admin import endpoints are unthrottled → DB DoS.

**M9 — Locking/transaction ordering races.** `SELECT ... FOR UPDATE` runs before `BEGIN` in the tree-link flow (`server.js:1586-1596`) and in the import commit (`:1226-1245`), so the lock is released by autocommit; concurrent requests can duplicate people/imports. Biological-parent count (`lib/genealogy.js:362-369`) is read-then-write without a lock, allowing three biological parents.

**M10 — Incomplete audit trail.** Gotra create/link, family-record changes, submission review, contribution status changes and tree rejection (`server.js:311-425,969-1049,1709-1717`) do not call `logAudit`.

**M11 — Unvalidated enums/UUIDs/booleans** (`server.js:617-621,713-715,1422`) reach UUID/CHECK-constrained columns and produce unhandled 500s; the final error handler (`:1734`) also turns body-parser 400/413 into 500.

**M12 — Disabled DB TLS verification** (`server.js:22`, `scripts/init-db.js:9`).

### Low / verified-positive notes

- Realtime sealed query (`server.js:156-160`) is a fixed literal over published records — no user input, but no throttling.
- `/api/pariwar/create` (`:1493-1539`) and `/api/genealogy/contributions` (`:595-630`) are unthrottled public writes.
- `getFamilyTree` ignores its `depth` argument (`lib/genealogy.js:274,287-293`); `rebuildTreeProjection` is never called (`:394-434`); `calculateGeneration` uses `MAX(depth)` despite a "shortest path" comment.
- Non-existent branch update returns 200 (`server.js:1415-1434`); unknown API paths return HTML (`server.js:1731-1733`); public stats expose `pendingSubmissions` (`:1090,1099`); `mera-pariwar.js:79` interpolates notes into an input `value` (self-XSS).
- No JWT secret length/issuer/audience checks (`server.js:19-20,179`); startup re-applies the whole schema including `CREATE EXTENSION` (`:49-61`).
- **Verified safe:** no SQL injection (all user values parameterized; dynamic fragments use hardcoded whitelists), no path traversal, no NoSQL; cookie flags are correct (`httpOnly`, `sameSite: lax`, `secure` in production, 8 h aligned with JWT); bcrypt cost 12; login errors generic; all `/api/admin/*` routes gated; CORS uses a single explicit origin; no stack traces returned.

## Detailed findings — frontend UX, accessibility, SEO and performance

Static cross-check of every HTML page, all four JS modules and both stylesheets. Findings marked **[Verified]** are provable from source/CSS/route cross-checks; **[Browser]** items were confirmed in the local Chromium run.

### High

- **F1 — Stored XSS in every `innerHTML` render path [Verified].** API/DB values (names, villages, notes, biographies, relation labels, error messages) were interpolated without escaping in `app.js` (search results, tree, submissions, gotra management, suggestions, member forms), `public/js/vanshawali-explorer.js` (`:275-288`, `:415-416`, catch blocks) and one field in `public/js/mera-pariwar.js` (`:79`). With CSP disabled this was a direct account/admin compromise path. See fix status below.
- **F2 — Open redirect in admin login [Verified].** `admin-login.html:126-127` assigned the `?next` parameter directly to `window.location.href`; `//evil.com` or `https://evil.com` was accepted.
- **F3 — Four admin panels are inert [Verified].** The contributions (`#genealogy-contributions-list`), dashboard (`#dashboard-stats`, `#dashboard-recent-people`), import (`#import-file-input`, `#import-preview-btn`, `#import-commit-btn`) and branch-management (`#branch-form`, `#branch-list`) UIs exist in `admin.html:330-413`; the APIs exist server-side, but no JS calls them. `app.js:703-744` only toggles visibility.
- **F4 — Search "view tree" links are broken [Verified].** `app.js:324` links to `/vanshawali.html?id=…`, but the explorer only routes on `?gotra=` and `?person=` (`vanshawali-explorer.js:35-49`). `initTree()` (`app.js:519-547`) also targets a `#published-tree` selector that does not exist anywhere in the repo.

### Medium

- **F5 — Gold text/focus outline fails WCAG contrast [Verified by computation].** `--gold` `#c49a45` on ivory/white is 2.30:1 / 2.61:1 (needs 4.5:1 text, 3:1 UI). Used for chapter numbers, portal icons, flow labels and the global `:focus-visible` outline (`styles.css:318-326`, `pages.css:1`).
- **F6 — Accessibility structure/keyboard gaps [Verified / Browser].** Lighthouse `label-content-name-mismatch` on `a.brand` and `button.language-switch` (every page with the shared header); unlabeled `#genealogy-search-input`, `#token-input`, `#people-search-input`; `role="tablist"` without arrow-key/roving-tabindex handling; broken skip link on `404.html` (now fixed) and no `<main>` on `admin-login.html` (now fixed).
- **F7 — SEO metadata gaps [Verified].** Canonical is injected only at runtime (`i18n.js:150-157`), static hreflang URLs are relative, `og:url`/`og:image` are absent, no JSON-LD, and `sitemap.xml:3-5` still contains the placeholder "Replace https://www.kulkirti.in …" with stale `lastmod` dates.
- **F8 — Performance [Verified].** `styles.css` (64 KB) and `pages.css` (92 KB) are unminified and loaded on every page; a blocking Google Fonts stylesheet and blocking `i18n.js` are in `<head>` on most pages. Local trace was otherwise clean (one ~4.8 ms long task, no console errors).
- **F9 — Header overflow [Browser].** 13–14 px horizontal overflow at 992 px caused by `button.language-switch`; now addressed with a 721–1130 px header-spacing rule (needs re-test).
- **F10 — Broken homepage hero image [Browser].** `index.html` Unsplash photo ID returns 404; not changed in this fix session (external asset/licensing decision required).

### Low

- Dead `window._adminTabMap` reads (`app.js:1222-1227`); duplicate header-scroll/reveal/nav listeners (`app.js:222-234` vs `:1250-1256`, etc.); empty catch blocks; hardcoded Hindi in JS strings; inline `style` attributes in generated markup; `target="_blank"` without `rel="noopener noreferrer"` on `mera-pariwar.html:70`.
- All 31 frontend `fetch` calls map to real server routes — the gaps are *missing calls* (F3) and the query-parameter mismatch (F4), not missing endpoints.

## Fix status — 19 November 2026 session

All nine reported issues were implemented; no production database was contacted. `npm run build` (build-check), `node --check` on every changed JS file and `git diff --check` pass (only core.autocrlf notices).

| # | Reported issue | Change | Verification |
|---|---|---|---|
| 1 | XSS in `vanshawali-explorer.js` (`p.biography`, `p.fullName`) | Wrapped profile name, initial, meta, biography, tree node labels and all error messages in the existing `escapeHtml()`; encoded IDs in URLs; removed the inline `onclick` share handler in favour of a same-origin event listener. Also added `escapeHtml()` to `app.js` and escaped every API-derived `innerHTML` interpolation there and in `mera-pariwar.js`. | `node --check` passes on all four JS modules; no `onclick=` or `javascript:` remains in HTML/JS. Browser test injected `<img src=x onerror=alert(1)>` as a fake tree label and confirmed it renders as escaped text. Full persisted-payload flows still need seeded data. |
| 2 | Unbounded admin queries | `GET /api/admin/submissions` and `GET /api/admin/contributions` now use `LIMIT`/`OFFSET` (default 100, max 200) plus a `COUNT(*)` for pagination metadata. | Source review; SQL syntax checked by `node --check` only (no DB). |
| 3 | CSP disabled | Replaced `helmet({ contentSecurityPolicy: false })` with a restrictive policy: `default-src 'self'`, `script-src 'self'`, `script-src-attr 'none'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`; fonts/images allow the existing Google/Unsplash origins; `connect-src` includes Neon Realtime only when configured. Externalized the only inline script (`admin-login.html` → `public/js/admin-login.js`) and replaced `javascript:history.back()` with a button listener. COEP disabled so third-party fonts/images still load. | Header not yet captured from a running production server — see "Remaining verification". |
| 4 | No rate limits on two public POSTs | `POST /api/genealogy/contributions` (20/15 min) and `POST /api/pariwar/create` (10/15 min) use the existing limiter. Also added `app.set("trust proxy", 1)`, a 60-second sweep that deletes expired buckets, and `windowMs` stored per bucket. | Source review. |
| 5 | Public gotra page calls admin-only endpoint | `/api/genealogy/gotras/:id` now returns a public-safe `members` array (verified-public people only, same fields as the public gotra API); the explorer uses that array and no longer fetches `/api/admin/gotras/:id/members`. | Source review. |
| 6 | `genealogy_tree_projection` never populated | `rebuildTreeProjection()` runs at startup and after every genealogy mutation (gotra member, person create, relationship add/remove, contribution approval, import commit, tree link). `calculateGeneration()` now reads the projection first and falls back to the recursive CTE. Added a depth guard in the rebuild CTE to prevent infinite recursion on cyclic legacy data. | Source review; no DB run. |
| 7 | Missing compound indexes | Added `person_relationships (parent_id, status)` and `people (status, visibility)` to `db/schema.sql`. | Source review. |
| 8 | Nav overflow at ~900 px | Added a 721–1130 px media query that tightens header gaps and font sizes, hides the brand tagline and shrinks the language switch. | Re-measured in a 992 px-wide iframe: `scrollWidth` 984 = `clientWidth` 984, zero offending elements (was 1006 vs 992). |
| 9 | Complete audit | This report, including the frontend section above. | — |

Additional fixes made in the same session (not in the original nine): the admin-login `?next` open redirect is now restricted to same-origin paths; `admin-login.html` and `404.html` gained `<main id="main-content">`; `client._pool || pool` was replaced with the transaction `client` at all three remaining sites so parent links and audit rows stay inside their transactions.

### Remaining verification / still-open items

- **CSP header:** mirrored the production directive set on a local static server and loaded `index.html`, `admin-login.html` and `vanshawali.html?person=test` — zero CSP violations and zero console errors. The externalized login script was exercised end-to-end (form submit → visible network error). Production headers should still be confirmed from the deployed origin.
- **A11y re-check:** `404.html` accessibility rose from 0.96 to **1.0** after adding `<main id="main-content">`; `admin-login.html` rose from 0.97 to **1.0** (SEO remains 0.75 — no meta description/canonical).
- **Not re-tested live:** pagination SQL, rate-limit 429 responses, projection refresh and XSS payload rejection — all require a configured `DATABASE_URL`/`JWT_SECRET` and seeded data.
- **Still open from the full audit:** admin password overwrite in `scripts/init-db.js` (critical); whole repo-root served statically; broken CSV `people.city`; disabled DB TLS verification; conditional CSRF and missing session invalidation; broken cycle detection; lock-ordering races; placeholder sitemap and broken Unsplash hero; inert admin panels; search→tree `?id=` mismatch; low-contrast gold. These are documented above but were outside the nine requested fixes.

## Verification commands run

```
npm run build
node --check app.js server.js lib/genealogy.js public/js/vanshawali-explorer.js \
              public/js/mera-pariwar.js public/js/admin-login.js
git diff --check
```

---

## Follow-up cross-check — frontend ↔ login ↔ user data-entry flow

This section records the second pass requested after the fixes above: can a large, unordered set of user-entered values be arranged, verified and linked into the correct place in the genealogy? It was a static trace plus local static-server browser checks; **no production/live database was contacted**.

### What the trace found

| Sev | Finding | Evidence |
|---|---|---|
| Critical | Only the Mera Pariwar → "Link" path ever created real `people` / `person_relationships` rows. Approving a public submission only wrote an opaque JSON blob to `published_records`, so approved data stayed invisible in the tree/profile APIs. | `POST /api/admin/submissions/:id` only `UPDATE`/`INSERT published_records`. |
| Critical | Parent links were silently dropped in every creation flow: `validateRelationship()` ran on the shared `pool` instead of the transaction `client`, so the just-created uncommitted child was not visible and `person_not_found` was returned and ignored. Affected gotra-member add, contribution approval, CSV import mother, admin person mother, and both Mera Pariwar parent passes. | `server.js` validation call sites using `pool`; `lib/genealogy.js:348-354`. |
| Critical | The genealogy-contribution form had no submit handler, and the admin contributions panel had no loader/renderer/action — a completely dead-end pipeline. | `#genealogy-contribution-form` and `#genealogy-contributions-list` appeared only in HTML. |
| High | Mera Pariwar linking discarded `birthYear`, `deathYear`, `gender` and `relation`; forced `is_root=false`; made branch placement impossible; auto-created gotras were `draft` with no promote route, so linked people stayed hidden from public listings. | `POST /api/admin/pariwar/:id/link`. |
| High | Unnamed/temporary members (often referenced as a parent) were silently filtered out at create and link time; dangling parent IDs were silently ignored. No cross-submission identity or dedupe. | `validateSubmission()` and `POST /api/pariwar/create` filters. |
| High | Admin gate and source disclosure: `/%61dmin.html` bypassed the `/admin.html` JWT guard because Express matches routes on the raw path while static serves the decoded path; `express.static(root)` exposed `server.js`, `package.json`, `db/schema.sql`, scripts and reports. | `server.js` gate and `express.static(root)`. |
| Medium | Admin submissions review had only approve/reject; people, branches, import and dashboard panels were inert; submission pages had no pager; pariwar review showed `clientId` values instead of resolved parent names. | `app.js`, `admin.html`, `public/js/admin-pariwar.js`. |
| Medium | Logout only cleared the cookie (8 h JWT still replayable); login/logout had no Origin check; `role` claim never enforced. | `POST /api/admin/login` and `/api/admin/logout`. |
| Low | Cycle detection ignored `parentId`, so two-node cycles passed; CSV import inserted a non-existent `people.city`; unvalidated strings reached UUID columns; `mera-pariwar.js` inserted `clientId` into an attribute without escaping. | `lib/genealogy.js:34-59`, `server.js`, `mera-pariwar.js`. |

### Fixes implemented in this pass

1. **Submission → genealogy link endpoint** (`POST /api/admin/submissions/:id/link`). Admin chooses gotra/branch, may correct every field, reuse an existing person by ID, and anchor parents to existing people. A two-pass `clientId → people.id` map makes entry order irrelevant. `linked_at` on `submissions` makes re-linking idempotent (409 on duplicate). Every skipped member/link is returned to the admin as a `skipped[]` reason list — never silent.
2. **All relationship validation now uses the transaction client** at every remaining call site, so newly created people are visible to validation and parent links actually persist.
3. **Mera Pariwar link upgraded**: admin may correct each member, preserve `birthYear`/`deathYear`/`gender`/`relation`/`notes`, choose gotra and branch, reuse existing people, anchor parents outside the submitted tree, and publish a draft gotra with a "गोत्र सत्यापित करें" button (new `PATCH /api/admin/gotras/:id`). `GET /api/admin/pariwar` is now paginated.
4. **Inert admin panels wired** in new `public/js/admin-workflow.js`: contributions review with status/review notes, people search + pagination + inline edit + branch assignment, CSV import preview → review → commit, branch management, and dashboard. Loaded on tab activation. Submission and pariwar lists now paginate. The submission link panel caches each rendered page by ID, so verifying a submission on a later page does not re-fetch only the first page and fail to find it. Branch pickers in both link UIs now submit a real branch UUID (non-UUID free text was silently ignored by the server).
5. **Genealogy contribution form wired** in `app.js` — submissions land in the admin review queue.
6. **Admin gate hardened**: decoded/normalized path check closes the `/%61dmin.html` bypass; static serving restricted to an explicit public-file allowlist plus `/public` and `/locales`, so `server.js`, schema, scripts and reports are no longer downloadable.
7. **Session hardening**: login tokens now carry a `jti`; logout adds it to a revocation set checked by `auth()` and the page gate; shared `originGuard` applied to login, logout and all authenticated routes.
8. **Data integrity fixes**: cycle detection now walks descendants of the proposed parent and checks for the parent node; unreferenced unnamed rows are still dropped but *referenced* blank names are kept under an `अज्ञात सदस्य N` placeholder so the parent graph survives review; UUID validation added for all admin-supplied IDs; CSV `people.city` removed; `mera-pariwar.js` escapes `clientId` in markup.
9. **`scripts/build-check.js` extended** to syntax-check every JS module, not just four files.

### Verification for this pass

- `npm run build`, `node --check` on all changed JS, and `git diff --check` pass (only the known `core.autocrlf` notices).
- Local CSP-mirroring static server: `admin.html` loaded all four scripts (`i18n.js`, `app.js`, `admin-pariwar.js`, `admin-workflow.js`) with **zero CSP violations and zero JS runtime errors**; all nine tabs present; every wired panel ID exists; no horizontal overflow at 992 px. Clicking through contributions, people, dashboard, import, branch and pariwar tabs produced no exceptions.
- `submit.html` genealogy contribution form: submit event dispatched, handler fired, POST attempted and a visible error surfaced (expected against the static server with no API).
- **Not exercised**: end-to-end approval/linking and pagination SQL against a seeded database. The configured `DATABASE_URL` points to a live Neon endpoint, which this audit deliberately did not contact. These flows remain statically verified only.

---

## Gotra-first Vanshawali system — implementation status

This section records the third pass: a complete Gotra → Family Tree → Root Ancestor → sons/daughters → generations workflow added to the **existing** Express/Postgres app. No new app, no stack change, no production DB contact.

### Built

| Area | Change |
|---|---|
| Schema (`db/schema.sql`) | Additive only: `gotras.normalized_name/description/is_active`; `family_trees` (reference, edit token, revision JSON, status, notes); `tree_links`; `verification_records`; `people.family_tree_id/wife_name/member_type/birth_order`; supporting indexes. |
| Rules (`lib/vanshawali.js`) | Pure, unit-tested helpers: normalized Gotra names, unordered-member graph validation, exactly one root, daughter is a name-only terminal box, no depth limit, cycle/unreachable checks. |
| API (`lib/vanshawali-routes.js`, registered from `server.js`) | Draft create/save/submit/status by token; public verified-tree list + visual; unified public search (Gotra/person/root/village/reference, path + descendants + deep links); admin Gotra CRUD with deactivation; verification queue/stats/decision; non-destructive link + reverse; verification history, audit and person search. All decisions and link changes are audited; approval materializes real `people`/`person_relationships` in one transaction. |
| RBAC | New `requireRole()` in `server.js`. Existing admins default to `super_admin` so nothing breaks; Gotra management, linking/reversal and audit-read require `super_admin` explicitly. Enforced server-side, not by hiding buttons. |
| Public UI | `vanshawali-create.html` + `public/js/vanshawali-editor.js`: Gotra picker (active Gotras only), token dashboard, recursive box editor, edit/delete-with-confirmation, draft save, preview with SVG connectors/zoom/fit/expand/collapse, submit. Linked from the home portal. |
| Admin UI | New "वंशावली प्रबंधन" tab in `admin.html` + `public/js/admin-vanshawali.js`: stats, Gotra management, searchable/filterable/paginated verification queue, full tree review, approve/reject/correction/under-review with notes, master-tree link comparison, link/verification/audit history. |
| Explorer & search | `vanshawali.html` + `vanshawali-explorer.js` gained a `?tree=` verified-tree view and a real handler for the previously orphaned `?id=`/`?record=` deep link; `search.html` + `app.js` gained person/tree tabs with wife, village, Gotra, tree reference, ancestry path, descendant count and tree deep links. Matching i18n keys added to both locale files. |
| Tests | `test/vanshawali.test.js` (9 `node:test` cases) and `npm test`; `scripts/build-check.js` now also parses both locale JSON files. |

### Verification for this pass

- `node --check` on `server.js`, both new lib modules and both new browser modules; `npm run build` and `git diff --check` pass.
- `npm test`: 9/9 pass — valid/invalid tree shape, unordered entry, daughter terminal rule, required spouse/village, cycles, duplicate IDs and 40 generations (no artificial cap).
- Local mock-server browser run of `vanshawali-create.html`: Gotra loaded and selected, draft created with a stable token, root/son/daughter/grandson boxes filled and saved, daughter exposed no child controls, 4 preview nodes with 3 connectors, zoom changed the transform, preview→editor round-trip worked, submission persisted and disabled further editing. Zero CSP violations and zero console errors; no horizontal overflow.
- Admin verification panel and search-tab wiring were checked statically and via DOM IDs; no production/live database was contacted.

### Still requires a seeded, safe database

Actual SQL execution of the additive schema, transactional approval/link/reverse flows, RBAC 403 responses, rate-limit 429s, and persisted XSS payloads cannot be verified without a local seeded `DATABASE_URL`. `.env.local` points to the live Neon endpoint, so these were deliberately left to an explicit, permissioned test run.

