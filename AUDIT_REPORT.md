# Kul-Kirti audit report

Date: 2026-11-12

## Architecture verified

- Static HTML/CSS/JavaScript frontend served by Express.
- Node.js 20+ backend in `server.js`.
- PostgreSQL/Neon accessed through `pg`; schema is additive and stored in `db/schema.sql`.
- JWT-backed admin authentication in an HTTP-only cookie.
- Genealogy data is split between the original submission/published-record tables and the additive Vanshawali tables.
- Render deployment is configured by `render.yaml`.

## Findings and status

| Severity | Area | Finding | Root cause | Status |
|---|---|---|---|---|
| High | Privacy | Public tree endpoints could include people and relationships outside the public visibility boundary. | The tree endpoint checked status but not visibility; related-person queries did not filter public records. | Fixed and syntax/build tested. |
| High | Privacy | Public dashboard statistics and branch counts included non-public or non-verified people. | Queries used `status <> 'archived'` rather than the public publication rules. | Fixed and syntax/build tested. |
| High | Security | Authenticated state-changing requests had no explicit origin check. | Cookie authentication relied primarily on SameSite behavior. | Fixed; cross-site origins are rejected when an Origin header is present. |
| High | Security | Login and public submission endpoints had no abuse throttling. | No request-window limiter existed. | Fixed with bounded in-memory rate limits. |
| High | Security | Several UI renderers inserted contributor/database values through `innerHTML` without escaping. | Template rendering treated returned values as trusted HTML. | Fixed in the public explorer, family-tree lookup, and admin family-tree review UI. |
| Medium | Integrity | Administrative audit entries made through a pool connection could commit independently of the data transaction. | Audit helper calls used `pool` while the mutation used a checked-out transaction client. | Fixed for transactional genealogy/person/relationship/import/tree flows. |
| Medium | Deployment | Every server restart re-hashed and overwrote the configured admin password. | Startup used `ON CONFLICT DO UPDATE`. | Fixed: initialization creates the configured account only when it does not exist. |
| Medium | Testing | There is no automated API/browser test suite in the repository. | Validation is limited to a custom build check and JavaScript syntax checks. | Not fixed; added/maintained build validation is recommended next. |
| Low | Operations | The rate limiter is process-local and resets on restart or across multiple Render instances. | No shared cache/rate-limit service is configured. | Partially fixed; use a shared store if the service is horizontally scaled. |

## Files changed

- `server.js`
- `lib/genealogy.js`
- `public/js/vanshawali-explorer.js`
- `public/js/mera-pariwar.js`
- `public/js/admin-pariwar.js`
- `AUDIT_REPORT.md`

## Database changes

No schema or data migration was added. Existing additive tables and data are preserved.

## Verification performed

- `npm run build` — passed.
- `node --check server.js` — passed.
- `node --check lib/genealogy.js` — passed.
- `node --check public/js/vanshawali-explorer.js` — passed.
- `node --check public/js/mera-pariwar.js` — passed.
- `node --check public/js/admin-pariwar.js` — passed.
- `git diff --check` — passed.

## Not verified locally

- Live Render/Neon connectivity and production logs, because this checkout does not provide a safe production test database workflow.
- Authenticated API journeys, because they require a running database and admin credentials.
- Browser responsive layout, keyboard navigation, and console output, because no browser test suite is configured.
- Historical source accuracy or image licensing; no new historical claims or images were introduced.

## Deployment notes

1. Deploy the current commit through the existing Render service.
2. Keep `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `FRONTEND_ORIGIN` configured.
3. `npm run db:init` remains additive and safe for existing tables.
4. Because startup no longer overwrites an existing admin password, change an existing production password through an explicit administrative/password-rotation procedure rather than by restarting the service.
5. After deployment, exercise public search/tree routes and the admin review flow against the production service, then inspect Render logs for database or CSP-related errors.
