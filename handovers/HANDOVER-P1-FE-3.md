# HANDOVER P1-FE-3
Specialist: Frontend
Phase / step: Phase 1, step 9 (front-end packages), task P1-FE-3
Status: done (not yet run by CI or clicked through in a browser; see CHANGES "Not run here")

## What I did
- Built `ReviewsPage` in `apps/reviews/frontend/` on `CrudPage` (cards, read-only): stats and star breakdown from `meta`, filter chips, `ReviewCard` with `ReplyBox`. Texts are the old ones.
- Replies send `{ text, version }` via `saveFlow.js`; 409 shows "Someone changed this. Reload to see the latest." and reloads; empty text removes the reply; the box shows only with `meta.canReply`.
- Moved `Stars` into `packages/ui` (`@sheetal/ui/stars`). The website's own `Stars` is not a drop-in, so it is untouched.
- Small kit additions: `renderCard` also gets `meta` and `api`; `list.gridClass`; `resource.empty` may be a function of the filters; `resource.loadingText`.
- Wired `/business/reviews`, `exports["./frontend"]`, the Vite alias; removed `LiveReviews.jsx` and `LiveExpenses.jsx` (search in CHANGES).
- 20 new tests (resource, chips → query, reply body with version, 409, remove, canReply, Stars).

## Files delivered (repo paths)
See CHANGES-P1-FE-3.md "Files". Two files must be **deleted** by the Lead (a zip cannot do it): `business/frontend/src/pages/LiveReviews.jsx`, `business/frontend/src/pages/LiveExpenses.jsx`.

## Commands the owner must run (PowerShell, in order)
1. `git checkout main; git pull; git checkout -b phase-1/P1-FE-3-reviews-page`
2. `Expand-Archive -Path "$HOME\Downloads\OUT-P1-FE-3.zip" -DestinationPath . -Force`
3. `git rm business/frontend/src/pages/LiveReviews.jsx business/frontend/src/pages/LiveExpenses.jsx`
4. `npm install`
5. `npm run check`
6. `npm run build`

## How to check it worked
- `npm run check` and `npm run build` green; `git grep -nE "LiveReviews|LiveExpenses"` shows only comments.
- Hand test in CHANGES-P1-FE-3.md (filters, post / edit / remove, two-tab 409, listing link, owner vs read-only, branches, 3 themes, 375 px).

## Not done / open questions
- Not run: install, full check, build, tsc, database, real API, browser. CI is the first full run.
- For the Lead: add `@sheetal/app-reviews` (and `@sheetal/app-expenses`) to `business/frontend/package.json` dependencies if wanted (changes the lock file); the Vite aliases work without it.
- Website `Stars` left alone on purpose (CHANGES "Stars and the website").
- Differences from the old page (empty-state second line now visible, error panel on a failed load, 1500-character cap): CHANGES.

## Next task (for which specialist)
- Not named in my brief. Likely next on the kit: a page with a form (Team, Branding or Forms) for Frontend; files that chat would need: this zip's contents after merge, the page's `Live*.jsx`, its app's `backend/` shapes and a sample answer.
