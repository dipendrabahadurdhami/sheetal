# Hosting guide: putting Sheetal Property on the internet

For the person who sets up the server (a developer or a hosting technician). The owner's part (domain, accounts, money) is marked **Owner**.
Read [LAUNCH-CHECK.md](LAUNCH-CHECK.md) first: it lists what is still open. Admin panel setup after hosting is in [SETUP-GUIDE.md](SETUP-GUIDE.md).

**Honest note:** this has not been done yet. The steps follow how the code is built (commands and setting names are the real ones), but
nobody has run them on a real server. Expect small fixes on the first try. Do it on a test address first.

## 1. What runs where

| Part | What it is | Runs as | Port |
|---|---|---|---|
| Website, business panel, admin panel | static files (HTML, JS, CSS) in one folder `dist/`; the panels are under `/business` and `/admin` | served by the web server (Nginx or Caddy) | 443 |
| Website API | Node program | `node dist/server.js` in `website/backend` | 4000 |
| Business API | Node program (also runs the event dispatcher and business jobs) | `node dist/server.js` in `business/backend` | 4001 |
| Admin API | Node program (also runs the billing, subscription and listing-limit jobs: **run only one copy**) | `node dist/server.js` in `admin/backend` | 4002 |
| Mail server | Node program, receives and sends email | `node dist/server.js` in `mail-server` | 25 |
| Database | PostgreSQL 16 | the server's own PostgreSQL (not the embedded one used on the owner's PC) | 5432, local only |
| Cache | Redis (optional but wanted online) | the server's Redis | local only |
| Photos | a folder (`MEDIA_DIR`), or object storage (S3 / Cloudflare R2) | disk or bucket | - |

One server (a VPS with 4 GB memory or more, Ubuntu LTS) can hold all of it to start.

## 2. Before you start (Owner)

1. A VPS from a hosting company. **Ask them to unblock outgoing port 25** (needed for email; most block it).
2. The domain `sheetalproperty.com` with access to its DNS (Cloudflare is expected: the admin panel can manage business domains through it).
3. The code: the private GitHub repository `dipendrabahadurdhami/sheetal`.
4. A place for backups outside the server (a second disk, or a bucket).

## 3. Server setup (developer)

1. Install **Node.js 22**, **PostgreSQL 16**, **Redis**, **Nginx** (or Caddy), **git**.
2. Create the database and a user with a strong password. Encoding UTF-8 (listings hold Nepali text).
3. Clone the repository, then in its folder: `npm ci`.
4. Make `backend-core/.env` from `backend-core/.env.example`:

| Setting | Value online |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` | `127.0.0.1` (the web server stands in front) |
| `DATABASE_URL` | the PostgreSQL address of step 2 |
| `REDIS_URL` | the Redis address |
| `SITE_URL` | `https://sheetalproperty.com` |
| `API_URL` | the public address of the website API, for example `https://api.sheetalproperty.com` |
| `CORS_ORIGINS` | the website address(es), comma separated |
| `SECRETS_KEY` | **new, at least 32 characters, required.** Make it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Keep a copy in a safe place: without it the saved keys (eSewa, AI, DKIM) can't be read |
| `MEDIA_DIR` | the photos folder; or the `S3_*` settings and `MEDIA_URL` for a bucket |
| `MAIL_HOST`, `MAIL_INBOUND_SECRET` | the mail server's host name and a new random secret (see `docs/mail-server.md`) |

5. Front-end settings before building (files next to each front-end; `.env.production` or `.env.local`):
   - `website/frontend`: `VITE_API_URL=https://api.sheetalproperty.com/v1`, **`VITE_API_LIVE=*`**, `VITE_SITE_URL=https://sheetalproperty.com`.
     Without `VITE_API_LIVE=*` (or the full list) some pages silently show sample data.
   - `business/frontend`: `VITE_BUSINESS_API_URL` = the business API's public address. The admin panel: check `admin/frontend/src/api` for its address setting.
6. Database tables: in `backend-core` run `npx prisma migrate deploy`, then `npx prisma generate`.
7. First data: `npm run db:seed` (the plans, the super admin and the Sheetal Property business). **Do not run `npm run accounts:test`** online.
   To bring the real data from the owner's PC instead: `npm run backup` there, copy the folder, `npm run restore -- <name> --yes` here, then
   remove the test accounts (every `…@sheetal.test` user and business) before opening the site.
8. Build: `npm run build` (website and both panels into `dist/`), then `npm run build` inside `website/backend`, `business/backend`,
   `admin/backend` and `mail-server` (each makes `dist/server.js`).
9. Run the four Node programs as services that restart by themselves (systemd units or pm2). The admin API: one copy only.
10. Web server: serve `dist/` for `sheetalproperty.com` with a fallback to `index.html` (and to `/business/index.html`, `/admin/index.html`
    under those paths); pass the API addresses to ports 4000, 4001 and 4002; HTTPS certificates (Let's Encrypt, or Cloudflare in front).
11. Check: each API answers at `/health`; `https://sheetalproperty.com/pricing` shows the real apps and prices; sign in as the super admin.

## 4. Email (developer + Owner for DNS)

Follow `docs/mail-server.md` exactly: port 25 open both ways, DNS records (MX, SPF, DKIM, DMARC), a TLS certificate, the settings file,
then the test to a Gmail address (SPF, DKIM and DMARC must all say PASS). Until this passes, nobody can confirm a sign-up or reset a password.

## 5. Backups (developer)

1. A daily job: `npm run backup` (the database, and new photos). Set `BACKUP_DIR` and `PHOTOS_BACKUP_DIR` to a place **off** the server.
2. Once, on a spare database: `npm run restore -- <name> --yes` and check the site works on it. A backup that was never restored is not a backup.

## 6. After it is online (Owner, in the admin panel)

Follow [SETUP-GUIDE.md](SETUP-GUIDE.md) in its order: company details, prices, eSewa (test, then live), Cloudflare, Google, then WhatsApp and
AI when wanted. Then the hand test on a phone: sign up, post a property, start a business free, install an app, pay with the eSewa test merchant.

## 7. Updating later

`git pull`, `npm ci`, `npx prisma migrate deploy` and `npx prisma generate` in `backend-core` (stop the APIs first), build again, restart the
services. Take a backup before every update that has a migration.

## 8. Still to do before real customers (see LAUNCH-CHECK.md)

- **Code:** the main free limits are enforced since 17 Nov. A few smaller ones are not yet (People staff records, open investments,
  number of projects, POS outlets, CRM pipelines, receipt storage, team seats).
- A security review (sign-in, permissions, uploads, rate limits), a load test, error monitoring with alerts.
- Nepali texts for the newer screens; the legal pages (sale terms, refund policy, privacy).
- GitHub Actions is switched off (billing): the automatic checks do not run on changes.
