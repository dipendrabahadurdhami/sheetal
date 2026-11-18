# Mobile app hand-off: from design to code

Date: 18 Nov 2026. Design only so far: nothing in the website code was changed.
Where the designs are (all private artifacts): see the list at the end.

Read this with docs/MOBILE-AUDIT.md (what is wrong today) and docs/MOBILE-APP-PLAN.md (screens, build order, PWA decision).

## How to read the tables

- Reuse = keep the existing React component or page and restyle it.
- Replace = build a new component in the app shell; retire the old one on phones.
- New = nothing like it exists yet.
- API: names are the calls in website/frontend/src/api/endpoints.js. Calls for stays, projects, investments, booking, reserve and invest live behind market/PlatformApp.jsx and the shared core; they were not listed in endpoints.js, so the table says "market API (confirm)". Confirm each one against the backend before building.

## 1. App shell (new)

| Screen | Today | Action | API |
|---|---|---|---|
| Top bar, tab bar with raised Post, safe areas | components/Layout.jsx (Header, TabBar) | Replace on phones. Footer removed on phones. | none |
| Side menu (accordion, 5 groups) | Layout.jsx "More" flat list | Replace | counts: GET /search/facets (Buy 147, Rent 438 are live numbers) |
| Sheet layer, toasts, offline bar | none | New | none |
| Manifest, icons, service worker, offline page | none | New | none |
| Pull to refresh | none | New | reloads the current screen's calls |

## 2. Home (H1 to H6)

| Screen | Reuse or replace | API | Fields | New |
|---|---|---|---|---|
| Compact search pill and type chips | Replace HeroSearch.jsx on phones | none | chip sets the search type | none |
| Banner carousel (3, 1, none) | Reuse the banner data, new card | GET /banners; POST /banners/seen, /banners/click | b.mobile, b.title, button text, link | House banner shown when the list is empty (live today: zero banners) |
| Quick grid (8) | New | none | fixed list | none |
| Featured, Buy, Rent rows | Reuse Home.jsx rows, new compact card | GET /featured-property-list, GET /sale, GET /rent | name, price, price_per, thumbnail, property_location, sponsored, sold | one compact card |
| Stays, Projects, Invest rows | Reuse | market API (confirm) | rating, perks, raised, target, return, term, risk, minimum | none |
| City tiles | New | GET /search/facets per city for counts | name, count | five city photos |
| Buyer requests (3 cards) | Reuse | GET /property-demand-list | requirement, purpose, budget, facilities (never phone or email) | none |
| Agencies near you | Reuse | GET /agent-list | name, count | none |
| Journal (3) | Reuse | GET /blog?per_page=3 | title, image, category | none |
| Rates mini chart | Reuse RatesTrends data | rates source (confirm) | area, price per aana | none |

## 3. Search and results (S, R)

| Screen | Action | API | Notes |
|---|---|---|---|
| Full-screen search, recent, popular | New | GET /search/suggestions?q= | recent searches stored on the phone first |
| Grouped suggestions (Places, Properties, Stays, Projects, Pages) | Replace HeaderSearch.jsx | GET /search/suggestions | today the call returns suggestions; check it returns groups and the matched text. If not: new grouping on the server. |
| Code search #SP-0006 | Reuse | GET /property-by-code/:code | |
| Results list and grid, infinite scroll | Replace Listings.jsx pagination | GET /search (page, per_page) | use the 400 px thumbnail |
| Filter chips and sheets | Replace SearchFilters.jsx layout, keep its groups | GET /search/facets (live counts) | PRICE_RANGES come from SearchFilters.jsx |
| All-filters sheet with "Show N results" | New wrapper over the same filter state | GET /search/facets | count updates as each chip is tapped |
| Sort sheet | New | GET /search (sort param) | Newest, Price low to high, Price high to low, Oldest |
| Save search and alerts | New | none exists | needs saved_searches (see section 9) |
| Empty result with removable chips | New | GET /search/facets (counts if one filter is removed) | |

## 4. Map (M)

| Screen | Action | API | Notes |
|---|---|---|---|
| Full-screen map, chips, clusters, bottom card | Replace MapSearch.jsx page layout; reuse LocationMap.jsx | GET /map-pins | keep location_approximate: draw a soft circle for sale and rent, an exact pin for stays only |
| List sheet, Search this area | New | GET /map-pins with a bounding box | the endpoint takes no box today (see section 9) |
| Near me | New | browser geolocation | permission screen first |

## 5. Listing (L)

| Screen | Action | API | Fields |
|---|---|---|---|
| Gallery, viewer | Replace the grid in PropertyDetail.jsx | GET /property-by-slug/:slug or /property-detail/:id | feature_image, images, 940 px in detail |
| Price, tags, facts strip | Replace | same | price, price_per, bedroom, bathroom, property_area, road_access, property_code, sold |
| Amenities, details, similar | Reuse | same; similar from GET /search | |
| Area map circle | Reuse LocationMap.jsx | same | lat, lng, location_approximate |
| Reviews with business reply | Reuse | GET /reviews-public; POST /reviews | |
| Enquire, Schedule a visit sheets | Replace Forms.jsx layout | POST /contact-agent, /contact-owner, /schedule-tour | check +977 and the 98 or 97 start in the form |
| Ask AI sheet | Reuse AskAi.jsx | POST /ask-ai (property_codes, question) | |
| Sticky Call, WhatsApp, Enquire | New | none | the number comes from settings, never from the listing |
| Report, Share | New | report endpoint (confirm) | |

## 6. Stays, projects, invest

