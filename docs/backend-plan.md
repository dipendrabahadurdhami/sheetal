# Sheetal backend plan (draft for discussion)

Status: **draft, nothing built yet.** Edit freely; we will lock this before Phase 0 starts.

## 1. What exists today

| App | Purpose | Data source today |
|---|---|---|
| `website/frontend` | Public real-estate marketplace (listings, search, map, agents, reviews, requirements, blog, careers, user accounts, posting, AI ask, lead extractor) | ~60 REST calls in `src/api/endpoints.js`, answered by `src/demo/api/router.js` |
| `business/frontend` | Workspace per business: hotel, host, developer, agency, sponsor (listings, bookings, POS, invoices, agreements, team/roles, OTA, inbox, AI) | One `localStorage` object seeded by `shared/src/demo/demo.js` |
| `admin/frontend` | Sheetal staff console (tenants, plans, billing, moderation, KYC, gateways, staff/roles, settings) | Same `localStorage` object |

`website/backend`, `business/backend`, `admin/backend` are empty placeholders.

## 2. Key decisions

| Topic | Decision | Why |
|---|---|---|
| Language | Node.js 22 + TypeScript | Same language as the frontends; share types/validation via `shared` |
| Framework | Fastify | Fast, built-in schema validation, good plugin model |
| Database | PostgreSQL 16 (+ PostGIS later for map search) | Relational data, JSONB for flexible listing fields, strong for multi-tenant |
| ORM | Prisma | Typed queries, migrations |
| Validation | Zod schemas in `shared/`, used by API and forms | One source of truth |
| Auth | Short-lived JWT access token + refresh token (httpOnly cookie), argon2 passwords, TOTP 2FA for staff | |
| Jobs/queue | Redis + BullMQ | Emails, SMS, OTA sync, trial expiry, image processing |
| Files | S3-compatible storage (Cloudflare R2 / DO Spaces), resized with sharp | Property photos, KYC docs, payment screenshots |
| Hosting | VPS (Docker Compose: api, postgres, redis, nginx) | Node can't run well on cPanel; recommended unless you prefer otherwise |
| Structure | **One API** in a new workspace `backend/` (`@sheetal/api`) with route groups `/api/v1/public`, `/api/v1/business`, `/api/v1/admin` | One database, one auth system; the three placeholder folders get removed |

**Frontend switch-over:** `website/frontend/src/api/client.js` gets an env flag (`VITE_API_MODE=mock|live`). We move modules to the live API one by one, and the mock keeps working for anything not built yet. The business and admin apps replace `update(draft => …)` calls with API hooks one module at a time.

**Response format:** keep what the frontend already expects: `{ data, meta: { total, current_page, last_page, per_page } }` for lists and `{ message, errors }` for errors. That way no page has to change.

## 3. Domains and main tables

1. **Identity**: users, refresh_tokens, email_verifications, password_resets, totp_secrets.
2. **Tenancy & RBAC**: tenants (type: hotel/host/developer/agency/sponsor; status: trial/active/past_due/suspended/pending_verification), memberships (user ↔ tenant + role + scopes), roles (perms[]), invites, platform_staff, platform_roles, audit_log, impersonation sessions.
3. **Plans & billing**: plans (limits + features JSON), subscriptions, platform_invoices, payments (gateway, status, raw callback), manual payment proofs.
4. **Locations**: provinces → districts → cities → localities (lat/lng).
5. **Marketplace**: properties (one table for website and business listings: purpose, type, category, price, area, road access, status, moderation state, JSONB extras), property_media, facilities, favourites, reviews, inquiries/leads, tours, requirements (buyer demands), demand_matches, property_views.
6. **Agencies/agents**: public profile of agency tenants plus their agent members.
7. **Content**: banners, blog_posts, blog_categories, blog_comments (moderated), jobs, job_applications, CMS pages.
8. **Hospitality ops** (hotel/host): units/rooms, room_types, rates, bookings, calendar blocks, folios and charges, POS outlets, menu items, orders, shifts.
9. **Developer projects**: projects, project_units, reservations, progress_updates, site_visits.
10. **Sponsor investments**: offerings, investors, updates.
11. **Money** (tenant → customer): invoices, credit notes, receipts, payouts, VAT 13%, service charge.
12. **Agreements & contacts**: contacts (citizenship number etc. **encrypted at rest**), agreement templates (bainā, rent, commission), agreements, signatures, documents.
13. **Inbox/channels**: conversations and messages from WhatsApp, Messenger, Instagram, SMS (Sparrow), email.
14. **OTA sync**: channel connections, mappings, sync logs.
15. **AI**: ask-ai (compare properties), extract-leads, using the Claude API on the server only.
16. **Analytics & notifications**: visits/heartbeats, notifications.

