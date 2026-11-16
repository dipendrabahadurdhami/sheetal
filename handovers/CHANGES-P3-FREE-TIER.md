# CHANGES: listings follow the Listings limit; moving a business to the free tier (16 Nov 2026)

The owner's rule (16 Nov, in his words: "nothing special for Sheetal; show free only in public now; after they pay again, publish
automatically all that were public earlier; do not show what was hidden before, that makes inconsistency").

## The rule
A business on app subscriptions shows on the website only as many listings as its Listings edition allows (free 3, full 500, grants on top).
- **Limit falls** (the paid period ends, or staff move it to free): the first `limit` published listings stay (featured first, then the newest
  published); the rest become `paused` with `limitPausedAt` set. Nothing is deleted. Sold and rented listings are never touched.
- **Limit rises** (it pays): exactly the listings the system paused come back (newest first, as many as fit) and lose the mark.
- **Never shown by the system:** a draft, a listing in review, one a person paused or archived. A marked listing a person changed meanwhile
  loses its mark and is theirs again.
- Only businesses on `billingMode = apps`. A business on plans or shadow keeps today's behaviour.

## What changed
| File | What |
|---|---|
| migration `20261116100000_listing_limit_paused` | `listings.limit_paused_at` (nullable; additive). **Applied to the owner's database on 16 Nov** (backup `2026-11-16_2211` first) |
| `backend-core/src/domain/listing-limit.ts` (new) | `reconcileInTx`, `listingLimitOf`, `reconcileListingLimit`, `reconcileAllListingLimits`; one audit row per change (`listings.limit_paused` / `listings.limit_restored`) |
| `backend-core/src/domain/billing-free.ts` + `scripts/billing-free.ts` + `npm run billing:free` (new) | one business to the free tier in one transaction: apps to their free edition (an app without one, Mail, expires), migration and "covered" grants revoked, add-ons 0, price lock removed, old plan to Starter with no renewal date (`syncCovered` follows), audit row `billing.moved_to_free` holding what it had, then the listing rule. Dry by default. Refused while a payment is in flight, and (unless `--force`) for a really paid, still running period. `-- --listings` runs the listing rule alone |
| `admin/backend/src/modules/billing.ts` | the hourly subscription job runs the listing rule for every business on apps after the lifecycle |
| `backend-core/src/domain/billing.ts`, `business/backend/src/modules/marketplace/routes.ts` | after a subscription payment the listing rule runs at once (same transaction for a gateway payment; best effort for a zero-amount checkout) |
| `apps/listings/backend/listing.service.ts` | **the Listings limit of the edition is now what counts on apps** (it was still the old plan's number): adding a listing, the "used of cap" figures, and publishing by hand (refused when it would put more on the website than the edition shows) |

## Found while doing it (not fixed here; in `docs/LAUNCH-CHECK.md`)
**No app calls `requireLimit()`.** The catalog's free limits (5 rooms, 100 leads, 20 invoices a month, …) are shown and sold but enforced
nowhere on apps; each app still reads the old plan's limits. Listings is fixed in this change; the other apps are not. Until they are, a
free business is not actually stopped at its free limits, so nothing makes it pay.

## Done on the real data (16 Nov, about 22:16; backup `2026-11-16_2215` just before)
`npm run billing:free -- --business=cmvz5otxn0007uoagt4l7h995 --apply` (Sheetal Property): plan `agency-pro` → `agency-starter`; 14 apps to
their free edition; Mail expired (no free edition); 6 grants revoked; the price lock removed; **2,592 of its 2,595 published listings
paused**, 3 stay; 22 sold and 63 rented untouched. The public website now has 90 listings (it had 2,682). "hotel nepal", which its Pro
covered, followed to `hotel-starter`.
Rehearsed first on a scratch copy of the same data.

**To undo for a business:** raise its Listings limit (it buys Listings, or staff give a limit grant in Admin → the business → App
subscriptions), then `npm run billing:free -- --listings --apply` or wait for the hourly job: the paused listings return. Note the full
edition allows 500: with 2,595, a grant or listing packs are needed for the rest. Full undo: restore backup `2026-11-16_2215`.

## Tests
`backend-core/test/listing-limit.test.ts` (11, database): which listings stay; nothing else touched; idempotent; partial and full way back;
a listing a person changed is left alone; limit 0; a business on plans never touched; the free-tier move (dry run, refusals, apply, again,
paying brings exactly the paused ones back). backend-core 219/219; typecheck of backend-core, business API, admin API, Listings app green.
Not re-run: the full business, admin and website API suites.
