# PROMPT: design the Sheetal Property mobile app (website first)

Paste everything below this line into a new chat. The new chat is already connected to the `sheetal` project (the repository on this PC and the live site).

---

You are the product designer and front-end lead of **Sheetal Property**, a property marketplace for Nepal that is **live at https://sheetalproperty.com**. Your job: design the **customer website as a real mobile app**. Not a smaller copy of the desktop site. A full app, made the way eSewa and bank apps are made (clear, big, fast, few steps) with the search and listing quality of Booking.com, Airbnb and Google.

## 0. How you work with me (read first)

- **Do not ask me questions.** Everything you need is in this prompt, in the repository and on the live site. When two good options exist, pick one, write one line saying why, and go on. Ask only if you are truly blocked (for example a file is missing).
- I am the owner. English is my second language. When you talk to me: short sentences, plain words, numbered steps, one thing at a time. Show progress as percentages.
- Work in this order and **do the whole of each stage before you stop**: audit, plan, design system, screens, prototype, hand-off. After each stage give me a short report and the link to the artifact. Do not wait for my approval between stages; I will say "change X" if I want a change.
- This chat is **design only**. Do not change the live website code. Do not commit anything. Never put an AI credit line in any file or commit (owner's rule).
- Scope now: the **public website / customer app only** (visitors, buyers, renters, travellers, investors, owners who post). The business panel (`/business`) and admin panel (`/admin`) come later; leave a "Start a business" door that opens the business panel in the browser.

## 1. Where to make the designs (Claude design artifacts)

Use the **Artifact tool**. Before you write any artifact file, call it with `action: "quickstart"` and `intent: "design"` and follow what it returns (it names the design types and design systems this account has). Load the `artifact-design` skill before writing HTML.

Plan the artifacts like this (one link each, all private; tell me the links):

| # | Artifact | What it holds |
|---|---|---|
| A1 | **Design system** | Tokens, type, icons, every component in all states, light and dark. Phone-frame sized samples |
| A2 | **Flows, part 1: Home, Search, Results, Map** | Screens side by side on a canvas, plus a tappable prototype |
| A3 | **Flows, part 2: Listing, Stay and booking, Project and reserve, Invest** | same |
| A4 | **Flows, part 3: Post property, Requirement, Account and sign-in** | same |
| A5 | **Flows, part 4: Services, Tools, Rates, Journal, Company, Legal, special pages** | same |
| A6 | **Navigation and states** | The side menu open (every group expanded), tab bar, empty, error, offline, loading, permission screens |
| A7 | **One end-to-end prototype** | Home to search to filter to listing to enquiry; and stay booking; and post a property. Clickable, 390 x 844 |

Rules for every design artifact: reference frame **390 x 844** (also check 360 x 780 and 430 x 932), safe areas (top 47, bottom 34), real content (section 8), light and dark side by side, every state of every component. Build it as real HTML and CSS you can reuse later, with the tokens as CSS variables, not as pictures.

## 2. What exists today (I checked the code and the live site at 375 px wide)

**The mobile site today is the desktop site made smaller.** Measured on https://sheetalproperty.com at 375 px:

- The home page is **14,361 px tall**. The footer alone is **925 px with 28 links**. The hero (title, tabs, where, type, budget, big Search button, type tiles) takes most of the first screen, so the banner and the first listings are far below it.
- **115 of 189** tappable things are smaller than 40 px. Body text is 14.5 px.
- There is a bottom tab bar (Home, Explore, a round + for Post, Saved, Log in) and a floating WhatsApp button. A hamburger button exists but its menu is only a flat list.
- Search results: cards 384 px tall, **numbered pagination**, filters hidden behind one "Filters" button that opens a block under it. No sort control visible. No map/list switch.
- Listing page: 7 photos in a small grid (280 px), sections stacked, "Contact / Call / WhatsApp" are in the page body, not in a bar that follows you.
- Stays page: a "Filters" button and a sort dropdown, 4 cards. Map page: a 372 px-high map, then a long page below it (4,760 px) with source buttons and numbered pages.
- No web-app manifest, no install, no offline.

Treat all of that as what to fix. Open the live site yourself in the built-in browser at 390 px width (use the mobile viewport preset), look at **every route in section 5**, and write what is wrong on each in one line. Then read the code (paths in section 11) so your design matches the real data and fields.

## 3. The brand: only the logo's five colours

From `shared/src/styles/theme.css`. **No other hue, ever.** Every other shade is a mix of these five.

| Name | Hex | Use |
|---|---|---|
| White | `#FFFFFF` | light background |
| Silver | `#BCBCBF` | lines, disabled, dark-mode text on slate |
| Slate | `#59595B` | text, dark background |
| Red | `#EA2229` | primary action, active, heart, price accents |
| Crimson | `#9D1D21` | headings accent, pressed, the "red" theme background |

- Proportions: **60 / 30 / 10**. Light: white 60, greys 30, reds 10. Dark: slate 60, white and silver 30, reds 10.
- Three themes exist: **Light, Dark, Red** (crimson background, white text). Design light and dark fully; show red on the design-system artifact.
- Status without new colours: use icons, labels and weight (for example "Sold" and "Rented" as a diagonal or banner label, not green or orange). No green "success", no yellow "warning": use red, slate and silver with an icon and words.
- Font: **Poppins** (display and UI). Weights 400 and 500, 600 for prices and numbers. Use tabular numbers for money.
- Shape: corners **8 px** (cards, buttons, inputs), **12 px** (sheets, large images). Spacing scale 4, 8, 12, 16, 24, 32, 48. Cards are flat with a 1 px line; shadow only on sheets and the raised Post button.
- Logo files: `website/frontend/public/brand/logo-mark.png`, `logo-full.png`. The words under the mark: **SHEETAL** over **PROPERTY**.
- Icons: **Lucide** (already used). One stroke weight, 1.75.

## 4. The app structure (decided: do not ask)

**No website footer anywhere.** Navigation is app navigation.

**Bottom tab bar (5):** Home, Explore (search hub), **Post** (raised centre button), Saved, Account. Always visible except in full-screen flows (photo viewer, checkout, wizard steps, signing).

**Top bar:** left = **menu (three lines)**, centre = logo, right = search and bell. It collapses to a small title bar on scroll (large title that shrinks). Inner screens: back arrow, title, one action.

**The side menu** (opens from the left, 85% width, dim behind, swipe to close). Top: the person card (photo, name, "Log in or sign up" when signed out). Then **expandable groups (accordion, one open at a time, smooth, each row with an icon, a title and a one-line description, count badges where useful)**:

1. **Explore:** Buy, Rent, Stays, Projects, Invest, Map search, Partners and agencies, Buyer requests, Post a requirement.
2. **Services:** Home loan, Legal help, Property management, Pay rent, Property valuation.
3. **Tools:** the 10 calculators (EMI, Land unit converter, Land price estimator, Property tax estimator, Rental yield, Rent vs buy, Affordability, Investment return, Host income, Project payment schedule).
4. **Learn:** Journal (blog), Rates and trends, Gallery, Offers, Help.
5. **Company:** About, Careers, Contact, Apps and pricing ("Free to start, for every business"), Start a business.
6. At the bottom: theme (Light / Dark / Red), language (English / नेपाली), **Chat on WhatsApp**, Call, privacy, terms, data deletion as small text, app version.

Signed in, the **Account** tab is a hub (section 5, group H), not a copy of the menu.

## 5. Every page of the website, and its app version

This is the full inventory from `website/frontend/src/App.jsx` and the pages. Design **every one**. "Today" is what it does on the web; "App" is what you design.

### A. Home (`/`)
Today: hero search with tabs (All, Stay, Buy, Rent, Projects, Invest) and pickers; paid banner carousel ("Sponsored"); type tiles; rows: Featured, Buy, Rent, platform rows (stays, projects, invest), Browse by city (Kathmandu, Lalitpur, Bhaktapur, Pokhara), agencies, journal; "Advertise here", "Boost your listing" links.
The home banner today: paid banners (up to 3) sit **behind the hero title and the big search**, slide every 6 seconds, have a dark shade so the words can be read, a separate **mobile picture** (`b.mobile`) and a desktop picture, a "Sponsored" label, a title, a button ("Learn more"), dots, and small "Advertise here" and "Boost your listing" links to Business, Promote. On a phone the big multi-field search (where, dates, guests, budget, type tiles) plus the title take most of the first screen, so the banner and the listings are pushed far down. **Fix this.**

App, the first screen (844 px high; budget in px, top to bottom, safe area included):
1. **Top bar 56:** menu, logo, search icon, bell.
2. **One compact search bar 52** (a single rounded pill: magnifier, "Search homes, stays, land, projects", a filter icon). **No title, no tabs, no pickers on Home.** One tap opens the full-screen search (section 5B). Under it, a **sideways chip row 40**: All, Buy, Rent, Stays, Projects, Invest (they set the search type; the chip is selected state only). Total about 150 px, not 500.
3. **The banner, right after the search: a 16:7 card about 170 px high, full width minus 16 px margins, rounded 12**, **not behind the search**. Swipe left and right, auto-slide every 6 s (pause while touched), dots inside the bottom edge, "Sponsored" label top-left, title and button on a soft dark shade at the bottom, uses the **mobile picture**. When there is **no paid banner**, show Sheetal's own house banner (for example "Post your property free" or "Pay rent online") so the space is never empty, and never leave a hole. A tiny "Advertise here" link sits under the dots or in the menu, not on the banner. Banner height never changes while loading (reserve the space, show a skeleton).
4. **Quick actions grid 2 rows x 4, about 170 px** (eSewa style: icon on top, 12 px label under): Buy, Rent, Stays, Projects, Invest, Map, Post property, Requirement. Then **"More"** opens the side menu groups. (Services and Tools get their own strip lower down.)
5. After the banner and the quick grid, the **scrolling content**, each a **horizontal card row** with a "See all" link and a skeleton, in this order, and **each section no taller than about 300 px**:
   1. **Featured properties** (hand-picked)
   2. **New for rent**, then **New for sale**
   3. **Stays** (price per night, rating)
   4. **Browse by city** (big photo tiles: Kathmandu, Lalitpur, Bhaktapur, Pokhara, Chitwan)
   5. **Projects** and **Investments** (progress bar)
   6. **Pay rent and services** strip (Pay rent, Home loan, Legal help, Property management, Valuation) as 5 tiles
   7. **Buyer requests** ("What buyers want", 3 cards, "Post a requirement")
   8. **Agencies near you**
   9. **Tools** strip (EMI, Land units, Rent vs buy) and **Rates and trends** mini chart
   10. **Journal** (3 posts)
   11. A closing **"List your property free / Start a business free"** card. The page ends here: no footer.
6. A **second banner slot** (a slim 320 x 100 style strip, labelled Sponsored) between sections 3 and 4 only if a paid banner exists for it; otherwise nothing.
Pull to refresh. Skeletons while loading. The whole home is about 5 screens long, not 17. The WhatsApp button sits in the side menu and in the listing bars, and on Home it is a small button that does not cover the tab bar or a banner. Design the Home in three states: with 3 paid banners, with 1, and with none (house banner).

### B. Search and results (`/search`, `/sale`, `/rent`, `/stays`, `/project`, `/investment/explore`, `/featured`, `/properties`)
Today filters: Purpose (Buy, Rent, Stay, Projects, Invest), Property type (House, Apartment, Land, Flat, Commercial Space, Office Space, Bungalow, Agricultural land, Warehouse, Room, Shutter, plus Hotel, Resort, Villa, Homestay, Cottage, Hostel, Lodge, Guest house for stays), Price with min and max and quick ranges, Bedrooms 1+ to 5+, Category, Availability (Available, Sold out, Rented out), a keyword (locality, city or `#code`), **a count next to every choice** that updates with the other filters. Sort: Newest, Price low to high, Price high to low, Oldest. Stays: where, check-in, check-out, guests, rooms; types; guests; must-have (Free breakfast, Wi-Fi, Mountain view, Lake view, Pool, Spa, Kitchen, Airport pickup, Self check-in, Garden); cancellation (Free cancel, Moderate, Strict); sort Top rated or price. Projects: type, status (Upcoming, Under construction, Ready to move), handover (Ready now, by 2028, by 2029), units left (10+, 50+), bank loan with (Nabil, NIC Asia, Global IME, Laxmi Sunrise). Invest: type, status (Open, Funded), expected return (9%+, 11%+, 12%+), term (up to 3, 4, 5 years), risk (Low, Medium, High), returns paid (Every year, Every 6 months, At exit), from Rs 10,000. Price ranges per kind are in `SearchFilters.jsx`.
App (**this is the most important part: design it like Booking and Airbnb**):
1. **Search entry:** tap the search card, a **full-screen search** opens: input with a clear button, recent searches, popular places (Kathmandu, Lalitpur, Bhaktapur, Pokhara, Chitwan, Nagarkot, Lumbini, Bandipur), "Near me" (permission screen), live suggestions grouped (Properties, Stays, Projects, Investments, Agencies, Pages) with the matched text in bold, property code search (`#SP-0006`).
2. **Results screen:** top = search summary pill (place, type, price) that reopens search; under it a **row of filter chips** that scroll sideways (Purpose, Type, Price, Beds, Availability, Sort, More) each opening a **bottom sheet**; a result count; **List / Grid / Map toggle**; cards with a swipeable photo carousel, heart, tags (For Sale, For Rent, Sponsored, Sold, Rented), price with lakh and crore, location, key facts. **Infinite scroll** with a "Back to top" button, no numbered pages.
3. **All filters sheet:** full-height sheet, groups as collapsible sections with the counts, price as min/max fields and quick-range chips (and a simple range slider), toggle chips for multi-choice, **sticky bottom bar: "Clear all" and "Show 128 results"** (the number updates live). Active filters shown as removable chips under the search pill.
4. **Save this search** (heart-bell) and alerts. Empty result: say what to loosen, one tap to remove each filter, show nearby or popular.
5. Stays version: where, dates (a calendar sheet with range select and nights), guests and rooms (steppers). Projects and Invest versions of the cards (progress bar for raised vs target, return, term, risk, minimum).

### C. Map search (`/map`)
Today: Leaflet map, source tabs (All, Buy, Rent, Stays, Projects, Investments), pins coloured by category with a letter badge S, R or I, boundary outlines (Nepal, province, district, municipality, tole), Map and Satellite, a list beside it, numbered pages. **Sale and rent locations are approximate on purpose (privacy): never show an exact pin for them; stays are exact.**
App: map full-screen with the tab bar; top chips (source, filters); pins cluster; tap a pin shows a **bottom card**; swipe the cards sideways, the map follows; pull the sheet up to see the list; "Search this area"; locate me; Map or Satellite switch; legend. Approximate areas drawn as soft circles.

### D. Listing page (`/property/:slug`, `/listing/:id`)
Today: title, tags, location, Ask AI, Share, Save; gallery (1 to 5 fixed grids, 6+ mosaic) and a lightbox; Property details (beds, baths, land area, floors, built-up, road access, facing, parking, furnishing, built year, code, views); What this place offers (amenities); More details; Location (area map); video; Reviews with business replies; contact card (Contact agency, Call, WhatsApp), contact form (name, email, phone, message), Schedule a tour form; Similar properties; agent card.
App: **full-bleed swipeable gallery** (4:3, counter 3/7, tap opens a full-screen viewer with pinch zoom and swipe down to close), floating back, share and heart; price big with "per month" or total; title, location, tags; **key facts as a horizontal strip**; **sticky bottom bar: Call, WhatsApp, Enquire (primary)** that is always there; sections in a clean vertical order with "Read more" and expandable groups; amenities grid; area map (circle); agent or business card; reviews summary with stars; Similar properties carousel; "Ask AI" as a chip that opens a bottom-sheet chat that compares listings by code; Enquire and Schedule a visit as bottom sheets (date and time chips, phone with +977 and 98 prefix check); "Report" and "Share" sheet.

### E. Stays and booking (`/stays`, `/stays/:id`, `/book/:id`)
App: stay card (photo carousel, name, place, rating, perks, "Free cancel", price per night); detail: gallery, rooms list (each room with guests, price, "Select"), perks, policy, exact map pin with directions, reviews; **sticky "Select dates" then "Book"** bar with the price; checkout steps: dates and guests, guest details, coupon, price breakdown (nights x rate, taxes), pay with **eSewa, Khalti, Fonepay or bank transfer with a proof photo**, confirmation with booking code, add to calendar, share; **My bookings** list with status.

### F. Projects and reserve (`/project`, `/project/:id`, `/reserve/:id`)
App: project card (status badge, price from, units left, handover); detail: gallery, price list by unit type, progress timeline, bank finance with EMI quick calc, units grid with available, held, reserved, sold; **Reserve** flow: choose unit, token amount, details, pay, receipt; "Project enquiry".

### G. Investments (`/investment`, `/investment/explore`, `/invest/:id`, `/investDetail/:id`)
App: card with a **progress bar (raised of target)**, expected return, term, risk, payout, minimum Rs 10,000; detail with documents and updates; **Invest** flow: amount stepper with presets, expected payout table, the line "Returns are not guaranteed", pay, receipt; **My investments**.

### H. Account and sign-in (`/my-profile` and its tabs, auth)
Today: login, register (name, email, password, type), email verify, forgot and reset password, Google sign-in (being connected), phone sign-in is **not built** (do not design it as available). Profile has 12 tabs: Overview, My bookings, My investments, Project enquiries, My payments, My rentals, My properties, Saved, Messages, Notifications, Plan, Settings; Settings has 6 areas: Profile, Sign-in and security, Notifications, Language and display, ID check, Your data.
App: **sign-in as a bottom sheet** (Google button, email and password, forgot) and a full-screen register; the **Account tab = a hub**: person card, quick tiles (My properties, Saved, Messages, Bookings), then grouped list rows (Activity, Selling, Inbox, Account) with badges; each section becomes its own screen; settings as grouped rows; theme and language choosers; "Start a business free" card.

### I. Post a property (`/post-property`)
Today: 5 steps: Basics (title, purpose, type, price), Details (rooms, size, facilities), Location (district, address), Photos (cover and gallery), Contact (owner phone, description); also posting stays, projects and investments.
App: **stepper wizard**, one idea per screen, progress bar, big inputs, number pads for numbers, chips instead of dropdowns, **camera and gallery photo picker** with reorder and cover mark, auto-save draft, a review screen, "Submit for review" with what happens next ("checked posts go live at once; others are reviewed"). Plain note: posting is free.

### J. Buyer requirement (`/requirement`, `/property-demand`, `/property-demand/:id`)
App: the long form as a stepper (what, where, budget, size, facilities, vehicles, contact); the **board** (cards, filters, a chart view); detail page with "I have a property to offer" for agencies.

### K. Services (`/services/*`)
Home loan (compare banks, EMI, Apply form), Legal help (topics, request), Property management (topics, request), **Pay rent** (find your lease by code and mobile number, see what is owed, pay, send the reference and a screenshot), Valuation (request form). App: service cards with a short promise, then a short form each, success screen, phone and WhatsApp buttons.

### L. Tools (`/tools/:tool`) and Rates (`/rates-and-trends`)
10 calculators: big number fields, sliders, result card, share. Land units must show **ropani, aana, paisa, dam, bigha, kattha, dhur and sq ft** (1 ropani = 16 aana = 5,476 sq ft; 1 bigha = 20 kattha = 72,900 sq ft). Rates and trends: charts by area, sale and rent switch, unit choice (per aana, per sq ft).

### M. Content and company
Journal (13 posts, categories, comments, post page), Careers (list, detail), About, Gallery, Offers, Help topics, Legal pages (privacy, terms, data deletion), Contact, Apps and pricing (`/apps`, `/pricing`: every app with what is free, Start free).

### N. Special pages (no menu, no tab bar)
Sign an agreement (`/sign/:token`: read in English or Nepali, get a code by email, type code and name, signed record, print or save PDF), Public forms (`/f/:slug`), Pay link (`/pay/:code`), Verify email, Reset password, Offer pages.

### O. Always present
Floating **WhatsApp** (it must not cover the sticky bars; fold it into the bars or the menu where needed), toasts, maintenance message, banners and Sponsored labels, cookie notice.

## 6. The design system you must create (A1)

**Tokens:** the five colours and their mixes (surface, line, muted, accent-soft), type scale (Display 28, Title 22, Heading 18, Body 15, Small 13, Caption 12, minimum 12), spacing, radii, elevation, motion (200 to 280 ms ease-out, sheets spring, respect "reduce motion").
**Components, each in default, pressed, disabled, loading, error, light and dark:**
- Navigation: top bar (large and small), bottom tab bar with the raised Post, **side menu with accordion groups**, tabs, segmented control, chips (single and multi), breadcrumbs not used.
- Search: search field, full-screen search, suggestion row, recent row, filter chip, **filter bottom sheet**, count footer bar, sort sheet, calendar range picker, guest stepper, price range, active filter chip.
- Cards: property (vertical, horizontal, compact), stay, project, investment (progress), agency, agent, journal, requirement, banner (Sponsored), city tile, service tile, tool tile.
- Listing: photo carousel with counter, full-screen viewer, key-facts strip, amenity grid, price block, sticky action bar, map card, review block with stars, agent card.
- Inputs: text, phone (+977), number pad field, select as sheet, date, time chips, textarea, checkbox, radio, switch, stepper, OTP code, photo uploader, file proof upload.
- Feedback: toast, inline error, empty state, error state, offline bar, skeletons (card, list, detail), progress bar, confirm dialog, success screen, permission screens (location, notifications, camera, photos).
- Layout: bottom sheet (3 heights), modal, drawer, section header with "See all", list row (icon, title, value, chevron, badge), key-value, divider, stats tile, chart tile.
- Tags: For Sale, For Rent, Sponsored, Sold, Rented, code `#SP-0006`, status labels, count badges.

**Rules:** one primary action per screen; primary buttons 52 px high, full width in bars; **every tap target at least 44 x 44**; thumb-zone first (actions at the bottom); no hover-only behaviour; no text under 12 px; money always `Rs. 1.25 Cr`, `Rs. 45 Lakh`, `Rs. 25,000 / month`, `Rs. 6,000 / night`, grouped the Indian way (`en-IN`); dates as `12 Mar 2027`; skeletons not spinners; images lazy with the 400 px thumbnail in lists and the 940 px photo in detail.

## 7. Wording and safety rules (public pages)

- The only public brand is **Sheetal Property**. Never show the technology company's name, never show a PAN, never write the word **"verified"** or "not verified" (the site says "checked" at most).
- Sale and rent locations are **approximate**; never design an exact address or exact pin for them.
- Owner contact details are never shown in lists; contact goes through Call, WhatsApp and the Enquire form. Buyer requests never show a phone or email.
- Investments: always show "Returns are not guaranteed".
- Sheetal contact: phone **+977 980-1136817**, WhatsApp the same number, email info@sheetalproperty.com, Kathmandu.
- Language: **English and Nepali (नेपाली)**. Design for Devanagari: taller line height (1.6), longer words, check every component with Nepali text.

## 8. Real content (use it, do not invent lorem ipsum)

Get real listings, photos and counts from the live site and the repository (`/demo/*.jpg` sample photos exist). Facts: about 90 public sale and rent listings today (more are paused by free limits), 13 journal posts, 11 open buyer requests, agencies, stays, projects and investments in Kathmandu, Lalitpur, Bhaktapur, Pokhara, Chitwan. Typical titles: "Full House on Rent at Bansbari", "5 aana land at Budhanilkantha". Show long names, missing photos, sold items, a sponsored card, a listing with 20 photos, one with 1 photo, a price of Rs. 8.5 Cr and of Rs. 12,000, no bedrooms (land), no reviews yet.

## 9. Quality bar (check every screen against this)

1. A new visitor finds a property in **three taps** or fewer; any menu destination in **two**.
2. One clear primary action per screen, at the bottom.
3. Nothing that needs a mouse. No horizontal page scroll except deliberate carousels.
4. Loading, empty, error and offline are designed, not forgotten.
5. Contrast at least 4.5:1 in light and dark, focus visible, labels on icon buttons, screen-reader order sensible.
6. Works on a cheap Android phone on slow data: lean images, skeletons, no heavy animation.
7. The same component is reused everywhere (one property card, one filter sheet, one price format).
8. It looks like **one calm, premium, local app**, not a web page. Studied references: eSewa and Nepali bank apps (clarity, big touch targets, quick-action grids), Booking.com and Airbnb (search, filters with live counts, map and list, sticky booking bar), Google Maps (bottom-sheet map), Zillow and Magicbricks (listing cards and facts).

## 10. Process, stage by stage (do all, report after each)

**Stage 0: Audit (write `docs/MOBILE-AUDIT.md`).** Open the live site at 390 x 844 and go through **every route in section 5**. For each: what is bad on a phone (one line), what to keep. Read the components in section 11. List the 20 worst problems.
**Stage 1: Plan (write `docs/MOBILE-APP-PLAN.md`).** Information architecture, navigation map (every screen and how to reach it), screen list with an id each (about 90 screens and states), component list, build order, and the build decision. **My recommendation to start from, change it only with a reason:** build it as an **installable web app (PWA)** from the same React code and the same API (`/v1`), so it ships fast, one codebase, push alerts later; wrap it for the app stores later if needed; go native only if a feature needs it. Design is independent of that choice.
**Stage 2: Design system (artifact A1).**
**Stage 3: Screens and flows (A2 to A5), then navigation and states (A6).** Priority order inside: Home, full-screen search, results, filter sheet, listing page, map, stays and booking, post a property, account and sign-in, projects, invest, requirement, services, tools, content, special pages.
**Stage 4: Prototype (A7).** Clickable end to end.
**Stage 5: Hand-off (`docs/MOBILE-APP-HANDOFF.md`).** For each screen: the existing React component or page to reuse or replace, the API endpoint it uses, the fields it needs, what is new. List new API needs (for example "save a search", "suggestions", push alerts).
**Stage 6: Self-review.** Walk the quality bar in section 9 on every artifact, fix what fails, then give me: the artifact links, the 10 biggest design decisions in one line each, what is still open, and your recommendation for what to build first.

## 11. Where to look in the repository

- Routes: `website/frontend/src/App.jsx`. Pages: `website/frontend/src/pages/*` (Home, Listings, Catalog, MapSearch, PropertyDetail, PostProperty, Requirement, ServicePages, Tools, RatesTrends, Blog, Careers, About, Profile, Account, PayRentLive, SignAgreement, PublicForm, Apps, Pricing, InvestHub, Agencies, AgencyProfile, MyRentals) and `website/frontend/src/market/*` (stays, projects, investments, booking, payment, orders).
- Components: `website/frontend/src/components/*` (Layout with Header, TabBar, Footer, More menu; HeroSearch; SearchBar; SearchFilters and its CSS; FilterPanel; PropertyCard; Forms; AskAi; AuthModal; PostLayout; LocationMap; Dropdown; ui).
- Theme and styles: `shared/src/styles/theme.css` (tokens, the `.tabbar`, `.pcard`, sheets), `website/frontend/src/utils/cloth.css`.
- Data and formats: `website/frontend/src/api/endpoints.js` (every call), `website/frontend/src/utils/format.js` (price, images, specs), `website/frontend/src/utils/listingOptions.js` (property types).
- Docs: `docs/Sheetal-System-Report.pdf` (how everything connects), `docs/feature-map.md` (every page).
- Live site: https://sheetalproperty.com (use the mobile viewport preset in the built-in browser; sign in is not needed for the public pages).

Begin with Stage 0 now. Do not ask me anything. Report when Stage 0 and Stage 1 are done.