Cross-cutting:
- **Tenant isolation**: every tenant-owned row has a `tenant_id`, enforced in one Prisma middleware (Postgres row-level security later).
- **Permission checks**: reuse the permission IDs from `shared/src/core/rbac.js`.
- **Plan limits**: checked on create (listings, rooms, seats, featured).
- Also: rate limiting on login and contact forms, audit log on admin and team actions, OpenAPI docs, structured logs, Vitest + integration tests against a real Postgres.
- **Dates**: stored in UTC/AD; Bikram Sambat conversion stays in the UI (`shared/src/core/bs.js`).

## 4. Phases

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | **Foundation** | `git init`, `backend/` workspace, Docker Postgres+Redis, Prisma, config/env, logging, error format, health check, test setup, CI, `client.js` mock/live switch | `npm run dev` starts the API, tests pass |
| 1 | **Auth + public catalog (read)** | register/login/verify/reset, user-info; locations, attributes, properties list/search/detail/by-code, featured, agents, banners, map pins; **import old site data** | Website runs in live mode for browsing and login |
| 2 | **Website write side** | post/edit/delete property + image upload, mark sold, favourites, reviews, contact/tour/requirement forms, demands & matches, notifications, emails, plans & upgrade request, blog, jobs + applications | Whole public site works with mock off |
| 3 | **Tenancy core** | tenants, memberships, roles/permissions, invites, platform staff, audit log, impersonation; admin tenants/system pages; business login + workspace switcher | Admin can create a tenant and invite staff, who log into business |
| 4 | **Business listings, leads, moderation** | agency/developer listings published to the public site after admin review, lead routing to agents, contacts, agreements | Agency posts a listing, admin approves, it appears on the website |
| 5 | **Billing & payments** | subscriptions, trial/grace/auto-suspend jobs, eSewa + Khalti + Fonepay + manual proof, tenant invoices/VAT/receipts, payouts | A tenant pays for a plan end-to-end in sandbox |
| 6 | **Hospitality & projects ops** | rooms, rates, bookings, calendar, POS, shifts, folios; developer projects/units/reservations; sponsor investments | Hotel can run a day: check-in → POS → checkout invoice |
| 7 | **Channels, OTA, AI, analytics** | inbox integrations, OTA sync, ask-ai/extract-leads via Claude, analytics dashboards | Those pages run on real data |
| 8 | **Hardening & launch** | security review, backups, monitoring, load test, production deploy, DNS for main/business/admin | Live in production |

Phases 1–2 put the public site live early. Phase 3 is the base everything after it needs.

## Progress
| Phase | Status |
|---|---|
| 0 Foundation | ✅ Done 2026-11-02: `backend/` (Fastify 5, TypeScript strict, Prisma 6 + PostgreSQL 17 locally via embedded-postgres, cache with Redis/in-memory), validated config, request ids, one error format, security headers, CORS allow-list, rate limits, `/health` + `/health/ready`, bot detection, first migration, 18 tests, TypeScript linting, website mock/live switch per path. Git set up (`main`, first commit `ee76a44`). Not done: CI (needs a GitHub repository). |
| 1a Accounts and login | ✅ Done 2026-11-02: users, sessions (hashed tokens, 30 days), businesses, plans, roles, email outbox, audit log; sign up (with a Starter workspace), log in (lockout after 5 wrong passwords, old-site users asked to set a new password), email verification, forgot/reset password, profile, change password, log out; seed for plans, super admin and Sheetal Property (Agency Pro, 1 year); 14 tests on a real database; website login switched to the API and tested end to end. |
| 1b Public catalog | Next: listings, search, map, agencies |
| 1c Old site import | After 1b: listings, photos, users, leads |

