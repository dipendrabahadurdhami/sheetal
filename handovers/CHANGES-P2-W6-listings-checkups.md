# CHANGES P2-W6: listing check-ups into the Listings app

- `business/backend/src/modules/reviews/checkups.ts` → `apps/listings/backend/` (`checkup.repository.ts`, `checkup.service.ts`, `checkup.controller.ts`,
  `checkup.job.ts`), registered by `listingRoutes`; the 15-minute job (`reviews.checkups`, same id) is `checkupJob` from `@sheetal/app-listings/backend`.
  The old file is a shim (`reviewRoutes` registers nothing; `reviewCheckupJob`, `decideChanges`, `GROUPS`, `nepalDay` re-exported).
- Same routes, answers, messages and status codes. New: each change runs in ONE transaction with its event (`listings.checkup.setup_saved|reviewed|
  decided|picked`); the owner's actions also write an audit line (`checkups.setup|decided|picked`); a listing a check-up changes gets its version bumped
  (so a page with an older copy gets a clear 409). The job decides one business per transaction with its event.
- These routes had no tests before: new `business/backend/test/checkups-kernel.test.ts` covers the main flow and the kernel rules.