All go through market/PlatformApp.jsx. Screens: stay detail and rooms, booking steps, payment (eSewa, Khalti, Fonepay, bank with proof), confirmation, my bookings; project detail, units grid, reserve, receipt; investment detail, invest amount, receipt, my investments. Action: restyle for phones and split long pages into steps. API: market API (confirm), plus payment through market/PayScreen.jsx. New: add to calendar (a downloadable .ics), a payout table for invest (computed on the phone from rate and term).

## 7. Post, requirement, account

| Screen | Reuse or replace | API |
|---|---|---|
| Post wizard (5 steps, one idea each) | Replace PostProperty.jsx layout, keep its fields | POST /post-property/ (multipart); drafts: new |
| Photo picker, reorder, cover | New | same multipart |
| Requirement stepper (7 steps) | Replace Requirement.jsx layout | POST /requirement-form, /agent-requirement-form; GET /requirement-fee/settings-public |
| Board, chart, detail, offer | Reuse Demands, DemandDetail | GET /property-demand-list; POST /demand-match |
| Sign-in sheet, register, forgot, verify | Replace AuthModal.jsx layout | POST /login, /register, /forgot-password, /reset-password; GET /email/verify/:token; Google: /google-signin |
| Account hub, settings (6 areas) | Replace Profile.jsx tabs | GET /user-info; POST /update-profile, /change-password; GET /user-favourites-list, /user-property, /agent-notifications; POST /add-to-favourite, /remove-from-favourite |
| Theme and language | Reuse the existing theme and i18n | none |

Phone sign-in is not built, so it is not designed. Google sign-in appears only after the owner finishes the Google setup.

## 8. Services, tools, content, special

Services (home loan, legal, management, pay rent, valuation): reuse ServicePages.jsx data, new step layout; pay rent uses POST /rent/find, /rent/mine, /rent/pay. Tools and rates: reuse Tools.jsx and RatesTrends.jsx logic; new big-field layout; share via the phone share sheet. Journal: GET /blog, /blog/:slug, /blog/categories, POST /blog/:id/comment. Careers: GET /jobs, /jobs/:slug, POST /jobs/:slug/apply. Special pages: /sign/:token (GET /sign/:token, POST /sign/:token/code, POST /sign/:token), /f/:slug (GET and POST /forms/:slug), /pay/:code (market API). These already open without header and tab bar; keep that.

## 9. New API needs

1. Saved searches with alerts: POST/GET/DELETE /saved-searches; a job that finds new matches.
2. Push alerts: store a device token, send through web push first.
3. Suggestions grouped by type with the matched range, if /search/suggestions does not return that today.
4. Map pins by bounding box and by zoom (clusters), so "Search this area" is fast.
5. Draft listings: save and resume a post-property draft before submit.
6. Recent and popular places: popular can be a static list at first.
7. Report a listing: POST /report.
8. Counts per city for the Home city tiles (a light GET /search/facets call).
9. Add a stay booking as a calendar file (.ics) from the confirmation.
10. A single "app config" call for house banner copy, WhatsApp number and maintenance message, so the shell does not hard-code them.

## 10. Rules the code must keep

- Only brand name on public screens: Sheetal Property. No PAN. Never "verified" (use "checked" at most).
- Sale and rent locations are approximate (location_approximate true): circle, never an exact pin. Stays are exact.
- No owner phone or email in lists; contact through Call, WhatsApp and Enquire. Buyer requests never show phone or email.
- Investments always show "Returns are not guaranteed".
- Sheetal contact: +977 980-1136817, info@sheetalproperty.com, Kathmandu.
- Money: Rs. 1.25 Cr, Rs. 45 Lakh, Rs. 25,000 / month (utils/format.js; add an en-IN grouped full price for rent).
- Colours: only the logo's five. Primary button fill is Crimson. Red is for icons, hearts and active bars. In dark, muted text is a light silver-white mix, not plain Silver.
- Tap targets 44 x 44; text 12 px minimum; skeletons not spinners; Nepali line height 1.6.

## 11. Suggested first build slice

Shell (tab bar, top bar, sheets, offline bar, manifest) then Home (with house banner), full-screen search, results with filter sheet, and the listing page with the sticky bar. That is the money path from a visitor to an enquiry.

## 12. The design artifacts

1. A1 Design system: https://claude.ai/artifact/AzkHKb6jHkDMEpvyXbipYg
2. A2 Home, Search, Results, Map: https://claude.ai/artifact/L6HsNDspZBFGEKLZdbabik
3. A3 Listing, Stays, Projects, Invest: https://claude.ai/artifact/2aPT7kEp4J7V76LweP9W23
4. A4 Post, Requirement, Account: https://claude.ai/artifact/GrGd55GTqiHsJSjLfYDKDP
5. A5 Services, Tools, Content, Special: https://claude.ai/artifact/RKEpbr6m1ADwr3FHKProm5
6. A6 Navigation and states: https://claude.ai/artifact/GHj1bW7ygZZZvwZG1NiUjc
7. A7 Prototype: https://claude.ai/artifact/QkiUAFoLo17Z2uBGuNusHr

All are private to the owner's account until shared.

## 13. Known gaps in the design (not yet drawn)

- Full-screen photo viewer is only in A1; careers detail, gallery and offers pages are not drawn on their own.
- Stay search with the calendar and guest sheets is drawn in A1 (components) but not as a full results flow.
- Sample data: project, investment and stay names and numbers, rates figures, calculator examples and the privacy wording are placeholders.
- None of the artifacts were opened in a browser to check how they render; the prototype's buttons were not tested.
