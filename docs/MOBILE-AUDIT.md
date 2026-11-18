# Mobile audit: sheetalproperty.com on a phone

Date: 18 Nov 2026. Method: the live site opened at 390 x 844 (every page loaded in a 390 px frame, then measured: page height, number of tappable things, how many are smaller than 44 x 44 px, footer links), plus a read of the code. Design only: nothing in the website code was changed.

## Measured numbers (390 px wide)

| Page | Height (px) | Tappable | Under 44 px | Footer links |
|---|---|---|---|---|
| Home / | 12,998 | 87 | 53 | 28 |
| Search /search, Buy /sale | 6,422 | 77 | 64 | 28 |
| Rent /rent | 6,444 | 77 | 64 | 28 |
| Stays /stays | 3,035 | 51 | 38 | 28 |
| Projects /project | 3,065 | 51 | 38 | 28 |
| Invest /investment | 3,058 | 51 | 38 | 28 |
| Map /map | 4,774 | 75 | 45 | 0 |
| Post a property | 1,380 | 39 | 28 | 28 |
| Requirement form | 2,186 | 54 | 28 | 28 |
| Buyer requests board | 4,908 | 59 | 48 | 28 |
| Partners | 1,901 | 43 | 30 | 28 |
| Apps | 5,239 | 85 | 43 | 28 |

No page scrolls sideways (good). The same footer (28 links) is on every page. Live data today: 147 sale and 438 rent listings in the public API, 2 agencies, no paid banners, a "sponsored: home" flag on featured items.

## Route by route: what is bad on a phone, and what to keep

A. Home /: bad: the hero (title, tabs, pickers, big button, type tiles) pushes banner and listings down; 13,000 px long; 28-link footer. Keep: the row order (featured, buy, rent, stays, projects, invest, cities, agencies, journal), "Sponsored" banner logic, skeleton rows.
B. Search, Buy, Rent, Featured, Properties: bad: 384 px cards, numbered pages, filters in one block under a button, no visible sort, no map or list switch. Keep: counts beside every choice (GET /search/facets), the keyword box (#code), price quick ranges, property type list.
B2. Stays, Projects, Invest (Catalog): bad: same Filters block, sort as a dropdown, 4 cards then a long footer. Keep: the extra filter groups (guests, must-have, cancel, handover, bank, return, term, risk).
C. Map: bad: 372 px map, then a 4,760 px page with source buttons and numbered pages; no bottom card. Keep: sources, S, R, I badges, boundaries, approximate sale and rent areas, exact stays.
D. Listing page: bad: 280 px photo grid, Call, WhatsApp and Contact sit in the page body, forms are inline and long. Keep: details list, amenities, area map, reviews with replies, Ask AI, similar properties.
E. Stay detail and booking (/stays/:id, /book/:id): bad: web layout, long form on one page. Keep: rooms, perks, policy, payment methods (eSewa, Khalti, Fonepay, bank), booking code.
F. Project and reserve: bad: tables and unit grids made for wide screens. Keep: unit states, token reserve, bank finance.
G. Invest: bad: small controls for amounts. Keep: raised vs target bar, "Returns are not guaranteed", Rs 10,000 minimum.
H. Account, 12 profile tabs: bad: tabs run off the screen; settings are one long page. Keep: the tab content, Google sign-in, verify and reset pages.
I. Post a property: bad: web form with dropdowns; photo step is small. Keep: the 5 steps and fields.
J. Requirement and board: bad: very long form; board filters hidden. Keep: fields, board cards, "offer a property" for agencies.
K. Services: bad: not measured (a 403 came back when many pages were loaded at once; it is a rate limit, not a page fault). Keep: five services and their forms; Pay rent by code and mobile number.
L. Tools and Rates: bad: wide chart and fields. Keep: 10 calculators, unit tables, sale or rent switch.
M. Journal, Careers, About, Gallery, Offers, Help, Legal, Contact, Apps: bad: reading width is fine but the footer and header repeat; Apps is 5,239 px. Keep: the content.
N. Special pages (/sign, /f, /pay, verify, reset): bad: they still carry the site chrome in places. Keep: they open without header and tab bar already (sign, f).
O. Always present: bad: the round WhatsApp button covers cards and will cover any sticky bar; the cookie notice, maintenance and toast areas are not designed as one system.

## The 20 worst problems (in order)

1. Home is 12,998 px long (about 15 screens). Target: about 5.
2. The hero takes the first screen; banner and listings are below the fold.
3. A 925 px footer with 28 links on every page; an app has no footer.
4. 53 to 64 tappable things on each page are smaller than 44 px.
5. Filters are one block under a button; no bottom sheet, no live "Show N results" bar.
6. No visible sort on results.
7. No Map or List switch on results; the map is a separate page with its own long scroll.
8. Numbered pages instead of infinite scroll.
9. Result cards are 384 px tall with one photo; no swipe, no heart on the photo.
10. The listing action buttons (Call, WhatsApp, Enquire) are in the page, not in a bar that follows.
11. The photo grid is 280 px high; no full-screen viewer with pinch zoom.
12. The WhatsApp round button floats over content and will cover sticky bars.
13. The hamburger menu is a flat list, with no groups and no descriptions.
14. Body text is 14.5 px; some labels are smaller than 12 px.
15. Profile has 12 tabs in a row; settings is one long page.
16. Long forms (post property, requirement, booking) are single pages with dropdowns; not one idea per screen.
17. No manifest, no install, no offline page, no pull to refresh.
18. Banner is behind the hero with a shade; there is no house banner when none is paid, so the slot is empty today (the API returns zero banners).
19. Numbers and money are not always tabular, so prices jump in lists.
20. Sold and Rented tags rely on colour in places; status needs an icon and words.

## Keep list (do not lose these)

Poppins and the five logo colours; en-IN money (Rs. 1.25 Cr); approximate sale and rent locations; "Returns are not guaranteed"; no owner phone in lists; the only public brand is Sheetal Property; filter counts from the API; property code search (#SP-0006); the three themes (Light, Dark, Red).

## Code facts the design follows

- Routes in website/frontend/src/App.jsx; /stays/:id, /project/:id, /investment/:id, /book, /reserve, /invest, /pay, /offers, /help, /legal are served by PlatformApp (market/*).
- Listing fields from the API: property_code, name, price, price_per ("month"), property_location, district, bedroom, bathroom, floors, property_area (text such as "9 Aana"), road_access, thumbnail, feature_image, location_approximate (true), sold, sponsored.
- Price format: fmtPrice in utils/format.js gives "Rs. 2.25 Lakh" and "Rs. 1.5 Cr"; the design adds the grouped full price for rents (Rs. 25,000 / month).
- Counts and suggestions: GET /search/facets and GET /search/suggestions?q=.
- Colour tokens: shared/src/styles/theme.css (light, dark, red).
