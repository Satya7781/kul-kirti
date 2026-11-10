# Kul-Kirti

Gehlot Rajput Kul-Kirti is a historical and genealogical archive with:

- Separate public pages for history, search, Vanshawali, Samiti information, and record submission
- Neon PostgreSQL persistence
- User-submitted family records held for review
- Admin authentication with hashed passwords and HTTP-only cookies
- Admin approval before records become publicly searchable
- UUID-based family-member and parent relationships
- Neon Realtime sealed-query support

## Local development

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env.local`.
3. Configure `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
4. Initialize the database:

   ```powershell
   npm install
   npm run db:init
   ```

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
- `/samiti.html` — Samiti directory
- `/submit.html` — user family-record submission
- `/admin.html` — protected admin review

## Render deployment

This repository includes `render.yaml`.

- Build command: `npm ci && npm run db:init`
- Start command: `npm start`
- Health check: `/`

Set these Render environment variables:

```text
DATABASE_URL=<Neon pooled PostgreSQL connection string>
ADMIN_EMAIL=<production admin email>
ADMIN_PASSWORD=<new strong production password>
JWT_SECRET=<long random secret>
FRONTEND_ORIGIN=https://<your-render-service>.onrender.com
NODE_ENV=production
```

Never commit `.env.local` or production credentials.

## Verification

```powershell
npm run build
npm audit --omit=dev
```

Historical and genealogical records should be published only after evidence review and explicit admin verification.
