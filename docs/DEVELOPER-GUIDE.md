# Developer guide

How the Sheetal Property platform is built, how a request moves through it, and how to change it safely.
Read [START-HERE.md](../START-HERE.md) first to get it running.

Owner: DhamiPlus Pvt. Ltd. Proprietary code — see [LICENSE](../LICENSE).

---

## 1. The big picture

```
 Browser
   │  http://localhost:5173          (/ website · /business panel · /admin panel; one Vite dev server proxies the panels)
   ▼
 website/frontend   business/frontend   admin/frontend        React + Vite, share code from shared/src
   │                   │                   │
   │ /v1 (JSON)        │ /v1 + x-tenant-id │ /v1
   │                   │   + x-branch      │
   ▼                   ▼                   ▼
 website/backend    business/backend    admin/backend         Fastify + TypeScript, built on backend-core
 :4000              :4001               :4002
   └───────────────────┼───────────────────┘
                       ▼
              backend-core (shared)  ──►  PostgreSQL (Prisma)     one database for everything
                       │
                       ▼
                  mail-server  (SMTP)      business email in/out, system emails from the outbox
```

- **One database, three APIs.** Each API only exposes what its users need: the website API is public, the business API
  needs a business member, the admin API needs Sheetal staff. All three use `backend-core` for the database, security,
  errors, payments, email and the business rules.
- **Front-ends have two modes.** Signed in, they call the APIs ("live"). Not signed in, they show a sample workspace
  from `shared/src/demo` so the product can be shown without data. In code: `isLive(tenant.id)` in the business panel,
  `isStaffLive()` in admin.

## 2. Folders

| Folder | What lives there |
|---|---|
| `backend-core/prisma/schema.prisma` | The whole database: every table, with a comment on what each field means. |
| `backend-core/prisma/migrations/` | One folder per database change, applied in order. Never edit an applied one. |
| `backend-core/src/app.ts` | Builds a Fastify app with the shared pieces (security headers, CORS, rate limits, errors, health). |
| `backend-core/src/config.ts` | Reads and checks settings from `.env`. Add new settings here. |
| `backend-core/src/domain/` | Business rules with no HTTP: plans, permissions, billing, money (VAT, service charge), branches, night prices, calendar sync. |
| `backend-core/src/lib/` | Tools: database, cache, errors, private files, photos, payments, email outbox, notifications, encryption (vault), AI. |
| `backend-core/src/modules/` | Shared routes: accounts and sign-in, the notification bell. |
| `website/backend/src/modules/` | Public API: catalog and search, enquiries and reviews, posting, requirement board, blog and careers, visitor tracking. |
| `business/backend/src/modules/` | Business API, one folder per area: listings, leads, team, branches, billing, hotel, POS, projects, growth (AI, analytics, channels), mail, reviews, verification. `access.ts` decides who may do what. |
| `admin/backend/src/modules/` | Admin API: businesses, plans, staff, listing review, content, billing, system status, verification. |
| `mail-server/src/` | `inbound.ts` receives mail, `outbound.ts` sends business mail, `system.ts` sends system emails. |
| `shared/src/core/` | Front-end basics: store, router, UI kit, icons, formatting, permissions (`rbac`), themes, brand colours. |
| `shared/src/layout/Shell.jsx` | The panel frame: sidebar, top bar, switchers, notification bell, Preview tags. |
| `shared/src/styles/` | `theme.css` (colours, light/dark/red) and `platform.css` (panel components). |
| `*/frontend/src/pages/` | Screens. Files starting with `Live` talk to the API; the others are sample screens (marked Preview when signed in). |
| `scripts/` | Project commands: help, doctor, backup, restore, build helpers. |

## 3. How a business request works

Example: a front-desk person opens **Bookings** in the business panel.

1. **Front-end** — `business/frontend/src/api.js` sends `GET /v1/bookings` with three headers:
   `Authorization: Bearer <token>` (who), `x-tenant-id` (which business), `x-branch` (which branch, or `all`).
2. **Sign-in** — `backend-core/src/modules/auth/sessions.ts` turns the token into a user with their memberships.
3. **Business and role** — `workspaceOf(request)` in `business/backend/src/modules/access.ts` checks the person is an
   active member of that business and gives `ws.can("bookings.view")` for their role.
4. **Branch** — `branchView(db, request, ws)` works out which branches they may see; `inView(view)` is added to every
   query, and `branchFor(view)` picks the branch for anything new. Staff limited to one branch can never read another.
5. **Rule and data** — the route checks input with **zod**, applies the rule (e.g. no double booking), reads or writes
   with **Prisma**, and returns `{ data, message }`.
6. **Errors** — throw `badRequest`, `forbidden`, `notFound`, `conflict` or `AppError` from `backend-core/src/lib/errors.ts`.
   Every error reaches the user in one format: `{ status, message, errors? }`. Invalid input is 422 with field errors.

The website API skips steps 3–4 (public). The admin API replaces them with `staffOf(request, "permission")`.

## 4. Permissions and plans

- **Business roles** are lists of permission ids, defined per business type in `backend-core/src/domain/permissions.ts`
  (owner has `*`). Check with `ws.can("…")` on the server and `can(role, "…")` in the front-end.
