# Roadmap: every phase still to do (one "next" = one phase)

Progress on 13 Nov 2026, 19:30 Nepal time: Phase 0 100% · **Phase 1 100% (closed, see `handovers/CLOSE-OUT-phase-1.md`)** · **Phase 2 about 80%** · Phase 3 plan done, build 0% · whole project about 53% (rough).
Work strictly in this order. Details of each stage are in the architecture docs named. Each stage = one branch, one PR, CI green, merged.

---

## Phase 1 (rest): DONE (PRs #20-#28; the owner ran RUN-UPDATE and RUN-P1-ROLES on real data on 13 Nov: 56 roles rewritten, 0 lost, 0 gained)

---

## Phase 2: every business app on the kernel, screens on the kit
Already merged (see `handovers/CONTINUE-phase-2.md` for the table): Rentals backend #18; People #29 (+ screens #30); Agreements #31 (+ screens);
Rentals screens #32; Projects + Investments #34 (+ screens); Invoicing #36 + Payouts #37 (live page in the app); POS + Stock #39 (+ screens);
Hotel #41 (+ screens; no double booking at the same moment); CRM #43; Listings #45; Workspace part 1 (branches, settings, check-ups) #47;
Workspace part 2a the team #50; part 2b the Overview + `ChannelAccount` owner (workspace) #51.

**Still to do in Phase 2, in this order:**
1. **Workspace part 2 (rest)** (`business/backend/src/modules/`): `data` (import/export), `forms` (has public endpoints), `mail`, `growth`; then move
   `modules/reviews/checkups.ts` into apps/listings. Details in `handovers/CONTINUE-phase-2.md`.
2. **Wave 6** (W6): screens that still read the panel store `business/frontend/src/live.js` (Inbox, Listings, Team, Branches, Settings) move onto the
   kit/SDK, page by page; `InvoicesView` moves into apps/invoicing/frontend; then remove the browser-storage sample workspace (keep "Try the demo",
   which is a real demo business); then website API writes of business data on the kernel (enquiries create leads, the sign module, bookings).
3. **Leftovers:** online travel sites (`modules/ota`, `domain/ota.ts`) into apps/hotel with the room-type hold; Business → Settings tab per app;
   Rentals paisa columns + backfill and soft delete; delete every shim nothing imports; Phase 2 close-out note (like Phase 1's).


| Wave | What |
|---|---|
| W1 rest | People/HR backend (attendance, leave types, leave requests; leave approval `approvable: true`, rule OFF), then Agreements backend (website signing flow stays on the website API; signing rules and audit trail exactly as today). Pattern: `apps/rentals/backend` + `apps/expenses/backend`; old route file → one-line shim; old tests unchanged; new `<app>-kernel.test.ts`. Rentals follow-ups: paisa columns + backfill (like `expenses_paisa_resync`); soft delete for owner/unit/payment/statement once their readers are switched. |
| W2 | Screens of Rentals, People, Agreements on the kit (like Expenses and Reviews); Business → Settings tab per app. |
| W3 | Invoicing, Collections, Projects, Investments: backend + screens. |
| W4 | Hotel (bookings, rooms, rates, OTA), POS and Stock: backend + screens. |
| W5 | CRM (leads, inbox; the `own` scope for leads MUST include unassigned leads, with a test), Listings (+ check-ups: move `checkups.ts`), Workspace (team, branches) into `apps/`; decide `ChannelAccount` owner. |
| W6 | Website API on the kernel where it writes business data; remove the browser-storage sample workspace; delete the last shims (`backend-core/domain/*` re-exports). |

**Done when:** every app in `apps/` has backend on the kernel and screens on the kit, no business route uses old permission checks,
the sample store is gone, CI green, hand test of each app's main page passed.

---

## Phase 3: marketplace, per-app subscriptions, pricing
Design is done and merged: `docs/architecture/MARKETPLACE-AND-BILLING.md` (MB), `PHASE-3-TASKS.md` (22 tasks in order), `PHASE-3-RISKS.md`.
**First** ask the owner the 5 questions in `OWNER.md` (one at a time). Then build PHASE-3-TASKS.md in its order (QA-1 → DB-1 → DB-2 → BE-1..11
→ FE-1..6 → OPS-1 → OPS-2). The customer migration (OPS-2: shadow → pilot → all) needs the owner's yes at each step, and a backup first.

**Done when:** every PHASE-3-TASKS task merged, launch gates G1-G10 of PHASE-3-RISKS met, migration done with the owner.

---

## Phase 4 (proposed, confirm with the owner when Phase 3 ends): launch readiness
Production deployment and environments, backups with a restore drill, monitoring and alerts, a security review (auth, permissions,
uploads, rate limits, secrets), performance and load test, Nepali texts reviewed by a native speaker, legal pages, a full end-to-end
hand test of every app on a phone.

## Phase 5 (proposed): growth
AI features in each app (Sheetal AI and own keys), delivery partners (Pathao, Foodmandu, Yango), IRD billing link, the bank card gateway
when its legal process ends, a mobile-friendly app/PWA.
