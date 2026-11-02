# Sheetal: full feature map (new frontend)

Status: **draft for discussion.** It shows what the new frontend already has, who uses what, how plans work, and what the backend must do. Nothing here is built on a real backend yet; every screen runs on demo data.

---

## 1. Three apps, one platform

| App | Address | Who uses it | Purpose |
|---|---|---|---|
| **Website** | `/` | Everyone (visitors, buyers, renters, investors, small sellers) | Find, compare, contact, book, invest, post 1 listing |
| **Business workspace** | `/business` (later `business.<domain>`) | Businesses and their team (Sheetal Property first) | Post and manage listings, leads, deals, money, team |
| **Admin panel** | `/admin` | Sheetal staff only | Run the platform: businesses, plans, payments, moderation, content, settings |

One login works everywhere. What you see depends on your **role** and your **plan**.

---

## 2. Who is who

| Person | Where | What they can do |
|---|---|---|
| **Visitor** (not logged in) | Website | Browse, search, map, view listings, contact, requirement form, tools, blog, careers |
| **Website user** (free account) | Website → My profile | Everything a visitor can, plus save listings, review, message, book stays, invest, pay, post **1 listing (Starter)** |
| **Business owner** | `/business` | Everything in their workspace (limited only by plan) |
| **Business team member** | `/business` | Only what their role allows (e.g. Agent sees listings + leads, Accountant sees money) |
| **Sheetal staff** | `/admin` | Only what their staff role allows |

### Business roles (ready-made; owners can also make custom roles on Business/Pro)
| Business type | Roles |
|---|---|
| Agency | Owner · Branch manager · Agent · Accountant |
| Hotel | Owner · Manager · Front desk · Cashier · Housekeeping · Accountant |
| Host (homestay/villa) | Owner · Co-host · Cleaner |
| Developer | Owner · Sales manager · Sales executive · Site engineer · Accountant |
| Sponsor (investments) | Owner · Investor relations · Accountant |

On **Pro**, one workspace holds every kind, so the role list combines them (e.g. Sheetal can have Agents *and* a Front desk role).

### Sheetal staff roles (`/admin`)
| Role | Can do |
|---|---|
| Super admin | Everything |
| Operations | Businesses (view, edit, suspend, log in as them for support), moderation, KYC, audit, staff list |
| Finance | Plans and prices, billing, refunds |
| Content editor | Blog, pages, ads, listing moderation |
| Support | View businesses, log in as them for support (auto-ends after 30 min), audit |

---

## 3. Website: every page

| Area | Pages | What it does |
|---|---|---|
| **Find** | Home, Sale, Rent, Search, Map, Featured | Search with filters, map pins, featured listings |
| **Listing detail** | `/property/:id`, `/listing/:id` | Photos, details, price, agent, reviews, contact owner/agent, schedule tour, ask AI |
| **Stays** | `/stays`, `/stays/:id`, `/book/:id` | Hotels, villas, homestays: browse and book |
| **Projects** | `/project`, `/project/:id`, `/reserve/:id` | Housing/apartment projects: view units, reserve |
| **Investments** | `/investment`, `/investDetail/:id`, `/invest/:id` | Investment offers: view, invest |
| **Partners** | `/partners`, `/agency/:id`, `/site/:tid` | Agencies and businesses, each with its own mini-site |
| **Demand** | `/requirement`, `/property-demand` | Buyers post what they want; agencies see demands and submit matches |
| **Services** | Home loan (+ apply), Legal help, Property management, Pay rent, Valuation | Service pages and request forms |
| **Tools** | EMI, ROI, Land price, Unit converter, Rates & trends | Free calculators (good for Google traffic) |
| **Content** | Blog, Careers, About, Gallery, Privacy, Terms, Data deletion | |
| **Plans** | `/plans`, `/become-agency` | Pick a plan, upgrade |
| **Account** | `/my-profile` | Overview · My bookings · My investments · Project enquiries · My payments · My listings · My plan · Messages · Alerts · Saved · Settings (profile, security, notifications, language, ID check, your data) |
| **Extras** | Lead extractor, Ask AI, Pay link `/pay/:code`, Offers | |
| **Old links** | `/homeLone`, `/propertyDemand`, `/About` … | Already redirect to the new pages (keeps Google links working) |

---

## 4. Business workspace: every module

