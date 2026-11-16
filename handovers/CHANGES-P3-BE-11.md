# CHANGES P3-BE-11: free website posting, no "verified" in public, "Start free"

Phase 3, stage 12. MB section 0 (posting free; checked posters publish at once; the public site never says "verified") and 8.6 (old answers
until a business moves). Back end plus three small text removals on today's website.

## What changed
| File | What |
|---|---|
| `platform/src/settings/posting.ts` (new) + `defs.ts` | typed setting **`platform.posting`**: `fairUse.perDay` (5), `fairUse.perDayChecked` (20), `checkedGoLive` (on). Admin → Settings, group "website" |
| `website/backend/src/modules/posting/routes.ts` | `POST /post-property`: fair use per person per Nepal day (429 `posting_fair_use`); a business Sheetal checked (`Tenant.verification = verified`) publishes at once (published, checkup date, audit `listing.published`, no review notice); others wait for review as before. **The plan's listing limit now applies only to a business still on `billingMode = plans`** |
| same | new `POST /start-free` `{ app?, type? }`: the person's business (where they manage billing) or a new free one, and the link `/business/marketplace?app=…` (the page itself comes with FE-1). Refuses an app that isn't live. `/subscription-plans` answers as before plus `moved_to: "/v1/public/catalog"` |
| `website/backend/src/modules/catalog/present.ts` | **`is_verified` removed** from every public business card (agent list, agent detail, every listing's `agent`) |
| `website/frontend/src/pages/Agencies.jsx`, `AgencyProfile.jsx`, `components/Layout.jsx`, `pages/Requirement.jsx`, `utils/format.js` | the "Verified" badge, "Verified local agencies", "Verified buyer" and the old "Verified badge" plan line removed |

## One old test changed (said plainly)
`website/backend/test/catalog.test.ts` "shows the agency's own address and website": its two lines expected `is_verified` false, then true. The
owner's fixed rule says public pages never say "verified" or "not verified", and PHASE-3-TASKS names this test as updated by BE-11, so the two
lines now expect **no `is_verified` field** before and after the check. Every other old test is unchanged (`write.test.ts` "holds Starter to one
listing" still passes: that business is on `plans`).

## Kept on purpose
- `/subscription-plans` and `/request-upgrade` still answer: today's website Plans page uses them and every business is on `plans`. FE-5 replaces
  the page with the public catalog; then the routes can go.
- A new website user still gets a Starter business on `plans` (so the one-listing limit stays for them until businesses move).

## Tests (`website/backend/test/posting-free.test.ts`, 10, database)
On `apps` the old Starter limit is gone and posts wait for review; the 6th post of the day is refused (429 with the limit); a checked business
publishes at once with an audit line and the answer never says why; checked businesses get the higher limit; staff can change the limits; a
business on `plans` keeps its limit; Start free creates a free business or uses one's own, refuses coming-soon and unknown apps and needs a login;
the old plans list points to the catalog; **a scan of 11 public answers** (agent list and detail, listings, search, featured, catalog, plans)
finds no "verif…" and no PAN.

## Owner
Hand test after RUN-UPDATE: open the website's Agencies page: no "Verified" badge. Admin → Settings → "Free posting on the website" shows the limits.
