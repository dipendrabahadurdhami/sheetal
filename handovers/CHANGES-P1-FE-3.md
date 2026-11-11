# CHANGES P1-FE-3: Reviews page on the kit

Branch: `phase-1/P1-FE-3-reviews-page` · Specialist: Frontend · Status: built and tested here; **CI is the first full run** (see "Not run").

## What changed, in plain words
- Business → Reviews is now `ReviewsPage` (`apps/reviews/frontend/`): a `CrudPage` in card layout, read-only. Stat cards (Average with stars, Reviews, Waiting for a reply) and the "Stars" breakdown come from the server's `meta`; chips **All / Waiting for a reply / 1 or 2 stars**; one card per review with the reply box.
- **Every reply carries the review's `version`** (post, edit, remove), through the same `saveFlow.js` as Expenses. A stale one (409) shows **"Someone changed this. Reload to see the latest."** and reloads once. Nothing is retried. What you typed stays in the box.
- The reply box shows only when `meta.canReply` is true. Without it a person sees the reviews and any reply already there, no box, no Edit / Remove.
- A listing review shows the listing's **code, title and public link** (opens in a new tab); a business review says "About your business".
- `Stars` is now one component in `packages/ui` (`@sheetal/ui/stars`): read-only (label "3.5 out of 5 stars", rounds to the nearest star) or pickable (five radio buttons).
- `/business/reviews` shows `ReviewsPage` when the business is live. `LiveReviews.jsx` and `LiveExpenses.jsx` are deleted.
- No "all branches across the business" choice is added: the page uses only the branch drop-down at the top (the server caps reviews at the branch).

## Texts
Copied from `LiveReviews.jsx`: page title and sub, stat labels, "Stars", chip words, "Loading reviews…", "No reviews yet" / "Nothing here" with their lines, "Your reply by … · date", Edit, Remove, Post reply / Save reply / Cancel, the placeholder, "Reply to <name>". Toasts are the server's messages ("Reply posted. It shows under the review on the website." / "Reply removed.").

