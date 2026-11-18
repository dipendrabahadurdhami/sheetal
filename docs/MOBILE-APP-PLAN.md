# Mobile app plan: Sheetal Property customer app

Scope: the public website as an app (visitors, buyers, renters, travellers, investors, owners who post). Business and admin panels come later; the app only has a "Start a business" door that opens /business in the browser.

## Build decision

Build it as an installable web app (PWA) from the same React code and the same API (/v1). Reason: one codebase, ships fast, the owner already runs it; push alerts and store wrappers (Capacitor) can come later. Go native only if a feature needs it (for example background location). The design does not depend on this choice.

PWA first steps: web manifest (name, icons, theme colour), service worker for the shell and an offline page, safe-area padding, pull to refresh, bottom sheets and the side menu as one shared layer, no footer on phones.

## Information architecture

Bottom tabs (5): Home, Explore, Post (raised), Saved, Account. Hidden in full-screen flows (photo viewer, checkout, wizards, signing, special pages).
Top bar: menu, logo, search, bell. Large title shrinks on scroll. Inner screens: back, title, one action.
Side menu (85% width): person card; accordion groups Explore, Services, Tools, Learn, Company; footer with theme, language, WhatsApp, Call, legal links, version.
Rule: a property in three taps or fewer; any menu destination in two.

## Navigation map (how to reach each screen)

- Home: tab 1, logo.
- Search: Home pill, top search icon, Explore tab. Results: from Search, quick grid, chips, city tiles.
- Listing: any card. Gallery viewer: tap photo. Enquire, Visit, Ask AI, Share, Report: sheets on the listing.
- Map: quick grid, Results toggle, menu Explore.
- Stays: quick grid, chip. Stay detail from card; booking from the sticky bar.
- Projects, Invest: quick grid, chips, menu.
- Post: centre tab, quick grid, closing card.
- Requirement: quick grid, menu, buyer-request strip.
- Services, Tools, Rates, Journal, Company: menu groups and the Home strips.
- Account: tab 5; sign-in sheet from any protected action.
- Special pages: links from email or SMS; no chrome.

## Screen list (ids)

H = Home, S = Search, R = Results, L = Listing, M = Map, B = Stay and booking, P = Project, I = Invest, A = Account, W = Post wizard, Q = Requirement, V = Services, T = Tools, C = Content, X = Special, N = Navigation and states.

