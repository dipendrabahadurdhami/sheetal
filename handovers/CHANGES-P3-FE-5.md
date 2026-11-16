# CHANGES P3-FE-5: website Apps and Pricing pages

Phase 3, stage 17. MB section 14.4, on `GET /v1/public/catalog` (BE-1) and `POST /v1/start-free` (BE-11). Public pages; nothing is sold here.

## New pages (website, Vite today: the Next.js move is a later task, so these are React pages like the rest of the site)
| Path | What |
|---|---|
| `/apps` | every app card: name, tagline, Free / "from Rs x a month", trial, **Start free**, See editions; "Coming soon" apps can't be started |
| `/apps/:id` | one app's editions side by side: a month, a year with "You save n months", every free limit, every feature; Start free |
| `/pricing` | every live app in one table (free edition, full price a month and a year, trial, Start free), seats, add-ons, Sheetal AI plans, coming soon |

**Start free**: a signed-out visitor signs in first; then `POST /v1/start-free` picks the person's business (or makes a free one) and the browser opens
`/business/marketplace?app=<id>` (the FE-1 drawer). Each page sets its own title and description (SEO).

The old `/plans` page and its menu links stay until the move to apps is signed off ("go back: keep the old plans page until QA signs off").
At the cutover (OPS-2): point the menu's "Agency plans" links to `/pricing`, then retire `/plans`, `/subscription-plans` and `/request-upgrade`.

## Files
`website/frontend/src/components/AppCatalog.jsx` (AppCard, EditionsTable, PricingTable, useStartFree), `pages/Apps.jsx`, `pages/Pricing.jsx`,
`App.jsx` (3 routes), `api/endpoints.js` (`catalog`, `startFree`), `components/appCatalog.test.jsx`.

## Tests (build time, on the real catalog: `publicCatalog(seedCatalog())`, the same function the API answers with)
`appCatalog.test.jsx` (7): every price on the cards, edition tables and pricing table equals a catalog number formatted from paisa; "from" is the
cheapest paid month and yearly saves 2 months; the rendered HTML and the page sources never say verified (English or Nepali), never show a PAN, never
name the company behind the technology; only public fields in the catalog; Start free only for live apps; titles and descriptions; routes; sign in first.
Run on the owner's PC: website front-end 7/7, lint, website build.

## Hand test (signed out)
Open `/apps`, `/apps/hotel` and `/pricing`: prices match Admin → Pricing. Click Start free → sign in with a test account → the business panel opens
the marketplace on that app.

## Go back
Revert, or remove the three routes; `/plans` never went away.