| Group | Module | Agency | Hotel | Host | Developer | Sponsor |
|---|---|---|---|---|---|---|
| — | Overview, Analytics | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Operate** | POS (front desk, restaurant, extras, shifts) | | ✅ | ✅ | | |
| | Bookings, Calendar | | ✅ | ✅ | | |
| | Stock | | ✅ | ✅ | | |
| | Projects (units, progress) | | | | ✅ | |
| | Collections (installments) | ✅ | | | ✅ | |
| | Rentals (tenants, rent bills) | ✅ | | | | |
| | Investors | | | | | ✅ |
| **Sell** | Listings (+ new-listing wizard) | ✅ | ✅ | ✅ | ✅ | ✅ |
| | Reviews | ✅ | ✅ | ✅ | ✅ | ✅ |
| | Promote (featured, ads) | ✅ | ✅ | ✅ | ✅ | ✅ |
| | Inbox (WhatsApp, Messenger, Instagram, SMS, email, web) | ✅ | ✅ | ✅ | ✅ | ✅ |
| | Online forms + responses (incl. requirement forms) | ✅ | ✅ | ✅ | ✅ | ✅ |
| | Agreements (bainā, rent, commission; e-sign) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Money** | Invoices, credit notes, receipts (VAT 13%) | ✅ | ✅ | ✅ | ✅ | ✅ |
| | Payouts | ✅ | ✅ | ✅ | ✅ | ✅ |
| | Expenses | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Admin** | Team, roles, attendance | ✅ | ✅ | ✅ | ✅ | ✅ |
| | Settings: profile, branding, branches, domains, billing/plan, API keys, data export | ✅ | ✅ | ✅ | ✅ | ✅ |
| | Help + guided tour | ✅ | ✅ | ✅ | ✅ | ✅ |

**Pro = every column in one workspace.** That is what Sheetal Property gets.

### Listing kinds
| Kind | Normally allowed for | On Pro |
|---|---|---|
| Sell a property | Agency, Owner, Developer | ✅ |
| Rent out | Agency, Owner | ✅ |
| Hotel/resort rooms | Hotel | ✅ |
| Villa / apartment / homestay / hostel | Hotel, Host | ✅ |
| Building or colony project | Developer | ✅ |
| Investment opportunity | Sponsor | ✅ |

Categories: House · Apartment · Land · Commercial, each with its own property types and fields. Staff edit all these options in **Admin → Listing setup**.

### Leads: where every enquiry lands
| From | Lands in |
|---|---|
| Contact owner/agent, schedule tour | Inbox → lead linked to the listing |
| Requirement form | Forms → Responses, auto-matched to listings |
| WhatsApp / Messenger / Instagram / SMS / email | Inbox |
| Stay booking, project reservation, investment | Bookings / Projects / Investors |

Lead flow: **new → contacted → viewing → deal → closed / lost**, with assignee, follow-up date, notes.

---

## 5. Admin panel: every module

| Group | Module | What staff do there |
|---|---|---|
| — | Dashboard, Traffic + live visitors | Platform numbers, revenue, who is on the site now |
| **Customers** | Businesses (tenants) | Create, verify, edit, suspend, log in as them (support) |
| | Plans | Set plan prices, limits, features |
| | Add-ons | Set add-on prices and which types can buy them |
| | Billing | Subscriptions, invoices, orders, refunds, claims, platform earnings (commission) |
| **Marketplace** | Listing setup | Categories, types, fields, options (EN + NE) |
| | Content | Website pages, blog, social posts, careers |
| | Ads | Paid ads and banners |
| | Channels (OTA) | Approve hotel channel-sync requests |
| | Moderation | Approve listings and ID/KYC checks |
| | Inbox | Support chat, master lead list, demands, service requests |
| **System** | Staff | Invite staff, assign staff roles |
| | AI | AI features on/off, voice agent, message templates, expiry reminders |
| | Settings | Site name, domains, payment gateways, VAT, commission, email/SMS/WhatsApp, languages, security (2FA, session), trial/grace/auto-suspend |
| | Audit log | Who did what, when |

**Admin does not post listings.** All posting happens in `/business`.

---

## 6. Plans and subscriptions (agreed)