Home (6): H1 Home with 3 banners; H2 with 1; H3 none (house banner); H4 loading skeleton; H5 pull to refresh; H6 slim second banner strip.
Search (7): S1 full-screen search empty (recent, popular, near me); S2 live suggestions grouped; S3 code search #SP-0006; S4 near me permission; S5 stays search (where, dates, guests); S6 calendar sheet; S7 guests and rooms sheet.
Results (12): R1 list; R2 grid; R3 filter chips row; R4 purpose sheet; R5 type sheet; R6 price sheet; R7 beds and availability sheet; R8 sort sheet; R9 all filters full-height (counts, live button); R10 active chips; R11 empty result (what to loosen); R12 save search and alerts.
Map (5): M1 map with pins and bottom card; M2 clusters; M3 list sheet pulled up; M4 satellite and legend; M5 approximate area circle.
Listing (11): L1 top (gallery, price); L2 facts and amenities; L3 location and agent; L4 reviews; L5 similar; L6 photo viewer; L7 enquire sheet; L8 visit sheet; L9 Ask AI sheet; L10 share and report; L11 edge cases (1 photo, 20 photos, land with no beds, sold, no reviews, long name).
Stays and booking (9): B1 stay card list; B2 stay detail; B3 rooms; B4 dates and guests; B5 guest details; B6 price and coupon; B7 pay (eSewa, Khalti, Fonepay, bank proof); B8 confirmation; B9 my bookings.
Projects (5): P1 list; P2 detail; P3 units grid; P4 reserve steps (unit, token, details, pay); P5 receipt and enquiry.
Invest (5): I1 list; I2 detail with documents; I3 invest amount; I4 pay and receipt; I5 my investments.
Account (9): A1 sign-in sheet; A2 register; A3 forgot and reset; A4 verify email; A5 hub signed in; A6 hub signed out; A7 section screens (bookings, payments, rentals, messages, notifications); A8 settings (6 areas); A9 theme and language.
Post wizard (8): W1 intro and type; W2 basics; W3 details; W4 location; W5 photos; W6 contact; W7 review; W8 submitted. Stays, projects and invest posting reuse the same steps with their own fields.
Requirement (5): Q1 stepper (what, where, budget, size, facilities, contact); Q2 board; Q3 chart view; Q4 detail; Q5 offer a property.
Services (7): V1 hub; V2 home loan; V3 legal help; V4 property management; V5 pay rent (find, owed, pay, proof); V6 valuation; V7 success.
Tools and rates (4): T1 tool list; T2 EMI; T3 land units; T4 rates and trends.
Content (6): C1 journal list; C2 post; C3 careers list and detail; C4 about, contact, gallery, offers, help; C5 apps and pricing; C6 legal pages.
Special (5): X1 sign an agreement (English or Nepali, code); X2 public form; X3 pay link; X4 verify and reset; X5 offer page.
Navigation and states (12): N1 side menu (all groups open, one at a time); N2 tab bar and top bar variants; N3 empty; N4 error; N5 offline bar; N6 skeletons; N7 location permission; N8 notifications permission; N9 camera and photos permission; N10 toast and confirm dialog; N11 maintenance and cookie notice; N12 WhatsApp placement.

Total: about 105 screens and states.

## Component list (one of each, reused everywhere)

Navigation: top bar (large, small), tab bar with raised Post, side menu accordion, tabs, segmented, chips (single, multi).
Search: search field, suggestion row, recent row, filter chip, filter sheet, count bar, sort sheet, calendar range, guest stepper, price range, active chip.
Cards: property (vertical, horizontal, compact), stay, project, investment, agency, agent, journal, requirement, banner, city tile, service tile, tool tile.
Listing: carousel with counter, viewer, facts strip, amenity grid, price block, sticky action bar, map card, review block, agent card.
Inputs: text, phone (+977), number pad field, select sheet, date, time chips, textarea, checkbox, radio, switch, stepper, OTP, photo uploader, proof upload.
Feedback: toast, inline error, empty, error, offline bar, skeletons, progress, confirm, success, permission screens.
Layout: bottom sheet (3 heights), modal, drawer, section header, list row, key-value, divider, stats tile, chart tile.
Tags: For Sale, For Rent, Sponsored, Sold, Rented, code, status labels, count badges.

## Build order

1. Shell: manifest, safe areas, tokens, tab bar, top bar, side menu, sheet layer, toasts, offline bar.
2. Home, full-screen search, results, filter sheet (the money path).
3. Listing page with sticky bar, viewer, enquire.
4. Map as a bottom-sheet map.
5. Stays and booking, then Post wizard, then Account and sign-in.
6. Projects, Invest, Requirement.
7. Services, Tools, Rates, content, special pages.
8. Polish: skeletons everywhere, Nepali check, contrast check, slow-network check.

## Design rules (from the brief)

Five logo colours only; Poppins 400, 500, 600 (numbers); corners 8 (12 for sheets and large photos); spacing 4, 8, 12, 16, 24, 32, 48; Lucide icons at stroke 1.75; flat cards with 1 px line; shadow only on sheets and the raised Post button; primary button 52 px; every tap target 44 x 44 or more; text 12 px minimum; money en-IN; skeletons not spinners; status by icon and words, not new colours; Nepali line height 1.6.

## Artifacts

A1 design system; A2 Home, Search, Results, Map; A3 Listing, Stays, Projects, Invest; A4 Post, Requirement, Account; A5 Services, Tools, Rates, content, special; A6 Navigation and states; A7 end-to-end prototype.