- **Staff roles** (super admin, operations, finance, content editor, support) are `PLATFORM_ROLES` in the same file.
- **Plans** (Starter, Business, Pro per business type) are in `backend-core/src/domain/plans.ts` and the `plans` table.
  Limits (listings, seats, rooms) and features (POS, own branding, all kinds) are checked on the server.
  A Pro business can cover the owner's other businesses (`coveredById`).

## 5. Things the platform does for you

| Need | Use |
|---|---|
| Tell people in the app | `notify(db, userIds, { tenantId, type, title, message, link })`; people at a branch: `teamWith(db, tenantId, perms, branchId)`; Sheetal staff: `notifyStaff(db, perm, note)` |
| Send an email | `app.mailer.send({ to, subject, text })` — saved to the outbox; the mail server sends it (locally: saved as a file, visible in Admin → System status) |
| Store a private file (proof, CV, document) | `savePrivateFile(MEDIA_DIR, kind, buffer)` / `readPrivateFile(...)` — checked by its bytes, never public |
| Store a photo | `savePhoto(...)` and `photoUrl(...)` in `lib/photos.ts` |
| Keep a secret (API key, token) | `new Vault(SECRETS_KEY).seal(value)` / `.open(...)`; never return secrets to the browser |
| Write to the activity log | `db.auditLog.create({ data: { actorId, tenantId, action, target, ip } })` |
| Cache a public list | `cached(app.cache, key, seconds, loader)` |

## 6. Adding a feature (checklist)

**A database change**

1. Edit `backend-core/prisma/schema.prisma` (comment every new field).
2. Stop the APIs (they lock the Prisma engine on Windows), then from `backend-core`:
   ```bash
   mkdir prisma/migrations/<YYYYMMDDHHMMSS>_<short_name>
   npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<that folder>/migration.sql
   npx prisma migrate deploy
   npx prisma generate
   ```
3. If existing rows need values, add the `UPDATE` statements to that `migration.sql` before deploying.

**An API endpoint**

1. Add the route in the right module (or a new module registered in that API's `src/app.ts`).
2. Start with `workspaceOf` / `staffOf`, check the permission, parse input with zod, scope queries by tenant and branch.
3. Add tests in that API's `test/` folder covering: allowed, refused (wrong role, other business, other branch), and
   bad input.

**A screen**

1. Put live screens in `pages/Live*.jsx` (or a clearly named file) and call the API with `bizApi` / `adminApi`.
2. Route it in `BusinessApp.jsx` / `AdminApp.jsx` with the permission guard.
3. If it replaces a sample screen, remove its path from the `PREVIEW` list in the same file.

## 7. Tests

- Run everything: `npm test`. One part: `npx vitest run` inside that folder (e.g. `business/backend`).
- Server tests start a real, temporary PostgreSQL (`backend-core/test/setup-db.ts`) and build the API with
  `buildApp(...)`; requests go through `app.inject(...)`. Your local data is never touched.
- Typical setup: `createWorkspace(...)` for a business, `createSession(...)` for a signed-in person, then a small
  `call(who, method, url, body)` helper.
- Every bug fix gets a test that would have caught it.

## 8. Code rules

- **Readable first.** Clear names over clever code. Small functions. No dead code (lint fails on unused variables).
- **Server is the source of truth.** Never trust the browser for prices, permissions, plan limits or branch access.
- **Secrets** live in `.env` (never committed) or the encrypted vault. Never log or return them.
- **Personal data** (phones, emails, ID documents) only to people who need it; private files stay private.
- **Every change ships with tests** and passes `npm run check`.
- **Commit messages**: first line says what changed (under 72 characters); then why, in plain words.

### Comment style

Every source file starts with a short header that tells a new developer what the file is for:

```ts
// <What this file is, in one line>.
// Where it fits: <who calls it / which screen or API uses it>.
// How it works: <the main idea in one or two lines>.
// Rules: <anything that must stay true, e.g. "staff only see their own branches">.
```

Inside the code, comment **why**, not what: business rules, edge cases, and anything a reviewer, tester or bug-fixer
would otherwise have to guess. Keep comments short and current: when you change code, update its comment.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| "Port … is already in use" | An old copy is running. Close all terminals (or restart) and start again. `npm run doctor` shows what is running. |
| `EPERM … query_engine-windows.dll.node` on `prisma generate` | The APIs are running and lock Prisma. Stop `npm run dev:api` and `npm run dev:mail`, generate, start them again. |
| Business panel shows sample data while signed in | Check `business/frontend/.env.local` has `VITE_BUSINESS_API_URL`, and the business API is running. |
| "Pick a branch first" | With **All branches** picked, new work needs a branch: choose one at the top, or in the form. |
| 402 from the API | The business's plan doesn't include that feature or is at its limit. |
| Emails don't arrive locally | They are saved, not sent: see `mail-server/mail-outbox` or Admin → System status → System emails. |
| Something looks wrong after pulling | `npm install`, then `npm run db:migrate`, then restart the APIs. |

## 10. Background jobs

| Job | Where | How often |
|---|---|---|
| Plan renewals (reminders, past due, back to Starter) | admin API (`modules/billing.ts`) | every 6 hours |
| Calendar sync with Booking.com / Airbnb | admin API (`modules/insight.ts`) | every 2 hours |
| Business mail delivery and system emails | mail server | every 10 seconds |

---

© 2026 DhamiPlus Pvt. Ltd. All rights reserved.