## Differences from the old page (please read)
1. The empty-state **second line now shows** ("Reviews people leave on your listings…", "Try another filter."). The old page passed it in a way the component ignored, so it never appeared.
2. A failed load shows an error panel with "Try again" (before: a toast and an empty list).
3. The filter chips sit inside the list panel, and the Stars breakdown is above it, as before.
4. The reply box stops at 1500 characters (the server's limit) instead of failing after Post.
5. Listing reviews also show the listing code (new, asked for in the task).
6. After a successful reply the whole list reloads from the server (as before).

## Files
New: `apps/reviews/frontend/{index.js, pages/ReviewsPage.jsx, components/{ReplyBox.jsx, ReviewCard.jsx, replyLogic.js}, resources/review.jsx, resources/review.test.js}`, `packages/ui/src/Stars.jsx`, `packages/ui/src/Stars.test.js`.
Changed: `apps/reviews/package.json` (`exports["./frontend"]`; `test` script now `vitest run --passWithNoTests backend`, as for Expenses), `apps/expenses/frontend/pages/ExpensesPage.jsx` (header comment only), `business/frontend/{vite.config.js, src/pages/BusinessApp.jsx}`, `packages/ui/{package.json (exports["./stars"]), src/index.js, src/crud/CrudPage.jsx}`, `shared/src/styles/platform.css` (appended), `docs/architecture/FRONTEND-KIT.md` (section 11).
**To delete (a zip cannot carry a deletion):** `business/frontend/src/pages/LiveReviews.jsx`, `business/frontend/src/pages/LiveExpenses.jsx`, e.g. `git rm business/frontend/src/pages/LiveReviews.jsx business/frontend/src/pages/LiveExpenses.jsx`.
Not touched: `*.generated.*`, any backend file, `package-lock.json`, `business/frontend/package.json` (the dependency line is for the Lead).

### Search before deleting
`grep -rnE "LiveReviews|LiveExpenses"` over every `.js .jsx .ts .tsx .mjs .cjs .json` in the repo (excluding node_modules) found only: the two files themselves, and comments in `packages/ui/src/crud/exportCsv.js`, `packages/sdk/src/hooks.js`, `apps/reviews/frontend/resources/review.jsx` (history notes, no import). `BusinessApp.jsx` was the only importer and now imports `ReviewsPage` / `ExpensesPage`. The Lead should repeat the search on the real branch (`git grep -nE "LiveReviews|LiveExpenses"`).

## Stars and the website
**The website is left alone.** Its `Stars` (`website/frontend/src/components/ui.jsx`) uses another icon library, the `.stars` CSS class and a different prop name (`value` is the same, but it has no labels, no keyboard buttons and fills with `currentColor`). Pointing it at the new one would change how the public pages look, so it is not a drop-in. Moving it later is a separate small task.

## Commands (PowerShell, from the repo root)
```powershell
git checkout main; git pull; git checkout -b phase-1/P1-FE-3-reviews-page
Expand-Archive -Path "$HOME\Downloads\OUT-P1-FE-3.zip" -DestinationPath . -Force
git rm business/frontend/src/pages/LiveReviews.jsx business/frontend/src/pages/LiveExpenses.jsx
npm install
npm run check
npm run build
```
Then `npm run dev` and open http://localhost:5173/business/ → Reviews.

## Not run here (be plain)
- `npm install`, the full `npm run check`, `npm run build`, `tsc`, a database, the real API, and a browser. Here I ran: root Vitest for `apps` and `packages` (128 pass, 20 new in this task: 16 Reviews, 4 Stars), ESLint on `apps`, `packages`, `business/frontend` (clean), `scripts/check-boundaries.mjs` (ok), and server-side renders of the whole page fed with `samples/GET-reviews.json` (as owner: stats, star breakdown, code, link, Post reply, saved reply; as read-only: no box, reply still shown). Clicking, typing and the two-tab stale test were **not** done; the hand test below is the first real use.
- I did not see `review.service.ts`, so I rely on the sample: a stale or missing `version` gives 409 / is accepted as written in `schemas.ts`.

## Assumptions to confirm (Lead)
1. The role-level guard stays in `BusinessApp.jsx` (`reviews.reply` or `customers.view`); the page itself uses `meta.canReply` only.
2. The listing link `/property/<slug>` is on the same host as the Business panel (as before).
3. Nepali: no new `kit.*` text in this task; the page is English only, as before.

## Hand test for the Lead (about 10 minutes, owner's browser)
Business with at least one listing review, one business review, one answered and one unanswered. Do it as **owner**, then as a role that can read but not reply (**agent**; if no such role exists, say so).
1. **Numbers:** Average (with stars), Reviews, Waiting for a reply match the list; "Stars" bars add up.
2. **Filters:** All → Waiting for a reply → 1 or 2 stars. Each changes the list; on a filter with nothing: "Nothing here / Try another filter." A business with no reviews: "No reviews yet" and its line.
3. **Post:** type a reply → Post reply (button off while empty) → toast "Reply posted…", the card shows "Your reply by <you> · <date>".
4. **Edit:** Edit → text appears in the box → change → Save reply; Cancel puts it back.
5. **Remove:** Remove → toast "Reply removed."; the box is back; "Waiting for a reply" went up by one.
6. **Stale reply (409):** open Reviews in two browser tabs. Reply in tab A. In tab B (not reloaded) reply to the same review → toast **"Someone changed this. Reload to see the latest."**, list reloads, your typed text is still in the box if the review had no reply. Repeat with Remove.
7. **Listing review:** shows the code (e.g. SP-1042), the title as a link; it opens the public page in a new tab. A business review says "About your business".
8. **Agent:** reviews are listed, replies already there are shown, **no box, no Edit, no Remove**.
9. **All branches vs one:** the only branch control is the one at the top; picking a branch reloads the list. No extra "whole business" choice appears on this page.
10. **Look:** light, dark, red theme: stars are gold, text readable, cards have a border.
11. **375 px:** one column of cards, the reply box fills the card, Post / Save / Cancel / Edit / Remove are 44 px high and reachable with a thumb, the chips wrap, the Stars panel fits.

## Lead fixes after QA (11 Nov)
1. `business/frontend/package.json` depends on `@sheetal/app-reviews`; lock refreshed.
2. `LiveReviews.jsx` and `LiveExpenses.jsx` deleted; `git grep` leaves only comments and docs (two stale code comments updated: `apps/expenses/backend/routes.ts`, `business/frontend/src/pages/Sector.jsx`).
3. Full-file replacements checked against main: `BusinessApp.jsx` changes only the import and the `/business/reviews` line; `platform.css` only gains 18 lines at the end.
4. **Remove now asks first** with the app's Confirm dialog: "Remove your reply?" / "Its text is deleted." / Remove (`REMOVE_CONFIRM` in `replyLogic.js`, tested).
5. A reply to a review that was hidden or removed meanwhile (404) shows the server's words and reloads, so the card goes away (tested).
