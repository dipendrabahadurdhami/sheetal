# Sheetal Property Platform

Real-estate and hospitality platform for Nepal: a public property website, a business management system for agencies,
hotels, homestay hosts, developers and investment sponsors, and a super-admin panel for the Sheetal team.

Built and owned by **DhamiPlus Pvt. Ltd.** Proprietary — see [LICENSE](LICENSE) and [COPYRIGHT.md](COPYRIGHT.md).

---

## What is in this repository

| Part | Folder | URL (local) | Who uses it |
|---|---|---|---|
| Public website | `website/frontend` + `website/backend` | http://localhost:5173 | Buyers, renters, owners |
| Business panel | `business/frontend` + `business/backend` | http://localhost:5173/business | Agencies, hotels, hosts, developers, sponsors |
| Super-admin panel | `admin/frontend` + `admin/backend` | http://localhost:5173/admin | Sheetal staff |
| Shared server code | `backend-core` | database on :5433 | All three APIs |
| Shared front-end code | `shared` | — | All three front-ends |
| Mail server | `mail-server` | SMTP :2525 locally | Business email, system emails |

Stack: **React + Vite** (front-ends), **Fastify + TypeScript** (APIs), **PostgreSQL + Prisma** (database),
**Vitest** (tests). One database is shared by all three APIs.

## Quick start

Requirements: Node.js 20+ and Git.

```bash
npm install
cp backend-core/.env.example backend-core/.env          # then fill it in
npm run doctor                                          # checks everything is ready
```

Then, in four terminals:

```bash
npm run db:local     # 1. database (keep open)
npm run dev:api      # 2. APIs on :4000 / :4001 / :4002
npm run dev          # 3. website and panels on :5173
npm run dev:mail     # 4. mail server
```

First time only, after the database is running: `npm run db:migrate` then `npm run db:seed`.

## Commands

`npm run help` lists every command with what it does. The ones you will use most:

| Command | What it does |
|---|---|
| `npm run check` | Lint, typecheck and all tests. **Run before every commit.** |
| `npm test` | All automated tests (250+). They use their own temporary database. |
| `npm run doctor` | Checks Node, settings, database, ports and the photo folder. |
| `npm run backup` / `npm run restore` | Database and photo backups. |

## Documentation

| Document | For |
|---|---|
| [START-HERE.md](START-HERE.md) | Running it day to day, accounts, checking it works, backups. |
| [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) | How the code is organised, how a request flows, how to add a feature, rules to follow. |
| [docs/Sheetal-Project-Status-Report.pdf](docs/Sheetal-Project-Status-Report.pdf) | What is done, what is left, what to build next, launch checklist. |
| [docs/local-testing.md](docs/local-testing.md) | Setting up payment, AI and Meta keys from the admin panel. |
| [docs/mail-server.md](docs/mail-server.md) | Putting the mail server online (DNS, TLS, reputation). |
| [docs/payments.md](docs/payments.md) | Merchant accounts needed for eSewa, Khalti, Fonepay. |

## Working on the code

1. Pull the latest: `git pull`.
2. Make the change on a branch: `git checkout -b feature/short-name`.
3. Add or update tests next to the code you changed.
4. Run `npm run check` until it passes.
5. Commit with a short, clear message saying what changed and why, then `git push`.

Read the developer guide before your first change.

---

© 2026 DhamiPlus Pvt. Ltd. All rights reserved.