| | **Starter** | **Business** | **Pro** |
|---|---|---|---|
| Price | **Free, always** | Paid (suggested Rs. 6,900/month) | Paid (suggested Rs. 12,900/month) |
| Who gets it | **Every new account, automatically** | Upgrade | Upgrade |
| Listings | **1 listing** | Many, **own business type only** | **All kinds**: property, project, hotel/stay, investment |
| Features | Basics only: post/edit the listing, see its leads, profile | All modules of **their own type** (see table in §4) | **All modules of all types**, one workspace |
| Team | Owner only | Team + roles | Bigger team + custom roles |
| Add-ons | Not available | Can buy (extra seats, SMS packs, inbox, POS outlets…) | Most included |

Suggested per-kind limits (still to confirm):

| | Starter | Business | Pro |
|---|---|---|---|
| Sale/rent listings | 1 | 150 | Unlimited |
| Projects | – | own type only | 10 |
| Hotels/stays | – | own type only | 10 |
| Investments | – | own type only | 5 |
| Featured | 0 | 8 | 20 |
| Team seats | 1 | 10 | 25 |

### Subscription life cycle
1. **Sign up** → email verified → **Starter** (free) right away.
2. **Upgrade** → pay with eSewa / Khalti / Fonepay / ConnectIPS / bank → plan switches, features unlock.
3. **Renewal** reminder before the end date → auto-renew or pay again.
4. **Not paid** → **grace period** (7 days, set in admin), everything still works.
5. **After grace** → back to Starter rules: extra listings are **hidden, never deleted**; paid modules become read-only. (The frontend also has a "backup only" mode for suspended accounts.)
6. Staff can extend, discount, refund, or change a plan from Admin → Businesses.

**Sheetal Property:** Pro, active 1 month from setup, email verified, account active, owner `shetalrealestate@gmail.com`.

---

## 7. What the backend must do (by module)

| Backend module | Serves | Main jobs |
|---|---|---|
| Auth | All 3 apps | Sign up, login, verify email, reset password, 2FA for staff, sessions |
| Accounts & workspaces | Business, Admin | Businesses, members, roles/permissions, invites, branches, log-in-as support |
| Plans & billing | All | Plans, limits checks, add-ons, subscriptions, payments + gateway callbacks, grace/suspend jobs |
| Listing setup | Admin, Business | Catalog of kinds/categories/types/fields |
| Listings | All | Create (wizard), review/moderation, publish, search, map, featured, views, photos |
| Leads & inbox | Business, Website | Contact/tour/requirement forms, chat channels, assignment, follow-ups, demand matching |
| Bookings & POS | Business, Website | Stays, calendar, folios, restaurant POS, shifts, stock |
| Projects & investments | Business, Website | Units, reservations, installments, investors, updates |
| Agreements & contacts | Business | Templates, e-sign, documents, encrypted ID data |
| Money | Business | Invoices, receipts, VAT, payouts, expenses |
| Content | Admin, Website | Pages, blog, careers, banners, ads |
| AI | All | Ask AI, lead extractor, voice agent, message templates (Claude API, server-side only) |
| Analytics & audit | Admin, Business | Visits, live sessions, audit log, notifications |
| Old-data import | One-time | Clean + re-categorize 2,680 listings, 14,238 photos, leads, demands, users, blogs |

---

## 8. Frontend check: what is done, what remains

**Checked on 2026-11-02:**
- 163 pages across the 3 apps. **No link points to a missing page.**
- All 47 old-site pages have a new version, and all old URLs redirect.
- No half-built pages; the "Pending" screen is only a fallback for unknown addresses.

**Frontend work done on 2026-11-02:**
| What | Where |
|---|---|
| ✅ Plans are **Starter (free) / Business / Pro** for every business type; Bronze/Silver/Gold/Platinum removed | `shared/src/demo/demo.js`, `shared/src/core/plans.js`, website `db.js`, `Agencies.jsx`, `Profile.jsx` |
| ✅ **Pro unlocks every module and listing kind** in one workspace, and every add-on is included | `BusinessApp.jsx`, `rbac.js` (`filterNav`, `permsForTypes`), `ListingWizard.jsx`, `AI.jsx`, `Addons.jsx` |
| ✅ **Starter**: 1-listing limit, paid menus hidden, "Upgrade" card on paid pages | `planBits.jsx` (`UpgradeNeeded`), `ListingsManager.jsx` |
| ✅ **Sheetal Property** workspace on Agency Pro (demo `t13`), opens by default | `demo.js` |
| ✅ **"Needs review" queue** for imported listings, showing what to fix | `ListingsManager.jsx` |
| ✅ **Location privacy**: sale and rent show a ~500 m approximate area; stays show the exact pin with **Get directions** and **Open in Google Maps** | `LocationMap.jsx`, `shared/src/core/geo.js`, `PropertyDetail.jsx`, `ListingDetail.jsx`, `MapSearch.jsx`, `Market.jsx` |
| ✅ Real **map pin picker** in the listing wizard (tap, drag, "use my location"), with a note saying who sees the pin | `PinPicker.jsx` |
| ✅ **SEO**: canonical, Open Graph, structured data (site, listings), noindex on private pages, titles on every page, `robots.txt`, sitemap generated on every build | `utils/seo.js`, `index.html`, `public/robots.txt`, `scripts/generate-sitemap.mjs` |
| ✅ Fixed a crash: the land-area field in the listing wizard used an undefined `SYS` | `ListingWizard.jsx` |

