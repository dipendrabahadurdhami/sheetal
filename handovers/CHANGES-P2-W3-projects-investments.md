# CHANGES P2-W3 Projects and Investments on the kernel, screens on the kit

The old `business/backend/src/modules/projects/routes.ts` served three apps. It is split:
- **Projects** (`apps/projects/backend`): units, holds, reservations, and the payments on a reservation. A payment is written in the same transaction that marks
  the reservation and its unit sold when fully paid (one atomic step, as before). `Collection` is tagged `collections`; this agreed exception is recorded in
  `docs/architecture/MODEL-OWNERS.md`. The Collections app has no server code of its own yet (it reads these rows later).
- **Investments** (`apps/investments/backend`): offerings (investment listings), pledges marked paid or refunded, updates emailed to investors.
- The old route file is a shim registering both. `app.ts` registers `projectRoutes` and `investmentRoutes` with `contextOf: businessContextOf` (rule 11).

Same routes, answers, messages and audit strings. Added:
- Migrations `20261113110000_projects_kernel_columns` (units, reservations, collections) and `20261113110100_investments_kernel_columns` (commitments, investment_updates): additive.
- Rows carry `version`; a unit change or a pledge mark may send it (stale = 409). Hold, reserve, payment, cancel and pledge marks are compare-and-set.
- A payment is checked against what is due inside its transaction (two payments at the same moment can't both pass on old numbers).
- Events: `projects.unit.added|updated|held`, `projects.reservation.created|paid|sold|cancelled`, `investments.commitment.pledged|paid|refunded`, `investments.update.posted`.
- `projects` and `investments` added to `PHASE_ONE_CAPS`. The pages now also reload when the branch picked at the top changes.
- Screens: `LiveProjects` and `LiveInvestors` moved out of `LiveOps.jsx` to `apps/projects/frontend` and `apps/investments/frontend` on the kit; `LiveOps.jsx` re-exports them.
- Tests: `operations.test.ts` unchanged; new `business/backend/test/projects-kernel.test.ts` and two screen tests.
