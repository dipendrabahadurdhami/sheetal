# Project state (14 Nov 2026, noon, Nepal time)

**Phase 3 is in progress: 8 stages merged (PRs #65-#73, 14 Nov), about 45% of PHASE-3-TASKS.** Main = the merge of PR #73, CI green, about 1450 tests.
Phase 2 is closed (`handovers/CLOSE-OUT-phase-2.md`). **Read `handovers/CONTINUE-phase-3.md` first**: done table, next tasks in order, decisions, owner steps.
Every business is still on `billingMode = plans` and `platform.billing.salesEnabled` is false: no customer has seen any Phase 3 change.

## Phase 3 so far (14 Nov)
| PR | Task | What |
|---|---|---|
| #65 | DB-1 + DB-2 | 12 billing tables (subscriptions, events, grants, add-ons, locks, migration runs, AI credits, invoice lines, revenue, coupons, redemptions, platform approvals); invoices/payments in paisa; CHECKs + triggers (issued invoice frozen, revenue append-only, refund ≤ payment) |
| #66 | BE-2 + QA-1 | pure core `platform/src/billing/` (Nepal days, effectiveStatus, limits hard/soft, proration, coupons, price lock, `quote()`); PHASE-3-TEST-PLAN.md; proration table |
| #67 | BE-1 | `platform.catalog` + `platform.billing` settings (seed prices MB 3.4), manifests with free/full editions, `GET /v1/public/catalog` |
| #68 | BE-3 + QA-1 | entitlements v3, shadow mode, `requireWrite`/`requireLimit`, `GET /v1/entitlements`; `mapping.ts` (R1-R4, R6); parity test v3 ≥ v1 on 19 fixtures |
| #69 | BE-4 | tax invoice numbers at payment (`INV-2083-84-0001`, Nepal fiscal year, no gaps), `applySubscriptionPayment`, revenue ledger (100% commission until the split is set), credit notes |
| #70 | BE-9 | payment router (Sheetal's vs a business's system, no fall-back), paisa amount check |
| #71 | BE-5 | hourly lifecycle job (statuses, one renewal invoice per business, reminders); old plan cycle skips `apps` |
| #73 | BE-6 | business marketplace API (install, trial, cart quote = invoice, checkout, change/cancel/resume/remove, coupons, overview) |

## Lessons from 14 Nov (keep doing)
- Old tests pin lists (the admin job list, the business settings list): add new things beside them (`adminPlatformJobs`), never edit the pinned test.
- PostgreSQL unique-violation messages name the columns (`Key (tenant_id, app_id)`), not the constraint; CHECK and FK messages name the constraint.
- A test that depends on the hour of day breaks CI at night (Nepal 00:00-09:00): send every time explicitly.
- Squash-merged stacked branches: `git merge -X ours origin/main`, then `npm run gen:permissions -- --check`, then push and wait for CI again.
- Local sandbox has no Prisma engine: run pure tests with a temporary vitest config; CI (`prisma migrate diff`) prints the exact SQL if a migration is off.
- No `await` inside a `$transaction((tx) => ...)` arrow that isn't async: load values before the transaction.

## Lessons from 13 Nov night (keep doing)
- Stacked branches: after `git merge origin/main`, grep for `<<<<<<<` before committing, or merge with `-X ours` (the branch already holds main's earlier squash).
- A live-only screen move: put the page in `apps/<app>/frontend/pages`, load its own data with the SDK (`useApiGet`), send `version`, take what the shell knows
  (Business pages, panel reloads) as props; the old Business file becomes a shim. A page may read UI state and static config from the store, never business data.
- The business panel's store saves only `session` and `drafts` (`sheetal_business_ui`); the shell's read copy is filled by `live.js` each load.
- Website/no-context writes use the small system context and `new OutboxEventBus({ mayPublish, strict })`; the business API's dispatcher delivers.
- Paisa twins: a BEFORE INSERT OR UPDATE trigger keeps `*_paisa` = rupees × 100 (Prisma's migrate diff ignores triggers).

---


**Main = the merge of PR #55 (13 Nov, about 20:15), about 1205 tests, CI green.** One builder (you), no other chats. Phase 1 is closed; Phase 2 is about 87% done:
every business backend route is on the kernel (PRs #50-#55 on 13 Nov evening); Wave 6 (screens) and the leftovers remain.
Read `handovers/CONTINUE-phase-2.md` first: it has the done table, the not-done list, the exact pattern for moving an app, and the owner steps.

## What happened on 12-13 Nov (PRs #20-#48)
- Phase 1 finished: #20 screens, #22 Integration Center, #23 settings store, #25 support-audit race fix, #26/#27 new permission names everywhere and
  the alias layer removed, #28 close-out (shims deleted, `setup-db` moved to `platform/test`). The owner ran `RUN-P1-ROLES` on real data (backup first).
- Phase 2 apps moved onto the kernel (repository = only table code; service = rules, ONE transaction with audit line + event; controller = HTTP only;
  `scope.ts`/`capContext` capped at "branch" via `PHASE_ONE_CAPS`; additive migration with kernel columns; old route file -> shim; `app.ts` registers
  the app's routes with `contextOf: businessContextOf`; old tests unchanged; new `<app>-kernel.test.ts`): People, Agreements, Projects, Investments,
  Invoicing (+ Payouts read-only), POS + Stock, Hotel, CRM, Listings, Workspace part 1. Screens on the kit: People, Agreements, Rentals, Projects,
  Investors, POS, Stock, Hotel (Front desk, Bookings, Calendar), Customer invoices (live part; the view is passed in).
- Agreed cross-app writes in ONE transaction (recorded in docs/architecture/MODEL-OWNERS.md): Projects writes reservation payments (Collection);
  POS writes a room-bill line (FolioLine); Listings moves its enquiries (Lead) with it.
- Real fix: Hotel bookings now hold the room type (`SELECT … FOR UPDATE`), so two bookings of the last room at once can't both win (tested).

## Owner's PC
`C:\Users\USER\Desktop\sheetal`. Last RUN-UPDATE seen: on `8d54f3e` (13 Nov 14:41), all OK. Migrations since then: CRM, Listings, Workspace
(branches), forms kernel columns (`20261113180000`): the next RUN-UPDATE applies them (it backs up first). `update.ps1` still lists squash-merged branches as "kept (not merged yet)": harmless.

## Lessons from Phase 2 (keep doing)
- Stacked branches + squash merges: after a PR is squash-merged, merging main into the next branch conflicts on the same lines; the branch already holds
  that work, so take the branch's side (`git checkout --ours`) and rerun `npm run gen:permissions`. Check `git diff origin/main --name-only` after.
- Kernel services: a route with no business context (public link, webhook, invite accept, jobs) publishes events with a small context
  `{ requestId, ip, now, log, db, tx, actor, business: { id } }` inside a `$transaction` (see team.service.ts userWrite, checkup.job.ts).
- The GitHub proxy sometimes answers 502/503 for a minute: wait and retry; never re-run a merge blindly (check the PR state first).
- zod v4: a `superRefine` schema stays a ZodObject (`.shape`). Event payload field types are only string/number/boolean/id/date/paisa (no arrays).
- `BaseService` already has `list`, `create`, `update`, `remove`: name your own methods differently (overview, makeDraft, removeDraft, browse...).
- No Prisma engine in the sandbox: CI is the first real DB run. Local: `npx vitest run`, `npm run lint`, `gen:permissions`, `check:manifests`,
  `check:boundaries`, `check:schema`, `vite build`, `npx tsc -p apps/<app>/tsconfig.json` (ignore TS2694/TS2305/TS7006/TS2339 from missing Prisma types).
- `packages/config/src/no-old-names.test.js` reads git-TRACKED files: `git add` new files before running it. It pins look-alike strings per file.
- `platform/test/support-and-catalog.test.ts` lists every capped app; add the app when you cap it.
- The owner wants speed: batch, keep CI running in the background, but never skip a check. Tell them early when a plan is too optimistic.

---

# History: project state on 11 Nov 2026, 21:30 (kept as written)

This is the earlier Lead's full handover, kept as it was written over the day. Where it mentions QA or other chats: that is history.
**Now there is one chat (you) and no separate QA.** Main = `0337e3c`, 1013 tests, CI green. The owner's PC is updated to main
(RUN-UPDATE ran OK at 21:28, all checks passed). Two builder chats (Phase 1 rest, Phase 2) were told to stop; if the owner gives you an
`OUT-*.zip` from one of them, review it like your own work and use what is good.

Merged PRs: #1-#13 (Phase 0 and early Phase 1), #14 Reviews page, #15 CI schema check + build, #16 access tables + role rewrite script,
#17 approvals (off) + support sessions + role catalog, #18 Rentals on the kernel, #19 Phase 3 design docs.

---

# Sheetal Property: Lead handover (11 Nov 2026, 12:50 Nepal time)

Drop this file into a fresh chat. You are the **Lead** of the Sheetal Property build: a multi-app SaaS marketplace for Nepal
(property, hotel, POS, CRM, HR, rentals, invoicing and more, one app per business need, subscription-based). You plan, write task
zips, review what comes back together with QA's verdict, apply it on a branch, fix what QA asks, let CI prove it, merge, and tell
the owner the one thing to do next.

## 1. How to talk to the owner (important)
- **One step at a time.** Short, plain words. The owner got confused when given several things at once. Number the step, say exactly
  what to click or paste, and what result to expect. Ask for a screenshot.
- **Always attach zips as files** (SendUserFile), never just the name.
- Give progress as percentages when asked: Phase 0 100%, **Phase 1 about 62%**, whole project about 15%.
- The owner wants speed now ("we are late, many phases remain") but quality still matters: QA reviews everything, CI must be green.
- The owner decides waivers (they waived parts of the FE-3 hand test; that was their call, and QA was told).
- Never put the test password in chat; point to `test-accounts.csv` in the project folder. Never ask for or type the owner's real password.

## 2. The code
- GitHub `dipendrabahadurdhami/sheetal` (push access through the session). The owner's copy: `C:\Users\USER\Desktop\sheetal` (Windows, PowerShell, VS Code).
- Monorepo, npm workspaces: `platform` (kernel), `packages/ui|sdk|config` (screen kit), `apps/*` (15 app manifests; Expenses and Reviews
  have backend + frontend), `business|admin|website` (old surfaces, `backend` Fastify + `frontend` Vite), `backend-core` (Prisma schema,
  migrations, old domain code + shims), `shared`, `mail-server`.
- APIs 4000 (website), 4001 (business), 4002 (admin); screens through 5173 (`/business`, `/admin`). Local PostgreSQL on 5433 (`npm run db:local`).
- Architecture docs (binding): `docs/architecture/` KERNEL.md, ACCESS.md, APP-MANIFEST.md, FRONTEND-KIT.md, INTEGRATIONS.md, SETTINGS.md,
  FOLDERS-AND-MOVE-PLAN.md (section 7 = the Phase 1 step table), MODEL-OWNERS.md. Every task's CHANGES/HANDOVER is in `handovers/`.
- Team rules for specialists: `TEAM-RULES.md` (in every task zip; "Lessons from Phase 0/1").

## 3. CI and merging
- GitHub Actions `check.yml` on PostgreSQL 16: `npm ci` → workspaces present → `prisma generate` → **`prisma validate` + `prisma migrate diff
  --exit-code`** → `npm run check` (help check, `gen:permissions --check`, `check:manifests`, `check:boundaries`, `check:schema`, lint,
  typecheck, all tests) → **`npm run build`** (the last two steps come from PR #15; until it merges they run only on branches that include it).
- GraphQL is blocked here: use REST. Create PR: `gh api repos/dipendrabahadurdhami/sheetal/pulls -f title=… -f head=… -f base=main -F body=@file`.
  Merge: `gh api -X PUT repos/…/pulls/<n>/merge -f merge_method=squash -f commit_title="… (#n)"`. Read CI: `actions/runs?head_sha=…&event=pull_request`,
  then `actions/jobs/<id>/logs` (strip colour codes; grep `Tests`, `FAIL`, `error TS`).
- Force-push and deleting remote branches are refused from the sandbox: merge `main` into a branch instead; the owner deletes old branches.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` + `Claude-Session: …`. PR body ends with the Claude Code line.
- Typical CI catches: regenerate `npm run gen:permissions` after any manifest edit; `tsc` strict wants `arr[0]!` in tests; a test query must
  filter to its own tables. Local `tsc` shows unrelated errors when the local Prisma client is stale: trust CI.
- Test counts on main: 894 (after FE-2). FE-3 branch 916; DB-3 branch 916 (894 + 22).

## 4. Owner scripts (in `scripts/ops`, NOT in git; copies were in /mnt/user-data/outputs/upd)
- `RUN-UPDATE.cmd` (`update.ps1`): back to main, pull, delete only merged branches, restore package-lock, backup when migrations are pending,
  migrate, generate, data checks (`check-branch-links.mjs`). Run after every merge, with the server windows closed.
- `RUN-TRY.cmd <branch>` (`try-branch.ps1`): checks out a branch, kills old listeners, starts the database if needed and both server windows,
  waits for 127.0.0.1:4000-4002/health, says "all three APIs answer". Usage in the VS Code terminal:
  `.\scripts\ops\RUN-TRY.cmd phase-1/<branch>`. To pull a branch the owner already has: `git pull origin <branch>` (no tracking set).
- `RUN-P1-RESYNC.cmd`: already run (branch links PASS: 59 members, 10 limited, all linked).
- Hand tests need the owner signed in with a **test account** (`owner.agency.business@sheetal.test`, business "Test Realty Business");
  otherwise the panel shows the SAMPLE pages (e.g. Reviews with Import/Export and 212 reviews). Practice reviews: `npm run reviews:sample`.
- Claude in Chrome was not connected; the built-in browser pane cannot reach localhost. Hand tests are done by the owner from screenshots.

## 5. Where Phase 1 stands

| Item | State |
|---|---|
| OPS-1, DB-1, DB-1b, BE-1..BE-6, OPS-2, BE-2, DB-2, FE-1, FE-2 | merged (#1-#13); QA signed off (BE-5/BE-6 after the one-line confirmations) |
| **FE-3** Reviews page, PR **#14** (`phase-1/P1-FE-3-reviews-page`) | CI green (916). QA: signed off pending hand test; owner waived items 6 and 8; live page checked (stats, bars, gold stars in light). **Waiting for QA's final yes → merge.** Includes `npm run reviews:sample`. |
| **OPS-3** CI schema/migrations + build, model-owner disagreements, PR **#15** (`phase-1/P1-OPS-3-ci-close`) | CI green. **Waiting for QA review → merge.** |
| **DB-3** access tables + role rewrite script, PR **#16** (`phase-1/P1-DB-3-access-tables`, includes #15) | CI green (916, migrate diff empty). QA fixes 1-3 done (manifest lines, restore empties `perms_v1`, call-site audit with two raw checks fixed). **Send QA the note in section 7 → merge after #15.** Fix 4 (guarded runner) and the real `--apply` wait for the role screen (blocker found in the audit). |
| **P1-REST** (everything else) | Zip `P1-REST-builder.zip` given to the owner for ONE builder chat, in 6 stages, one OUT zip per stage → QA → Lead. |

Merge order: #15 → #14 → #16 (merge main into #16 first if needed). After each merge the owner closes the server windows and runs RUN-UPDATE.

### P1-REST stages (what will arrive as OUT-P1-REST-S1..S6)
1. BE-7: platform helpers (`busOf`, scope cap) moved; approvals hook + service + routes (rules OFF); impersonation sessions; role catalog
   and `checkPerms` on new names (unblocks the rewrite); `meta.can` flags on Expenses/Reviews lists.
2. FE-4: menu from manifests, role screen with scopes (no `:all` for Expenses/Reviews), approvals inbox, team screen by branch id,
   support banner, "Try the demo".
3. Integration Center (DB-4 tables part, BE-8, FE-5).
4. Settings (DB-4 settings part, BE-9, FE-6).
5. BE-10: switch call sites to new names, remove the alias layer, grep test.
6. Close-out: delete shims, retire `backend-core/scripts/{agreements,expenses,people,rentals}-roles.ts`, move setup-db to platform,
   `RUN-P1-ROLES.cmd` guarded runner for the real role rewrite (backup, dry run, GAINS + typed YES, one business then all, check-branch-links, Hide, Desktop report).

For each OUT zip: unzip in /tmp, read CHANGES (section "lines for the Lead"), apply on `phase-1/P1-REST-S<n>` from main, apply QA's fixes,
regenerate permissions, push, PR, wait for green CI, merge after QA approves, tell the owner to run RUN-UPDATE. Hand tests: give the owner
the steps one at a time.

## 6. QA follow-ups still open (and where they land)
- The CRM task must make the `own` scope for leads include **unassigned** leads, with a test (QA condition on the DB-3 leads rule).
- Real-phone check: open a receipt once on a phone (Expenses). Not blocking.
- Nepali texts in new manifests are missing (check-manifests warns, rule 6): a native read before launch.
- `ChannelAccount` owner (workspace vs crm) decided when CRM moves; `checkups.ts` moves to the listings app.
- ui ↔ sdk package loop accepted for now; revisit when the lock file is next touched.

## 7. Note to send QA next (ready to paste)
> **P1-DB-3, PR #16: fixes 1-3 done.** CI green on PostgreSQL 16, run 42976099301: `prisma validate` ok, `migrate diff --exit-code` "No
> difference detected", 916 tests (+22). (1) Section 7 lines applied: workspace manifest ApprovalRule + ApprovalRequest, platform manifest
> ImpersonationSession, BRANCH_LABEL_ONLY + ApprovalRequest, MODEL-OWNERS 96 models; apps.generated.ts regenerated. (2) `--restore` now
> empties `perms_v1`; the restore test checks it and a second restore writes nothing. (3) Call-site audit is in CHANGES "Lead, after QA":
> two raw name checks fixed (`forms/routes.ts:77`, `checkups.ts:59` → `hasPerm`); `"*"` checks are safe; staff perms not affected;
> the old `*-roles.ts` scripts must not run after the rewrite. **Blocker found:** the role screen (`RoleEditor.jsx`, `permCount`) and
> `team/routes.ts checkPerms` use OLD names, so the real `--apply` waits for P1-REST Stage 1-2 (role catalog on new names). Fix 4
> (guarded runner) comes in Stage 6. Two CI-only test fixes were needed (strict `[0]!`, the paisa query limited to the new tables).
> Please sign off DB-3 and review PR #15 (OPS-3).

## 8. Lessons (keep doing)
- Read every OUT zip fully before applying; diff full-file replacements against main (they can drop recent work).
- Specialists cannot run Prisma or a browser: CI is the first real run; expect 1-3 small CI fixes per task.
- Never let a test be edited to pass; add tests for every QA fix.
- Device bridge writes to the owner's PC can land stale: re-stage and compare md5 after writing.
- Never commit `.env`, `test-accounts.csv`, `.pgdata`, zips or keys. No "verified" wording or internal details (DhamiPlus, PAN) in public texts.

## 9. Added 11 Nov 13:00: Phase 2 wave 1 runs in parallel
The owner started a second builder chat with `NEW-CHAT-P2-W1.zip`: Rentals, People (HR), Agreements backends on the kernel, one OUT zip
per app (`OUT-P2-W1-S1..S3`). That chat may edit only `apps/{rentals,people,agreements}/**`, the three old route files (become shims),
their lines in `business/backend/src/app.ts`, and new test files; kernel/schema/manifest needs come as "Lines for the Lead".
Phase 2 waves are in `PHASE-2-PLAN.md` inside that zip (W2 screens after P1-REST stage 2; W3-W6 after Phase 1 closes).
Merge rule: apply P1-REST stages and P2-W1 stages in the order QA approves them; on a conflict in `app.ts` or a shared kernel file,
P1-REST wins and the P2 change is re-applied on top. P1-REST stage 5 (switch call sites) skips files already moved into `apps/`.

## 10. Added 11 Nov 13:20: no separate QA any more; #14, #15, #16 merged
- **Owner decision:** no QA chat. The Lead reviews every zip in full (diff against main, business rules, permissions/branches, secrets,
  public wording), CI must be green, screens get a short owner hand test. Still ask the owner first before anything risky on real data
  (role rewrite `--apply`, customer price migration, money).
- **This Lead chat applies everything**; the Phase 1, Phase 2 (W1) and Phase 3 (design) chats are builders only and send their OUT zips here.
- Merged: #15 (OPS-3) → #14 (FE-3) → #16 (DB-3). Main = c0b2f88, 938 tests. Owner must close the server windows and run RUN-UPDATE
  (DB-3 adds migration 20261112090000_access_tables; the script backs up first).

## 11. Added 11 Nov 20:45: three more merged
- #17 P1-REST-S1 (approvals OFF, support sessions, role catalog on new names, platform host/scope helpers, `meta.can`). Lead added: Expenses
  "confirm" wired to the approval gate (executor registered), 32-char test SECRETS_KEY.
- #18 P2-W1-S1 Rentals on the kernel + migration `20261112100000_rentals_kernel_columns`. Lead added: owner saves answer `version`; stale
  version checked before the late-fee rules; late-fee test runs with `billEventsOf(app)`.
- #19 P3-ARCH design docs (MARKETPLACE-AND-BILLING.md, PHASE-3-TASKS.md, PHASE-3-RISKS.md). Five owner questions in MB section 0 still open.
- Main = 0337e3c, 1013 tests. Phase 1 about 70%. Next: P1-REST-S2 (screens), P2-W1-S2 (People).
- Builders work from an old repo snapshot: always diff their full files against current main and re-apply only their lines (app.ts etc.).