**Still to do:**
| # | What | Why |
|---|---|---|
| 1 | Connect every screen to the real API (replace demo data) | Done module by module during each backend phase |
| ✅ | Clean-up done: 22 `.bak` files, `p10/` and `scripts/phase*` patch files deleted (copies kept in the session backup) | |
| 3 | `/map-pins` endpoint has no demo answer | Backend will provide it |
| 4 | Run `npm install` once so `package-lock.json` records `leaflet` for the business app | Works already (shared install), lockfile just isn't updated |

### Backend rule from the location change
The frontend only *draws* an approximate area. **The public API must never send the exact pin for sale or rent listings**: it sends the shifted point from `approx()` (`shared/src/core/geo.js`) instead, and only the business workspace gets the real pin. Stays send the exact pin.

## 9. Decisions (answered 2026-11-02)

| Topic | Decision |
|---|---|
| Brand and domain | **Sheetal Property** · **sheetalproperty.com** (same as the old site, keeps Google ranking) |
| Starter | **Free**, 1 listing, renews by itself every month. Every new account gets a `/business` workspace from day one, with locked menus they can upgrade plus the useful basics |
| Prices | **Business Rs. 1,500/month, Pro Rs. 3,000/month** |
| Billing periods | 1, 3, 6 or 12 months; longer saves more (table below) |
| Sheetal Property | Pro, **1 year already active** |
| Auto-renew | An auto-renew switch for every business. **Only the super admin can turn it on; it is off by default** |
| Old listings | **Import all as published** (import notes still shown so the team can fix details) |
| Hotels on Pro | **Full tools**: bookings, calendar, front desk, POS |
| Old user accounts (121) | **Import**: keep email, set a new password with a reset link on first login, bring their favourites and enquiries, and keep their old role visible (Agent, Buyer, Seller, Owner, Editor, Sheetal team, old agent tiers) |

| Plan | 1 month | 3 months (save 9%) | 6 months (save 19%) | 12 months (save 39%) |
|---|---|---|---|---|
| Starter | Free | Free | Free | Free |
| Business | Rs. 1,500 | Rs. 4,095 | Rs. 7,290 | Rs. 10,980 |
| Pro | Rs. 3,000 | Rs. 8,190 | Rs. 14,580 | Rs. 21,960 |

**Applied to the frontend on 2026-11-02:** the new prices and the 1/3/6/12-month choice (Plans page, My profile → Plan, business billing), Sheetal on Pro for 1 year, the super-admin-only auto-renew switch (Admin → Businesses → a business), the Sheetal Property name and logo text everywhere, and the website reading plans from the same list as business and admin. The **lead extractor is a business tool only** (Inbox → Find leads); old website links `/ShetalLeadExtractor` and `/lead-extractor` open it in `/business/inbox`.

### Still open (needed in the backend phases)
1. Payment gateways with real merchant accounts (eSewa, Khalti, Fonepay, ConnectIPS?)
2. Email and SMS providers (Zoho SMTP and Sparrow SMS are in settings)
3. Hosting: VPS provider and budget

## 10. Earlier open questions (kept for history)

1. **Starter users:** manage their 1 listing from **Website → My profile** (simple), or also get a small `/business` workspace?
2. **Business/Pro prices:** confirm Rs. 6,900 / Rs. 12,900 (and yearly prices).
3. **Pro limits** per kind: confirm the table in §6.
4. **Hotels on Pro:** listing only, or also full front desk + POS?
5. **Free trial of Pro** for new businesses (e.g. 14 days), or no trial since Starter is free?
6. **Sheetal after 1 month:** auto-renew, or never expire?
7. **Old listings from 2022–2023:** publish, or archive for re-check?
