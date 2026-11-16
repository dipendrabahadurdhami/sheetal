# Launch check (16 Nov 2026)

An honest list of what is ready, what was fixed in this pass, and what still stands between this computer and a public launch.
Setup steps for the super admin are in [SETUP-GUIDE.md](SETUP-GUIDE.md). The cutover is in [p3-cutover-runbook.md](p3-cutover-runbook.md).

## Fixed in this pass
| What was wrong | Now |
|---|---|
| The website's Apps and Pricing pages showed **sample data**, not the real catalog: `public/catalog` and `start-free` were missing from `VITE_API_LIVE` in `website/frontend/.env.local` | added on this computer. **On the real server set `VITE_API_LIVE=*`** or the full list (developer) |
| "Coming soon" apps (Payroll, Accounting, Restaurant) in the marketplace and on the website | hidden by default (`visible: false` in the seed catalog); Admin → Pricing shows one when it is built |
| "Preview" pages with sample data in the business menu (Social sharing, AI voice assistant) | removed from the menu and the settings hub |
| The same two as tabs in the admin panel; admin "Orders, refunds and claims" (invented orders) and "Live visitors" (invented numbers) | not shown to signed-in staff |
| "Coming soon" connections in Admin → Setup center (SMS, card gateway, Fonepay QR, Facebook, delivery partners, OTAs, IRD) | only built connections are listed; one with saved details stays visible |
| "Continue with Google" and "Phone" on the website sign-in answered "not set up yet" | hidden with the real API; email and password only |
| The old Starter / Business / Pro page (`/plans`, `/become-agency`) and its links | they open the new Pricing page |
| The Pricing page said only "Free edition: Yes" | a "What is free" block and each app's free limits in words |
| Marketplace: a 300 px gap under the search box; the status chip over a long app name | fixed |
| No screen for the billing rules (the sales switch) | Admin → Pricing → Billing rules; **sales are on** since 16 Nov |

## State of the real data
- 17 businesses: 1 on `apps` (Sheetal Property, the pilot), 14 on `shadow`, 2 on `plans` (a plan payment in flight).
- 15 of the 17 are **test accounts** (`…@sheetal.test`). The two real ones are Sheetal Property and "hotel nepal".
- **Sheetal Property is on the free tier since 16 Nov (the owner's decision):** 3 of its 2,595 published listings are on the website, 2,592
  are paused (not deleted) and return when it pays for Listings (the full edition allows 500). The public website has 90 listings now
  (it had 2,682). Its business email (the Mail app has no free edition) ended. See `handovers/CHANGES-P3-FREE-TIER.md`.

## Still open before a public launch (Phase 4: none of this is done)
| # | What | Why it matters | Who |
|---|---|---|---|
| 1 | A server, the domain, HTTPS, the production `.env` (`SECRETS_KEY`, `DATABASE_URL`, `SITE_URL`, `CORS_ORIGINS`, `VITE_API_LIVE=*`) | nothing is on the internet yet | developer |
| 2 | The mail server on the real server (port 25 unblocked, DNS: MX, SPF, DKIM, DMARC) | sign-up, password reset and invoice emails are only saved as files today | developer + owner (DNS) |
| 3 | A clean production database: no test accounts, no sample reviews or payouts | 15 of 17 businesses here are test accounts | developer |
| 4 | Automatic daily backups on the server and one restore drill there | today backups run by hand on this computer | developer |
| 5 | A security review: sign-in, permissions, uploads, rate limits, secrets | not done as a whole | developer |
| 6 | A load test and error monitoring with alerts | not done | developer |
| 7 | GitHub Actions is off (billing): no automatic check on each change | tests run by hand on this computer; 2 known Windows-only failures | owner (GitHub billing) |
| 8 | Nepali texts read by a native speaker; many new screens are English only | half the audience | owner |
| 9 | Sale terms, refund policy, privacy policy, invoice footer: written and entered (Admin → Site content) | legal | owner |
| 10 | Company details on invoices (Admin → Legal and required info) | invoices show only the site name until then | owner |
| 11 | eSewa merchant account, test then live (Setup center) | nobody can pay online until one method is live | owner |
| 12 | The accountant's yes on invoice wording, VAT, credit notes, IRD | gate G5 | owner |
| 13 | The pilot payment test (trial, buy, change, cancel, refund) | gate G10 | owner + developer |
| 14 | Step 4 of the cutover (everyone to `apps`), not before 23 Nov by the 7-day rule | 14 businesses still on `shadow` | owner's yes |
| 15 | A full hand test of every app on a phone | not done | owner |

## A blocker for earning money (found 16 Nov)
**The free limits are not enforced in the apps.** The catalog says "5 rooms free", "100 leads free", "20 invoices a month free", and the
pricing page shows it, but on app subscriptions no app checks those numbers (only Listings does, since 16 Nov). A free business is not
stopped at its limits, so nothing makes it upgrade. Each app (Hotel, CRM, Invoicing, POS, Expenses, Reviews, People, Agreements, Rentals,
Projects, Collections, Investments) must call the limit check where it adds a record. This is the most important code task left.

## Known gaps in what is built (not blockers; say so if one matters to you)
- Sign in with Google and by phone, SMS, card gateway, Fonepay dynamic QR, Facebook and Instagram posting, AI voice assistant page, delivery partners,
  IRD link, Payroll, Accounting, Restaurant: **not built** (hidden).
- `email/change-resend` on the website still answers from sample data (the API has no such route): the "resend" button after changing an email does nothing real.
- Admin → Inbox → Support is an empty list (support conversations are not wired).
- Usage per limit is not shown in `/entitlements`; the AI top-up is not its own cart item; trial AI credits for new free businesses are not given yet.
- `website/frontend/src/pages/Plans.jsx` and the old plan screens in the admin panel (Plans, Add-ons) remain for businesses still on `plans`; remove after step 4.
- The 12-month price protection was designed for paying customers. There are none yet (every paid plan here is a test or a gift), so at launch
  it only matters if you keep those rows.
