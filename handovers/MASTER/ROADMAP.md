# Roadmap: every phase still to do (one "next" = one phase)

Progress on 14 Nov 2026, noon: Phase 0 100% · Phase 1 100% · Phase 2 100% (closed) · **Phase 3 about 45% (8 stages merged, PRs #65-#73; continue from `handovers/CONTINUE-phase-3.md`)** · whole project about 68% (rough).
Work strictly in this order. Details of each stage are in the architecture docs named. Each stage = one branch, one PR, CI green, merged.

---

## Phase 1 (rest): DONE (PRs #20-#28; the owner ran RUN-UPDATE and RUN-P1-ROLES on real data on 13 Nov: 56 roles rewritten, 0 lost, 0 gained)

---

## Phase 2: DONE (PRs #29-#64; close-out `handovers/CLOSE-OUT-phase-2.md`)
Every business backend is on the kernel, every business screen on the kit, the business panel has no sample workspace and keeps only UI state in the
browser, website writes of business data go through the apps, and the leftovers (room-type hold for feeds, Settings tab per app, Rentals paisa + soft
delete, unused shims) are merged. Known limits handed on are listed in the close-out note.

---

## Phase 3: marketplace, per-app subscriptions, pricing
Design is done and merged: `docs/architecture/MARKETPLACE-AND-BILLING.md` (MB), `PHASE-3-TASKS.md` (22 tasks in order), `PHASE-3-RISKS.md`.
The 5 owner questions were **answered on 13 Nov** (all recommendations accepted, see `OWNER.md`). **Done: QA-1, DB-1, DB-2, BE-1 to BE-6, BE-9. Next: BE-7.** Build PHASE-3-TASKS.md in its order (QA-1 → DB-1 → DB-2 → BE-1..11
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
