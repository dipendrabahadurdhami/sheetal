# CHANGES P2-W5 Listings on the kernel

- `business/backend/src/modules/listings/routes.ts` → `apps/listings/backend/` (`listing.repository.ts`, `listing.service.ts`, `listing.controller.ts`,
  `presenter.ts`, `routes.ts`, `index.ts`). The old file is a shim. `app.ts` registers `listingRoutes` from `@sheetal/app-listings/backend` with
  `contextOf: businessContextOf` (rule 11). `modules/listings/codes.ts` (the code prefix setting) stays where it is.
- Same routes, answers, messages and audit strings (including `listing.moved_out` / `listing.moved_in` in both businesses).
- Every audit line is now written in the same transaction as the change; Sheetal's staff are told after it is saved.
- When a listing moves to another branch or business, its enquiries (CRM's `Lead`) go with it in the same transaction: an agreed exception in MODEL-OWNERS.md.
- Migration `20261113160000_listings_kernel_columns` (additive) on `listings`. A listing is still never really deleted ("removed").
- Listings carry `version`; an edit may send it (stale = 409).
- Events: `listings.listing.drafted|submitted|updated|status_changed|removed|moved`. `listings` added to `PHASE_ONE_CAPS`.
- Not moved: review by Sheetal (admin API), what the website shows, the check-ups (`modules/reviews/checkups.ts`), and the screens (they read the panel
  store and move with wave 6).
- Tests: `listings.test.ts` unchanged; new `business/backend/test/listings-kernel.test.ts`. `platform/test/support-and-catalog.test.ts` (scope cap):
  Listings is now capped, so the example of an app with no cap is Workspace.