## 5. Requirements added on 2026-11-02

**Quality (every module)**
- One error format and one error handler; no stack traces to users; every error logged with a request id and shown grouped in Admin → System status.
- Caching (Redis): listing pages, search results, settings, plans; cleared when the underlying data changes. Rate limits on login, forms and search.
- Speed: database indexes on every filter, resized WebP photos (cover, gallery, thumb), background jobs for anything slow.
- **Bot filtering**: allow real search engines, block scrapers and fake browsers, keep bots out of analytics (review the old `BotDetector` service first).
- **System status** for the super admin (`GET /admin/system/status`): health of API, database, cache, jobs, storage, email worker, WhatsApp, voice server and AI model; speed; cache hits; errors; bots filtered; job runs.

**Integrations (set up in Admin → Setup center; secrets stored encrypted, write-only)**
- **Own email system** (no Zoho or other mail provider): domain added in the UI → Cloudflare API adds MX/SPF/DKIM/DMARC → background DNS polling until verified → Cloudflare Email Worker posts each inbound mail as signed JSON to `/webhooks/email/inbound` → saved in PostgreSQL → shown in the dashboard inbox; replies sent through Cloudflare Email Service or our own SMTP on the VPS, DKIM-signed. Works for Sheetal (`admin@`, `support@`, `no-reply@`) and for every business's own domain.
- **WhatsApp** instead of SMS (no SMS provider bought): official Cloud API (Meta app, WABA, phone number id, permanent token, webhook, template approval) **or** QR-linked phone (Baileys, like the old `whatsapp-service`; unofficial). Per-business alerts to their own chat or a WhatsApp group (groups need the QR mode).
- **Meta** (Messenger, Instagram, Facebook login), **Google** (sign-in, GA4, Search Console + sitemap, Business Profile).
- **AI**: Sheetal's paid subscription (provider, model, key) runs every AI feature against plan AI credits; ElevenLabs voice; speech-to-text; voice call server. Businesses may instead connect **their own** Gemini/OpenAI/Claude + ElevenLabs keys **once** and every AI feature uses them.
- **AI voice assistant**: setup steps (voice, greeting, knowledge from listings + FAQs, skills, test, go live); understands caller needs, suggests listings, books visits, saves leads, hands over to a person; **every call stored with its transcript** for the business to read.
- **Social sharing**: per-business Facebook page / Instagram / WhatsApp group; auto-share new listings; scheduled posts with per-platform results.

**Accounts**
- Super admin `admin@sheetalproperty.com`; Sheetal owner `shetalrealestate@gmail.com`. Passwords come from `.env` (`SUPER_ADMIN_PASSWORD`, `SHEETAL_OWNER_PASSWORD`) on first start only, never from code. See `.env.example`.

## 6. Open questions

1. **Old site data:** what is it (Laravel + MySQL?), and can we get a database dump or API access? Roughly how many properties, users, and agents?
2. **Name:** the code uses both "Sheetal" and "Shetal" (`shetal.com.np`). Which is the real domain and brand?
3. **Payments:** which gateways do you already have merchant accounts for?
4. **Email and SMS:** which providers (Zoho SMTP and Sparrow SMS are in the settings)?
5. **Hosting:** is a VPS fine, and which one or what budget?
6. **Scope:** are all five business types needed at launch, or is agency first enough?
7. **Images:** are the old site's photos kept on the old server, or should they be moved to new storage?
