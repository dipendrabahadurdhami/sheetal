# Marketplace and billing: apps, editions, subscriptions, invoices

Status: design for Phase 3 (task P3-ARCH). Nothing here is built. No code file was changed.
Companions: [KERNEL.md](KERNEL.md) (Entitlements, Money), [ACCESS.md](ACCESS.md) (§7 app access, §9 approvals, §10 seats),
[APP-MANIFEST.md](APP-MANIFEST.md) (editions, limits, price, trialDays), [SETTINGS.md](SETTINGS.md) (§6 revenue share, §7 revenue reports),
[INTEGRATIONS.md](INTEGRATIONS.md) (payments, AI keys, vault), [PHASE-3-TASKS.md](PHASE-3-TASKS.md), [PHASE-3-RISKS.md](PHASE-3-RISKS.md).

What I read: `domain/{plans,billing,addons,payouts,promote,money,ai-features}.ts`, `lib/{payments,ai}.ts`, `shared/src/core/plans.js`,
`business/backend/src/modules/billing/`, `admin/backend/src/modules/{billing,plans,addons,earnings,payouts}.ts`, `docs/payments.md`,
`schema.prisma` (Plan, Tenant, Invoice, Payment, TenantAddon, AiUsage, DocCounter, ApprovalRule/Request), `platform/src/tenancy/context.ts`
(`buildEntitlements`), the 15 app manifests, `rewrite-role-perms.mjs` (the style for the migration script).
Not given and not guessed: the Phase 2 code, the Integration Center code, `shared/src/core/bs.js` contents. Where a task needs them, it says so.

Marks used: **Owner to confirm** = my recommendation, used until the owner answers. **Accountant to confirm** = a tax or legal point I cannot settle from the code.

---

## 0. The owner's decisions and my questions

Fixed decisions (from the owner, not reopened): per-app subscriptions in a marketplace; Starter/Business/Pro removed; a free-forever tier with
editions and free limits per app; website posting free (unverified posters reviewed, verified publish at once, public site never says "verified");
every app AI-powered (Sheetal AI subscription or own key); two separate payment systems; Sheetal earns a commission on each sale plus a technology
partner share; every price, limit, trial, legal text and required field is a super admin setting; the public brand is only "Sheetal Property".

**Answered by the owner on 13 Nov 2026 (20:30 Nepal time): all five recommendations accepted (Q1 per limit, Q2 paid period + 12 months / free 90 days,
Q3 split per app with partner share as a % of commission, Q4 trial-only AI credits, Q5 VAT included and yearly = 10 months).** The table below is now the decision.

The five questions, with the answer the owner accepted:

| # | Question | My recommendation (used below) | Alternative |
|---|---|---|---|
| Q1 | What happens at a free limit: warn, or stop? | Per limit, set in Admin → Pricing. Records and setup items (listings, rooms, outlets, seats, projects): **hard stop for new ones**, existing ones stay editable. Money-in actions (POS bills, customer invoices per month): **soft**, allowed up to 20% over, then stop. Storage and AI credits: warn at 80%, stop at 100% (AI stops only AI). Table in §6.2. | Soft everywhere (warn only): friendlier, but the free tier never converts. |
| Q2 | How long do today's businesses keep today's access and price? | Paying businesses: today's price and limits until their current paid period ends **plus 12 months**; the renewal price is the **lower** of the old plan price and the new price of the apps they keep. Free businesses: today's limits for **90 days**. Nobody loses data or an app on day one. | Lock for 6 months (faster to new prices) or lock forever (no migration revenue). |
| Q3 | What is "commission" on an app sale? | The sale (without VAT) is split: **Sheetal's commission** (a % per app, set in admin) and the **publisher part** (the rest). The technology partner's share is a % of the commission (SETTINGS.md §6, rule 4). Until the owner enters the split, commission is 100% (nothing is paid to anyone wrongly). | The whole price is Sheetal income and "commission" is only a report line. The data stored is the same; only the percentages change. |
| Q4 | Does the free tier get free AI credits? | No monthly free credits for **new** free businesses: a locked preview, plus a one-time **100 credits during a 14-day trial**. Existing businesses keep today's credits during their lock (Q2). | 100 free credits every month (a stronger hook, a real cost to Sheetal). |
| Q5 | Starting prices (all editable in admin, §3.4). | The table in §3.4: each app's paid edition Rs 150 to Rs 700 a month, **VAT included**, yearly = 10 months; a typical hotel or agency set lands near today's Rs 1,500 Business plan. | Prices shown without VAT (common for business software); the invoice is the same either way. |

Other assumptions marked **Owner to confirm** are collected in §17.

---

## 1. The model in one picture

```
Business (Tenant)
 ├─ Subscription per app ── App (manifest) ── Edition (free | full | …) ── Price (month, year) + FreeLimit values + features
 │        │                                        └─ Trial (days, once per business per app)
 │        └─ Add-ons (seats, storage, AI credits, limit packs)         Coupon (optional, on a purchase)
 ├─ Sheetal AI subscription (business-level)  OR  own AI key (Integration Center)
 └─ Invoice (tax invoice at payment) ─ InvoiceLine per app ─ Payment (Sheetal's gateways only) ─ RevenueEntry (commission, partner share)
```

| Word | Meaning | Where it lives |
|---|---|---|
| **App** | A sellable product: CRM, People (HRM), Payroll, Invoicing, POS, Rentals, Hotel, Restaurant, Expenses, Reviews… | `apps/<id>/app.manifest.ts` (identity, permissions, limit names) |
| **Edition** | A version of an app with its own price, limits and features. Every app has `free` (free forever, no card) and usually `full`; an app may add more (`pro`). | Manifest = first values. Live values = setting `platform.catalog` (admin edits) |
| **Price** | Per edition: `priceMonthPaisa` and `priceYearPaisa`, **VAT included** (Owner to confirm, Q5). Money is always paisa, `BigInt` in the database. | `platform.catalog` |
| **FreeLimit** | A named limit of an edition, e.g. `hotel.rooms = 5`. `null` = unlimited. Each limit has a **behaviour**: `hard` or `soft` (§6.2). | `platform.catalog` |
| **Trial** | Days of a paid edition free, no card. Default 14. Once per business per app. | `platform.catalog` (`trialDays`, per app) |
| **Subscription** | One row per business per app: which edition, what status, until when, at what price. | table `Subscription` |
| **Add-on** | Extra seats, storage, AI credits, or a limit pack (for example +25 listings). | catalog (prices), table `AddonSubscription` |
| **Coupon** | A code that lowers one purchase (percent, fixed amount, or extra trial days). | table `Coupon` |
| **Grant** | A staff or migration gift of access, a limit, a feature, seats, or AI credits, with an end date and a reason. | table `EntitlementGrant` |

Rules that never bend:

1. **Free is real.** Installing a free edition makes a `Subscription` row with `editionId = "free"`, status `active`, no end date. Code never special-cases "no row".
2. **Limits stop new use, never remove data** (SETTINGS.md §4). Nothing in billing deletes or hides a record, a person, or a file.
3. **Prices are copied into the subscription when sold.** A later admin price change affects new sales and the **next renewal after notice** (§5.6), never the invoice already issued.
4. **Limits are read live** from the catalog (a change applies at once; it only ever stops new use).
5. **Business type is a hint, not a gate.** `businessTypes` in the manifest now only decides which apps are suggested first. The `all_kinds` feature goes away; any business may install any app (§7.3). Roles still use the business type for templates (ACCESS.md §8).
6. **Seats are per business** (ACCESS.md §10), not per app (§7.4).
7. **Dates decide, jobs announce.** Access is worked out from dates at read time; the daily job only sends mail and writes history. A late job never gives free access and never takes it away early (§5.5).

---

## 2. The apps in the marketplace

Apps that exist as manifests today: `crm`, `listings`, `rentals`, `collections`, `projects`, `investments`, `hotel`, `pos`, `invoicing`, `expenses`,
`reviews`, `people`, `agreements` (and `workspace`, always on, never sold). Today their manifests have no real limits or prices (Phase 1: every limit `null`, price `null`).

Apps the owner named that have **no manifest yet**: `payroll`, `accounting`, `restaurant`. Modules that exist in code but are **not apps yet** and are sold today
as plan features: team email (Mail), promotion (featured and boosts), listing check-ups, the API and developer keys, own branding. Recommendation:

| Module | Becomes | Why |
|---|---|---|
| Mail (business email, 1 GB on paid plans) | app `mail` | has its own storage limit and DNS work |
| Promote (featured slots, boosts, banners) | app `promote` | boosts and banners stay pay-per-use (invoice kinds `boost`, `banner`, unchanged); featured slots become a limit |
| API and developer keys | feature `api.access` on paid editions | today's `api` plan feature |
| Own logo, colours, fonts (white-label) | feature `branding.custom` on paid editions (FRONTEND-KIT.md already says Phase 3 makes it an edition feature) | "Powered by Sheetal" stays on free businesses |
| Listing check-ups | part of `listings` and `reviews` editions | no separate price |
| Hotel channel sync (OTA) | feature `hotel.channel_sync` on the hotel `full` edition | today's `channel_sync` |

New manifest field (one, optional, additive): `availability: "live" | "coming_soon"`. A `coming_soon` app shows a card with "Tell me when it is ready" and cannot be installed.
(Owner to confirm the three new apps are shown as coming soon from day one.)

---

## 3. Catalog and prices (all editable, no code)

### 3.1 Where the values live

The manifest holds **first values**. On first start they are copied to the settings store key `platform.catalog` (APP-MANIFEST.md §2 rule 4, SETTINGS.md §2.3). After that
only Admin → Pricing changes them. A new release never overwrites a saved value. Each save raises `catalog.version` and writes an audit row (field names, and old and new
values for non-secret numbers, because prices are not secret).

```ts
// platform.catalog (zod-validated in one place, SettingsService)
interface Catalog {
  version: number;
  periods: readonly (1 | 12)[];                         // months offered for new purchases (admin may add 3 and 6)
  business: {
    freeSeats: number;                                   // seats every business has (recommend 2; today Starter is 1)
    seatAddon:   { priceMonthPaisa: number; priceYearPaisa: number };
    storageAddon:{ unitMb: number; priceMonthPaisa: number; priceYearPaisa: number };
    paidFeatures: string[];                              // feature keys that ANY paid edition switches on: ["custom_roles","multi_property","branding.custom","api.access"]
  };
  apps: Record<string, AppCatalog>;                      // by manifest id
  ai: AiCatalog;                                         // §10
  addons: AddonDef[];                                    // limit packs
}
interface AppCatalog {
  availability: "live" | "coming_soon";
  visible: boolean;                                      // hide from the marketplace without removing subscriptions
  freeEditionEnabled: boolean;                           // false = a paid-only app (for example payroll)
  trialDays: number | null;                              // null = no trial
  editions: Record<string, EditionCatalog>;
}
interface EditionCatalog {
  name: { en: string; ne?: string };
  free: boolean;
  priceMonthPaisa: number; priceYearPaisa: number;       // 0 for free; VAT included
  limits: Record<string, { value: number | null; behaviour: "hard" | "soft"; softOverPct?: number }>;
  features: string[];
  sort: number;
}
interface AddonDef { key: string; appId: string | null; name: { en: string; ne?: string }; limitKey: string; step: number; priceMonthPaisa: number; priceYearPaisa: number; needsPaidEdition: boolean; active: boolean }
```

### 3.2 Permission and safety on changes

| Change | Who | Extra rule |
|---|---|---|
| Edit prices, limits, trial, features | `platform.pricing.manage` (super admin, finance; ACCESS.md §6.2) | a **reason** is required; saved with `effectiveFrom` |
| Raise a price or cut a paid limit that **has paying customers** | same, but a **second staff member approves** (maker-checker, ACCESS.md §9.1 "Platform") | uses table `PlatformApproval` (§15) |
| Cut a **free** limit | `platform.pricing.manage` | the screen shows "N businesses are over this already; they keep their data and cannot add new ones" |
| Hide or turn off an edition that has subscribers | refused | the screen offers "hide from new sales" only |
| Revenue share | super admin only (`platform.revenue_share.manage`) | reason on every change (SETTINGS.md §6) |

### 3.3 Guards (SettingDef `guard`, SETTINGS.md §4)

A price must be `>= 0` and a whole number of paisa; a paid edition's yearly price must not be more than 12 times the monthly price; a free edition's price is 0;
`softOverPct` is 0 to 100; every limit named by the manifest exists. A change that would make an edition's price lower than its coupon-discounted floor is not checked (admin's choice).

### 3.4 Starting prices for the seed file (Owner to confirm, Q5)

Built so a typical set of four apps costs about what Business costs today (Rs 1,500). **VAT included.** Yearly = 10 × monthly (two months free; today's 12-month
discount is 39%, so this is a change: Owner to confirm). All of it is edited in Admin → Pricing before launch.

| App | Free edition (free forever) | `full` edition: limits and features | Rs / month |
|---|---|---|---|
| CRM | 100 leads, 1 pipeline | unlimited leads, assignment, lead finder AI | 300 |
| Listings | 3 listings | 500 listings, check-ups, 8 featured slots | 500 |
| Rentals | 5 leases | unlimited leases, owner statements, online rent | 400 |
| Collections | 10 bookings | unlimited, instalments and reminders | 300 |
| Projects | 1 project, 50 units | 10 projects, 1,000 units | 600 |
| Investments | 1 open investment | 5 open investments, investor updates | 400 |
| Hotel | 5 rooms | 40 rooms, bookings calendar, channel sync | 700 |
| POS | 1 outlet, 100 bills a month (soft) | 3 outlets, unlimited bills, stock | 400 |
| Invoicing | 20 invoices a month (soft) | unlimited, credit notes, tax-office link (`tax.cbms` when live) | 300 |
| Expenses | 50 expenses a month, no recurring | unlimited, recurring, profit, receipts 500 MB | 200 |
| Reviews | 20 reviews a month | unlimited, replies, widgets | 150 |
| People (HRM) | 5 staff records | 50, attendance, leave | 300 |
| Agreements | 2 a month | unlimited, e-signature | 200 |
| Mail | none (locked) | 1 GB shared by all mailboxes, own domain | 200 |
| Payroll (coming soon) | none (paid only) | – | 400 |
| Accounting (coming soon) | 1 ledger, 50 entries a month | – | 500 |
| Restaurant (coming soon) | 1 outlet | – | 400 |

Add-ons: extra team seat Rs 200 a month; extra 1 GB storage Rs 100; limit packs per app (for example +25 listings Rs 300). Business-level free seats: **2**.
Sheetal AI prices are in §10. These numbers are a proposal for the seed file only. The migration price report (§8.5) is how the owner tests them against real businesses.

---

## 4. Money rules (every task follows these)

- Data: `BigInt` columns named `<field>Paisa`. Code: `Money` from `platform/src/core/money.ts` (KERNEL.md §4). No plain-number money maths.
- **Prices include VAT** (13%, setting `platform.billing.vatRatePct`). The invoice shows the split with `Money.splitVat(13)`: VAT = round(total × 13 / 113), subtotal = total − VAT.
- **VAT is worked out once per invoice on the invoice total**, then shared back to the lines with `Money.split()`, so lines always add up to the invoice and no paisa is lost.
- Day maths uses **Nepal days** (UTC+05:45). Dates are stored in UTC. A "day" runs 00:00 to 23:59:59.999 Nepal time (SETTINGS.md §7.1).
- A period's length for proration is the real number of days of that period (`periodEnd − periodStart` in Nepal days), not a fixed 30.
- Gateways: eSewa and Fonepay get rupees with two decimals; Khalti gets paisa. After the payer returns, the **amount in paisa from the gateway must equal the invoice total in paisa** before anything is marked paid (today's rule, now in paisa). Minimum charge: `minChargePaisa` (default 1,000 = Rs 10; a smaller proration is added to the next invoice).
- Old whole-rupee columns (`Invoice.subtotal/vat/total`, `Payment.amount`) stay and are written as the rounded rupee value **for old screens only**. Reports and code read paisa.

---

## 5. Subscription: states, transitions, proration

### 5.1 States

| Status | Meaning | Access (§7.2) | New records |
|---|---|---|---|
| `active` (free edition) | free forever, no end date | `full` within free limits | within limits |
| `trialing` | a paid edition free until `trialEndsAt` (no card) | `full` | within paid limits |
| `active` (paid) | paid until `currentPeriodEnd` | `full` | within limits |
| `past_due` | the paid period ended unpaid; the **grace** period (`graceDays`, default 7) | `full` | yes |
| `read_only` | grace ended, **no free edition** to fall back to (or the edition is paid-only) | `read_only` | no |
| `cancelled` | the owner cancelled; paid access until `currentPeriodEnd` | `full` | yes |
| `expired` | cancelled period ended, or `read_only` lasted `readOnlyDays` (default 60) | free edition if the app has one (`limited`), else `locked` | per edition |

Never reached by billing: deleted data. `locked` keeps every record, and the **"Download my data"** page stays open (CSV and the same exports as today's Data tab).

### 5.2 Transitions

| From | Action | To | Who or what | Rules |
|---|---|---|---|---|
| (none) | install a free app | `active` (free) | owner (`workspace.billing.manage`) | creates the row; adds dependencies the manifest `requires` (free edition) |
| `active` free | start trial | `trialing` | owner | one trial per business per app (`trialUsedAt`, never cleared); not if the app has `trialDays = null`; abuse check in PHASE-3-RISKS.md |
| `trialing` | pay | `active` paid | payment | period starts at payment day |
| `trialing` | trial ends unpaid | `active` free (`expired` event) | job | app without free edition: `locked`, data kept |
| `active` free or `trialing` | buy | `active` paid | payment | full price from today (no proration of a first purchase, except §5.3 co-terming) |
| `active` paid | upgrade edition | `active` paid | payment | at once; prorated (§5.3) |
| `active` paid | downgrade edition | `active` paid | scheduled | takes effect at `currentPeriodEnd`; shows what will be limited; no refund |
| `active` paid | switch month ↔ year | `active` paid | payment | month → year: unused days of the month are credited, the year is charged, the period restarts today. year → month: at the end of the year |
| `active` paid | owner cancels | `cancelled` | owner | access until the period end; "Undo cancel" until then |
| `active` paid, `cancelled` | period ends unpaid | `past_due` | dates | renewal invoice stays open |
| `past_due` | pays | `active` paid | payment | period continues from the old end date (no gap, no double) |
| `past_due` | grace ends | free edition `limited`, or `read_only` | dates | §5.5 |
| `read_only` | pays | `active` paid | payment | |
| `read_only` | `readOnlyDays` pass | `expired` (`locked`) | dates | export stays open |
| any paid | staff refund (full, in window) | free edition or `locked` | approved refund | §11 |
| any | staff grant / gift | grant row, not a status | staff | `EntitlementGrant` with end date and reason |

Every transition writes one `SubscriptionEvent` (who, from, to, invoice, amount, reason) and publishes `billing.subscription.changed` through the outbox (KERNEL.md §9).

### 5.3 Proration rules (NPR, paisa)

Words: `gross` = the VAT-included price. `days(a,b)` = Nepal days from a to b. `total = days(periodStart, periodEnd)`, `left = days(today, periodEnd)` (today counts as a full day left).
Amounts use `Money.times(left / total)` with rounding half away from zero.

| Case | Rule |
|---|---|
| **First purchase, no other paid app** | Full price from today. This business's **monthly anchor** becomes today (day of month, capped at 28). |
| **New app joins a business that already pays monthly** (co-terming) | Charge `price × left / total` until the business's next anchor date; after that one invoice covers every app. If fewer than `minFirstPeriodDays` (default 5) days remain, the first period runs to the **following** anchor and is charged `price × (left + nextTotal) / nextTotal`. |
| **Yearly apps** | A yearly subscription keeps its own anniversary; it is not co-termed with the monthly anchor. |
| **Upgrade mid-period** | `credit = oldGross × left / total`; `charge = newGross × left / total`; `due = charge − credit` (never below 0). Dates do not change. Add-ons are not repriced. |
| **Downgrade** | Scheduled for `currentPeriodEnd`. No credit, no refund. |
| **Add-on bought mid-period** | `unitGross × qty × left / total` for the **parent period** (seats and storage use the business's monthly anchor). It renews with the parent. Removing it takes effect at the next renewal (as today). |
| **Coupon** | Applied to the **gross** after proration, once per invoice, before VAT is split. A coupon never makes a line negative. One coupon per invoice. |
| **Price protection** (migrated businesses, §8) | A visible negative line "Price protection until {date}" so the invoice total equals the lower old price. |
| **Rounding** | Each invoice total is a whole number of paisa. Lines are rounded first, the total is their sum, VAT is split from the total. |

Worked example 1: upgrade from Full (Rs 400 a month) to Pro (Rs 700 a month) with 12 of 30 days left.
`credit = 40,000 × 12/30 = 16,000` paisa (Rs 160). `charge = 70,000 × 12/30 = 28,000` (Rs 280). `due = 12,000` (Rs 120). VAT inside it: `12,000 × 13/113 = 1,380.53 → 1,381` paisa. Subtotal 10,619 paisa.

Worked example 2: a Rs 300 a month app joins a business whose next anchor is 14 days away in a 30-day cycle: `30,000 × 14/30 = 14,000` paisa (Rs 140). At the anchor, one invoice charges 30,000 for the app plus the others.

Worked example 3: a coupon of 20% on Rs 400 (40,000 paisa): discount 8,000, total 32,000 paisa; VAT inside 32,000 × 13/113 = 3,681.42 → 3,681; subtotal 28,319.

These three become test cases (PHASE-3-TASKS.md, P3-BE-2) and live in a table-driven test file.

### 5.4 The quote

One pure function used by the screens and the checkout, so the number the person sees is the number charged:

```ts
quote(input: { now: Date; business: BillingState; items: CartItem[]; couponCode?: string; catalog: Catalog; settings: BillingSettings }): Quote
// CartItem = { kind: "subscribe"|"change"|"addon"|"renew"; appId; editionId; periodMonths; qty? }
// Quote = { lines: QuoteLine[]; discountPaisa; subtotalPaisa; vatPaisa; totalPaisa; dueAt; notes: Text[]; warnings: Text[]; errors: Text[] }
```

It never reads the clock or the database itself. The checkout builds an invoice from the same quote and stores it, so a price change between "see" and "pay" cannot change the amount (the invoice is the promise; it is valid for `quoteHours`, default 24).

### 5.5 What "past due" and "read-only" mean (payment fails)

Nepal wallets keep no card on file, so nothing is ever charged automatically (today's rule stays). A "failed payment" is one of two things:

1. **The gateway says failed or the payer leaves.** `Payment.status = failed`, the invoice stays open, nothing about access changes, the payer can try again or choose another method.
2. **The renewal is not paid by `currentPeriodEnd`.**

Timeline for a monthly renewal (all day counts are settings; defaults shown):

| Day | What happens | Access |
|---|---|---|
| −7 and −1 | Renewal invoice is ready; mail and in-app reminder (reminders in `platform.billing.reminderDays`) | full |
| 0 | `past_due`; mail "everything keeps working until {date}" | full |
| +3, +6 | reminders; staff see the business in "Payments due" | full |
| +7 (`graceDays`) | grace ends | app **with** a free edition: moves to the free edition, mode `limited` (all data stays, over-limit items stay viewable and editable, **no new** items beyond the free limits). App **without** a free edition: `read_only` |
| +7 to +67 | `read_only` (view, search, print, export) | no new records |
| +67 (`readOnlyDays`) | `locked`: the app page explains and offers payment and **Download my data** | none (data kept) |

A business keeps its data **forever** in Phase 3. Billing never deletes anything. A retention rule (for example after 24 months) would be a later, owner-approved policy, with warnings (Owner to confirm).

Because dates decide (rule 7), `effectiveStatus(sub, now)` is a pure function used by Entitlements. The job only writes the matching `SubscriptionEvent`, sends mail, and updates the stored `status` so staff lists are fast. If the job is a day late, nobody gets free access or loses access early.

Seats: a business whose paid seats lapse keeps its team during grace. If extra seats are still unpaid **14 days** after the grace ends (`seatAutoPauseDays`), the newest members above the limit (never the owner) are **paused, not removed**, with a mail to the owner; paying resumes them at once. (Owner to confirm.)

Public intake while a business is `read_only` or `locked`: contact forms and lead forms keep **accepting** messages into the inbox (a customer's message is never lost); online **bookings and payments** are refused with a plain message on the public page. (Owner to confirm.)

### 5.6 Price changes and notice

- A new price applies to **new sales at once** and to **existing subscriptions at their next renewal after `priceChangeNoticeDays`** (default 30). The subscription keeps its copied price until then.
- When an admin saves a price rise that has paying customers (after the second approval), the system queues one notice mail per affected owner with the old price, the new price and the date. The renewal invoice shows the new price only on or after that date.
- A price **cut** applies to every renewal after it is saved, and never creates a refund.
- Limits are not prices: a cut to a paid limit is also announced (same notice period) but, like every limit, it only stops **new** use.

---

## 6. Entitlements from subscriptions

### 6.1 What changes in the kernel

KERNEL.md §5.3 says: "in Phase 3 it is built from per-app subscriptions". The interface keeps its methods; it gains three:

```ts
export interface Entitlements {
  hasApp(appId: string): boolean;                       // access is full, limited or read_only (not locked, not uninstalled)
  edition(appId: string): string | null;                // "free" | "full" | "pro"…; during a trial, the trial edition
  limit(appId: string, key: string): number | null;     // null = unlimited
  feature(key: string): boolean;
  seats(): { used: number; limit: number | null };
  ai(appId: string): "locked" | "own_key" | "sheetal";
  // new in Phase 3 (additive):
  access(appId: string): "full" | "limited" | "read_only" | "locked" | "none";
  requireWrite(appId: string): void;                    // throws AppError 402 "subscription_read_only"
  requireLimit(appId: string, key: string, o: { used: number; adding?: number }): { warn: boolean; over: boolean };   // throws AppError 402 "limit_reached" on a hard stop
}
```

Files: `platform/src/billing/entitlements.ts` (the builder; FOLDERS-AND-MOVE-PLAN.md already reserves the name), `platform/src/billing/effective-status.ts` (pure),
`platform/src/billing/limits.ts` (pure). Phase 2 apps already call `ctx.entitlements.limit()` and `requireLimit()` (KERNEL.md §7); they do not change.
Today's `buildEntitlements()` in `platform/src/tenancy/context.ts` stays as the "v1" builder; both implement the same interface and one **contract test file** runs against both.

### 6.2 How each answer is built

```
inputs (3 queries per request, cached 30 s per business, cleared on billing.subscription.changed):
  subs   = Subscription rows of the business
  grants = EntitlementGrant rows not ended or revoked
  addons = AddonSubscription rows with qty > 0
  cat    = platform.catalog (settings cache)

access(app)   = from effectiveStatus(sub, now) and cat.apps[app].freeEditionEnabled     (table in §7.2)
edition(app)  = trial edition while trialing; the paid edition while active/past_due/cancelled; "free" when limited
limit(app,k)  = max( cat.editions[edition].limits[k], active grants for (app,k), + add-on extras for k )      // null (unlimited) wins
feature(key)  = any subscription in full/limited access whose edition lists key
                OR key in cat.business.paidFeatures AND the business has any paid subscription in full access
                OR an active grant for key
seats()       = limit: see §7.4;  used: countSeats() (unchanged, ACCESS.md §10)
ai(app)       = "own_key" if a live business connection supports the feature; else "sheetal" if credits are left; else "locked"   (§10)
```

A limit raised by a grant or add-on never lowers anything. `-1` in old data is read as `null`.

### 6.3 What happens at a limit (the owner decides per limit, Q1)

Each limit in the catalog carries `behaviour: "hard" | "soft"` and, for soft, `softOverPct` (default 20). The admin changes both without code. At **80%** of a limit the app shows a soft banner (once a day, dismissible for 7 days). At 100% the rule is:

| Kind of limit | Examples | Recommended behaviour | At 100% |
|---|---|---|---|
| Records and setup (a count that stays) | listings, rooms, outlets, projects, units, staff records, leads | `hard` | the **new** one is refused with `limit_reached`; existing ones are untouched and editable |
| Money-in activity (per month) | POS bills, customer invoices, bookings | `soft`, 20% | allowed up to 120%, with a stronger banner; then refused. A sale is never lost at the till on the first day over. |
| Other activity (per month) | expenses, reviews replies, agreements | `hard` | refused until next month or upgrade |
| Storage | receipt storage, mail storage, photos | `hard` at 100% | new uploads refused; downloads and reads fine |
| Seats | team members | `hard` | no new invitation, no un-pausing (ACCESS.md §10 bug fix stays); extras auto-paused after grace (§5.5) |
| AI credits (Sheetal AI) | credits a month | `hard` | only AI actions stop, with "Buy credits or connect your own key" |

The error body is always the same, so one front-end panel handles every app:

```json
{ "error": { "code": "limit_reached", "message": "Your Free Hotel has room for 5 rooms and 5 are used.",
  "details": { "appId": "hotel", "key": "rooms", "limit": 5, "used": 5, "behaviour": "hard", "tryEdition": "full", "tryPricePaisa": 70000 } } }
```

Old codes (`seat_limit`, `listing_limit`, `plan_feature`, `upgrade_needed`) keep working for one release: the front-end maps all of them to the same panel, then the old names are removed (task P3-FE-2).

---

## 7. Access, install, types, seats

### 7.1 Install and remove

- **Install** = create the `Subscription` row (free edition). One click, no card, needs `workspace.billing.manage` (owners; ACCESS.md §6.1 maps today's `billing.manage`). Apps the manifest `requires` are installed with it (free edition) and shown first ("This also adds Invoicing, free").
- **Remove** = set `uninstalledAt`. The menu item disappears; **data stays**; a paid subscription is cancelled at period end first (no refund). Installing again restores everything.
- Roles are unchanged: `canUseApp = hasApp && role grants one permission of the app` (ACCESS.md §7). New refusal text for a locked app: "Your subscription for {App} is paused. Renew to open it again. Your data is safe."

### 7.2 Access modes

| Mode | Read, print, export | Edit existing | Create new | Public intake (forms, leads) |
|---|---|---|---|---|
| `full` | yes | yes | yes (limits apply) | yes |
| `limited` (free edition after a paid one ended) | yes | yes | only below the free limits | yes |
| `read_only` | yes | no | no | leads yes, paid bookings no |
| `locked` | export page only | no | no | leads yes, paid bookings no |
| `none` (not installed) | no | no | no | no |

`requireWrite(appId)` is called by the kernel service for every create, update and delete (one place, `BaseService.action()`), so an app cannot forget it. Background jobs call `access()` first and **skip** (and log) a business that is not `full` or `limited`.

### 7.3 Business types

`businessTypes` (hotel, host, developer, agency, sponsor) stay for role templates and for the order of cards in the marketplace ("Popular for hotels"). They no longer hide apps. The plan features that widened the type (`all_kinds`) disappear; their effects move:

| Today | In Phase 3 |
|---|---|
| `typesFor(tenant, plan)` / `kindsFor()` widen modules and listing kinds on Pro | the listing kinds a business may create come from the apps it has (`listings` edition feature `kinds.*`; Hotel, Projects, Investments each add their kind) |
| `LIMIT_KEYS[type]` decides which limits a screen shows | the manifest `limits` of the installed apps |
| Business creation asks for a type | still asks (templates, hints); installs that type's suggested apps for free |

(Front-end task P3-FE-2 replaces the three helpers in `shared/src/core/plans.js`; the file stays until nothing imports it.)

### 7.4 Seats

- Seats stay a **per-business** number (ACCESS.md §10 allowed per-app only if the owner decided otherwise; recommendation: do not).
- `seats limit = max(catalog.business.freeSeats, the largest edition.limits.seats among the paid editions in full access) + seat add-ons + seat grants`.
  Using the **largest** (not the sum) means buying five apps does not stack five seat bonuses.
- Message: "Your plan has N seats and M are taken." (the text ACCESS.md §10 promised).
- Today's rules stay: active members plus unexpired invitations count; paused members do not; staff impersonation does not.

---

## 8. Migration: from Starter / Business / Pro to app subscriptions

Goal (the owner's): **nobody loses access, and nobody pays more on day one.** The method is the same as `rewrite-role-perms.mjs`: a script you can read first (dry run), run (apply) and undo (restore), that **proves** its own result before it writes.

### 8.1 Rules (R1 to R11)

| # | Rule |
|---|---|
| R1 apps | A business gets every app that today's `buildEntitlements().hasApp()` says it has (type rule, and all types on Pro). Each becomes an **installed** subscription. |
| R2 edition | The edition is `full` when the plan is paid (Business or Pro) **and** the app's gate is on: `pos` needs `features.pos`, `agreements` needs `features.agreements`, hotel channel sync needs `features.channel_sync`. Everything else on a paid plan is `full`. Starter is `free`. |
| R3 limits | For every old limit key (table 8.2): `grant = old limit` when it is higher than the new edition's limit. The grant ends at `lockEnd` (R8). Old limits that were never enforced (for example Expenses on Starter) are checked against **current usage**: if usage is above the new free limit, a grant of "unlimited" until `lockEnd` is written. |
| R4 seats | Old seats (plan seats plus bought seat add-ons) become a seat grant until `lockEnd`. |
| R5 AI | The plan's monthly credits (the numbers in `ai.features`, today's defaults 500 / 2000 / 6000) become a monthly credit grant until `lockEnd`. Own Anthropic keys (`ai.tenant.<id>`) become Integration Center connections (INTEGRATIONS.md §9.1, run by that task, not this one). |
| R6 features | `custom_roles`, `multi_property`, `api`, `branding.custom` are kept by the paid editions' feature lists (§3.4, `paidFeatures`). `all_kinds` is replaced by R1. |
| R7 add-ons | `TenantAddon` rows become `AddonSubscription` rows with the **old price** copied. They stay in the protected price. |
| R8 dates and status | Every paid subscription gets `currentPeriodEnd = Tenant.renewsAt`, `periodMonths = Tenant.period`. `trial` → `trialing` with `trialEndsAt = renewsAt`. `past_due` → `past_due` with the same `graceUntil`. `active` → `active`. `suspended`, `cancelled`, `pending_verification` and `demo` businesses are **skipped and listed**; they are mapped when staff reactivate them (the script is safe to run again). `lockEnd = renewsAt + migrationLockMonths` (12) for paid; `migrationDate + migrationFreeLimitDays` (90) for free. |
| R9 covered | A business covered by another business's Pro (`coveredById`) gets the Pro mapping with `source = covered`; the job that replaces `syncCovered()` keeps it in step with the parent until the parent's `lockEnd`. |
| R10 invoices | Open `plan` and `addon` invoices with no payment in flight are **voided** (the renewal job makes new ones). A business with a payment in flight (`initiated`, `pending_review`) is **skipped until it settles**. `boost` and `banner` invoices are never touched. Paid invoices are never touched. |
| R11 plans | `Plan` rows, `Tenant.planId`, `renewsAt`, `period` stay exactly as they are (needed for the go-back plan, §8.6). Nothing is deleted. |

### 8.2 Mapping table: old limits and features to apps

| Old key | New app and key | Note |
|---|---|---|
| `rooms` | `hotel.rooms` | hotel type |
| `units` (host) | `hotel.rooms` | a host's "homes or rooms" |
| `units` (developer) | `projects.units` | |
| `projects` | `projects.projects` | |
| `listings` | `listings.listings` | agency; Pro `-1` = unlimited |
| `stays` (Pro) | `listings.stays` | |
| `investments` | `investments.open_investments` | sponsor |
| `outlets` | `pos.outlets` | |
| `seats` | business seats (§7.4) | |
| `featured` | `promote.featured_slots` | the Promote app is new |
| plan mail quota (1 GB when paid) | `mail.storage_mb` | |
| `features.pos` | `pos` edition `full` | R2 |
| `features.agreements` | `agreements` edition `full` | R2 |
| `features.channel_sync` | `hotel` feature `hotel.channel_sync` | |
| `features.custom_roles`, `multi_property`, `api` | business `paidFeatures` | |
| `features.all_kinds` | R1 | |
| `AI_CREDITS[plan name]` | monthly credit grant | R5 |

### 8.3 Price protection

Table `BillingLock` (one row per migrated paying business): `{ tenantId, legacyMonthlyGrossPaisa, legacyPeriodMonths, coversApps[], lockEnd }`, where `legacyMonthlyGrossPaisa = plan price + add-ons` in paisa.
At each renewal the invoice maker works out the normal total `T` for `coversApps` and the legacy total `L = legacyMonthly × months` (the old plan's multi-month discount is copied: `priceFor(price, months)` from `domain/plans.ts`).
If `L < T`, the invoice gets one negative line **"Price protection until {lockEnd}"** of `L − T`. Apps the business adds later are not covered and are charged normally. If it drops covered apps, `T` shrinks and `min(L, T)` follows. After `lockEnd` the line stops.
Result: the **renewal price is never higher than before**, and the invoice says why it is lower than the catalog.

At `lockEnd − 60 days` the billing page shows "Your new price: X. Choose the apps you keep." Apps the owner does not keep fall to their **free edition** (never to nothing).

### 8.4 The script: `backend-core/scripts/migrate-plans-to-apps.mjs`

Same shape as `rewrite-role-perms.mjs`: plain Node with the installed `@prisma/client`, `DATABASE_URL` from the shell, else `backend-core/.env`, else root `.env`. From the repo root:

```
node backend-core/scripts/migrate-plans-to-apps.mjs                  (= --dry-run: prints per business what would be written, writes nothing)
node backend-core/scripts/migrate-plans-to-apps.mjs --apply          (writes in ONE transaction per business, all-or-nothing per business)
node backend-core/scripts/migrate-plans-to-apps.mjs --restore        (removes rows of the last run; refuses if a business has a v3 sale; --force to override)
add --verbose (every row), --business=ID[,ID] (try one first), --csv=path (price report), --catalog=path (a catalog JSON to test prices against)
```

It reads the **same generated registry the servers use** (`platform/src/tenancy/apps.generated.ts`) and the same catalog source (`platform.catalog`, else the manifests), and calls the **same pure functions** the live code uses (`buildEntitlementsV1`, `buildEntitlementsV3`, `quote`). Nothing is copied by hand. Business names are masked to 2 letters plus the id.

**The proof** (before any write, per business; `--apply` refuses on any FAIL):

| Proof | Check | If it fails |
|---|---|---|
| P1 access | for every app, limit key, feature, seat count and AI credit, `v3 ≥ v1` (null = unlimited counts as largest) | never written; always refuse |
| P2 usage | for every limit key, `v3 limit ≥ current usage` (so nobody is "over" on day one) | refuse unless the business is listed on `ALLOWED_OVER` |
| P3 price | first renewal total in paisa with `BillingLock` `≤` the old renewal total (plan + add-ons), VAT included | refuse |
| P4 dates | `currentPeriodEnd = renewsAt`, status mapping as R8, `graceUntil` copied | refuse |
| P5 data | row counts of listings, rooms, bookings, leads, invoices, receipts, members, files are equal before and after; `Tenant.planId` unchanged | refuse |
| P6 invoices | no paid invoice changed; only the open plan/addon invoices without payments are voided | refuse |
| P7 idempotent | a second dry run changes nothing | refuse |
| P8 unknown | an unknown plan id, type, or add-on is **listed and skipped**, never guessed | listed |

It ends with a summary line and PASS or FAIL (exit code 0 or 1), like `check-branch-links.mjs`. `--restore` uses `migrationRunId` stamped on every row the run created (§15); it removes those rows and sets `Tenant.billingMode` back to `plans`.
Tests: `backend-core/test/migrate-plans.test.ts` builds a fixture for every type × plan × add-on × status combination, runs the dry run and the apply, and asserts every proof.

### 8.5 The price report (the owner's tool)

`--csv=p3-price-report.csv` writes one row per paying business: old monthly price, today's protected price, the price **after the lock** if the business kept every app, the price if it kept only the apps it actually used in the last 90 days, and the percent change. The owner uses it to adjust the catalog **before** launch, and it is sent to QA as the proof that Q5 prices do not hurt the existing customers.

### 8.6 Cutover and "go back"

Per business flag `Tenant.billingMode`: `plans` (today) → `shadow` → `apps`.

| Step | Mode | What runs | Who sees what |
|---|---|---|---|
| 1 | `plans` | v1 builds entitlements. Migration rows exist but nothing reads them | no change for anyone |
| 2 | `shadow` | v1 answers every request; v3 is **also** built and any difference is written to a log (`entitlements.shadow_diff`) | no change; staff see the diff count in Admin → Billing |
| 3 | `apps` for Sheetal's own business, then 5 pilot businesses (owner picks) | v3 answers; the marketplace is visible; sales are on | pilot sees the new billing page |
| 4 | `apps` for everyone | after **7 days with zero shadow differences** and QA sign-off | all |

Go back:

- **Before the first v3 sale:** set the flag back to `plans`. Nothing was lost because the old plan columns were never changed. Zero data loss, zero money loss.
- **After v3 sales exist:** switch **sales off** (`platform.billing.salesEnabled = false`), keep v3 serving, fix forward. Do not flip back to `plans`: a business that bought an app in v3 would lose it. A full restore from the pre-cutover backup is the disaster path only (OPS runbook).
- The script's `--restore` handles the "migration ran, nothing sold" case for one business or all.

Old routes (`/billing`, `/billing/checkout`, `/billing/quote`, the admin plans and add-ons pages) keep answering from the legacy data until `apps` mode is on for that business, then they return the new shape or a plain "This moved to the marketplace" message with a link.

---

## 9. Invoices, receipts and the tax office (Nepal)

I am not a tax adviser and I did not have the IRD rules. Items marked **Accountant to confirm** must be checked before launch (listed in PHASE-3-RISKS.md as a launch gate).

### 9.1 What is issued and when

| Document | When | Number series (per fiscal year, via `DocCounter`) |
|---|---|---|
| **Payment request** (what the payer sees before paying: lines, VAT, total, valid 24 h) | when the checkout starts or a renewal is due | none; shown as "Request #{seq}" |
| **Tax invoice** | **when the payment is confirmed** (gateway verified, or a bank proof approved) | `INV-2083-84-0001` |
| **Receipt** | same moment, same page (one printable page: "Tax invoice and receipt") | uses the invoice number |
| **Credit note** | when a refund is approved | `CN-2083-84-0001`, points to the invoice it reduces |

Why issue on payment: a request that is never paid needs no tax invoice, so the numbers never have gaps or "void" holes. Today's design makes an open invoice with a number at reminder time and voids it later; that leaves gaps. (Accountant to confirm that "time of supply = payment" is right for prepaid subscriptions.) A zero-total purchase (100% coupon, a gift) is recorded as a **receipt-less notice** and takes no tax invoice number (Accountant to confirm).

### 9.2 Numbering

- Key `INV:2083-84`, `CN:2083-84` in `doc_counters` with `tenant_id = "__platform__"` (the table's `tenant_id` has no foreign key; invoicing already uses this table with `INSERT … ON CONFLICT DO UPDATE … RETURNING`, `business/backend/src/modules/invoicing/routes.ts nextNo`). The same atomic statement runs **inside the payment transaction**, so two payments at once get two numbers and a failed transaction gives its number back (no gap).
- Format `docNo(prefix, fy, n)` already exists in `domain/money.ts`. Fiscal year `fiscalYearOf()` exists; it starts on Shrawan 1 (about 17 July): 17 July 2026 to 16 July 2027 is **2083-84**.
- **Two things to fix in `fiscalYearOf()`** (task P3-BE-4, with tests): (1) it compares in UTC, but a Nepal day starts 5 h 45 m before UTC midnight, so a payment at 01:00 Nepal time on Shrawan 1 gets the old year; add 5:45 before comparing. (2) The `SHRAWAN_1` table must be **checked against the official calendar before every Shrawan** (a yearly checklist item in the OPS runbook).
- Old invoices keep their old numbers (`INV-2026-0012`, from the global `seq` and calendar year). Screens show `no ?? legacyNumber`.

### 9.3 What the tax invoice shows (editable parts are settings)

| Field | Source |
|---|---|
| Seller: legal name, address, **PAN** (and VAT registration), phone, email | `platform.company` (editable). Copied into `Invoice.sellerSnapshot` at issue, so a later change never alters an issued invoice. The technology company is **never named**; the public brand "Sheetal Property" appears only as the trade name if the legal name differs (Accountant to confirm what the law requires as the seller name). |
| Buyer: name, address, PAN, VAT-registered yes/no | `Invoice.billedTo` (today's snapshot). A business must have its **required tax details** before its first paid purchase (§14.3). |
| Number, **AD date and BS date**, fiscal year | `no`, `issuedAt`; BS date from `shared/src/core/bs.js` (the DB specialist and FE confirm it is exact; Accountant to confirm) |
| Lines: app, edition, period, quantity, rate, discount, taxable value, VAT, total | `InvoiceLine` |
| Totals: taxable, VAT 13%, total, **amount in words** (English, and Nepali on request) | computed |
| Payment method and reference | `Payment` |
| Footer and terms text | `platform.billing.invoiceFooter` (editable; **Accountant to confirm** required wording) |

PAN is on invoices, which only the business and staff see. It is **not** on any public page or public API (TEAM-RULES: no internal company details publicly). The public site shows only the brand.

### 9.4 What the tax office needs from the software (verify with the accountant)

| Point | Design answer |
|---|---|
| Consecutive numbering per fiscal year, no gaps, cancelled documents kept | §9.2; credit notes instead of edits; nothing deleted |
| Invoice cannot be changed after issue | issued rows are append-only (no update path; a database trigger blocks `UPDATE` of issued money columns) |
| Credit note refers to the original invoice | `creditForId`, original number printed |
| Buyer PAN on B2B invoices | required field before the first purchase |
| Software registration and live sync with IRD's billing system (CBMS) | **Owner to confirm** whether Sheetal's own invoices must be sent. If yes: event `billing.invoice.issued` is consumed by the `tax.cbms` integration at **platform scope** (INTEGRATIONS.md §13 #19, which lists "platform software registration noted"). A failed send **never blocks the payment or the invoice**; it goes to the retry queue (`EventDelivery`) and shows in Admin → Billing → "Not sent to IRD". |
| Records kept for years | invoices, lines, credit notes and revenue entries are never deleted; the export keeps a CSV per fiscal year (`platform.billing.export`, audited) |
| VAT return | Admin → Billing → VAT summary per month (Nepal time): taxable, VAT collected, VAT on credit notes |

### 9.5 Receipts for businesses' own customers

Customer invoices that a **business** makes in its own Invoicing app (`BizInvoice`, series `INV/CN/RC` per business and fiscal year) are a different thing and do not change in Phase 3. Only their **free-edition limit** (invoices a month) and the optional `tax.cbms` link are catalog items.

---

## 10. AI: Sheetal AI or your own key

### 10.1 The three states of every AI feature (TEAM-RULES)

| State | What the person sees | Who pays |
|---|---|---|
| **locked** | a preview: the feature's panel with a sample result on example data and a button "Turn on AI" | nobody (a static preview, no model call) |
| **own_key** | the real feature | the business, at its own provider |
| **sheetal** | the real feature | the business, through its Sheetal AI subscription (credits) |

`Entitlements.ai(appId)` returns the state. The manifest `ai[]` lists each feature with its capability (`text`, `vision`, `voice`); the router uses it to pick a provider.

### 10.2 Sheetal AI plan (business-level, not per app)

A business-level product in the catalog (`catalog.ai.plans`), edited in Admin → Pricing → Sheetal AI. Starting values (Owner to confirm, Q4 and Q5):

| Plan | Rs / month (VAT incl.) | Credits a month | Includes |
|---|---|---|---|
| Preview (free) | 0 | 0 (14-day trial: 100 once) | locked previews in every app |
| AI Lite | 300 | 1,000 | all text and vision features |
| AI Plus | 800 | 4,000 | + voice assistant (credit rate in §10.4) |
| AI Max | 1,800 | 12,000 | + priority model, bigger files |
| Top-up | 200 | +1,000 (valid 90 days) | any plan |

Today's credits (Starter 500, Business 2,000, Pro 6,000 a month; 1 credit ≈ 1,000 tokens, at least 1) are kept for **migrated** businesses as grants (R5).

### 10.3 Metering with `AiUsage`

- `AiUsage` stays the log (one row per call: feature, model, tokens, credits, `own`). Phase 3 adds `appId`, `provider`, `source` ("sheetal" | "own"), `requestId`.
- New table `AiCreditGrant` (`credits`, `remaining`, `source` allowance | pack | gift | migration | trial, `expiresAt`). The renewal job adds the monthly allowance grant (expires at `currentPeriodEnd`); a top-up adds a 90-day grant.
- Spending: in **one transaction**, the call's credits are taken from the grants that expire first (`SELECT … FOR UPDATE`, decrement `remaining`), and the `AiUsage` row is written. Balance = sum of `remaining` where not expired. A call that cannot be covered is refused **before** the model is called (`ai_credits_used`, 402).
- Credits for `own` keys are **not** taken. The existing optional monthly cap for own keys stays (`TenantAi.cap` moves into the connection config).
- Rates (credits per 1,000 tokens by model class, credits per minute of voice) are catalog settings (`catalog.ai.rates`); the admin changes them without code. Credits of a failed provider call are refunded to the grant in the same request.

### 10.4 Own key (Integration Center)

Providers (INTEGRATIONS.md §13): `ai.anthropic` (Claude), `ai.openai`, `ai.gemini`, `voice.elevenlabs`; all at **business scope**, entered by the owner, sealed with the vault, with test, `live`, `paused`, health and the staged-change rule. Today's single Anthropic key in `ai.tenant.<id>` moves into `ai.anthropic` (INTEGRATIONS.md §9.1).

Provider choice per feature: the feature's capability → the business's **preferred provider** setting (default: first live connection that supports it) → else Sheetal AI if credits remain → else locked. If the own key fails (bad key, provider out of credit), the call **fails with a clear message**; it falls back to Sheetal credits only if the owner switched on "If my key fails, use Sheetal AI" (default off, so nobody is charged by surprise). Sheetal can still switch own keys off for everyone (`integration.ai allowOwnKeys` today).

Keys never reach a browser, are never logged, and are write-only after saving (the rule today's `aiaccount` routes already follow).

---

## 11. Refunds

Refunds are **approvable** (ACCESS.md §9; `platform.billing.refund` is already on the list) and are always **credit notes**, never an edit of an invoice.

1. **Request.** Staff with `platform.billing.refund` opens a paid payment: amount (full or part), reason, and "end access now?". It creates a `PlatformApproval` (action `platform.billing.refund`, amount, payload).
2. **Approve.** A **different** staff member with the approver permission approves within 72 h (a super admin cannot approve their own request). With only one staff member allowed, the rule is skipped and the audit row says so (ACCESS.md §9.4 rule for one-person teams).
3. **Run.** In one transaction: a credit note is issued (`CN-…`), `Payment.refundedPaisa` goes up, **negative** `RevenueEntry` rows reverse the original percentages (commission and partner share are not recalculated at today's rates), and the subscription changes if "end access now" was ticked (full refund inside `refundWindowDays`, default 7, of the **first** purchase of that app: back to the free edition or `locked`).
4. **Pay the money.** The refund goes out in the gateway's or bank's own portal (docs/payments.md: no refund API is used). Staff then record the reference and the date (`money_sent`). Until then reports show it as "refund pending".
5. **Partial refund** of a bundle invoice refunds named lines.

Policy defaults (editable text and numbers): full refund within 7 days of the first purchase of an app; no refund of a used period otherwise; goodwill refunds by staff discretion (always approved by a second person). (Owner to confirm.)

---

## 12. The two payment systems

| | **Sheetal's system** | **The business's own system** |
|---|---|---|
| Whose merchant account | Sheetal's | the business's |
| Used for | the website, app subscriptions and add-ons, boosts and banners, AI credits, **rent of properties Sheetal manages** | only inside that business's apps: its invoices, POS, hotel bills, rent of properties **it** manages |
| Set up by | super admin, in the Integration Center at **platform scope** | the business owner, at **business scope** |
| Methods | eSewa, Khalti, Fonepay (exist), Fonepay dynamic QR (to build), bank card gateway (Siddhartha Bank or Global IME Bank: in the legal process), manual bank transfer with proof | **free static QR** at first (a payment method, no review); eSewa, Khalti, Fonepay, QR, card **after a document-checked onboarding request** (INTEGRATIONS.md §4 `in_review`) |
| Commission | yes (§13) | none: those payments never touch Sheetal's money |
| If it is not set up | the method is hidden at checkout | the app offers only static QR and "record cash/bank manually" |

Rules the code enforces (task P3-BE-9, `PaymentRouter`):

```ts
resolve(ctx, purpose): PaymentMethod[]
// purpose ∈ { "sheetal.subscription", "sheetal.website", "sheetal.managed_rent", "business.invoice", "business.pos", "business.rent_self" }
// sheetal.*  → platform connections, state live and health not down, mode live (staff test mode excepted)
// business.* → that business's connections, then its static QR. NEVER Sheetal's. No fall-back to Sheetal's merchant (INTEGRATIONS.md §14: a legal and accounting problem).
```

- A subscription **cannot** be paid with a business's own gateway, and a business's customer **cannot** pay through Sheetal's. A test in P3-QA checks both directions.
- The card gateway needs nothing in billing when it arrives: the Integration Center spec `card` already exists; when its connection is `live`, the `PaymentRouter` returns it and the checkout shows a "Card" button. No billing code change (this is the point of INTEGRATIONS.md: credentials arrive later, no code change).
- Checkout verifies the paisa amount (§4) and the gateway's status API before marking paid; coming back twice changes nothing (idempotent `applyPayment`, today's rule).
- Manual bank transfer: the business uploads a proof; a staff member approves (a second pair of eyes is available through `PlatformApproval` if the owner switches it on for amounts above a limit). Approval issues the tax invoice at that moment.
- Payments made in **test mode** (`Payment.mode = "test"`) are kept apart and never reach reports (SETTINGS.md §7.4).

---

## 13. Commission and technology partner share: where it is computed and reported

Settings: `platform.revenueShare` (SETTINGS.md §6) gets one more block:

```ts
appSales: {
  commissionPct: number;                 // Sheetal's commission on the sale without VAT. Default 100 until the owner enters the real split (Q3).
  perApp?: Record<string, number>;       // override per app (precedence: perApp → commissionPct)
  perEdition?: Record<string, number>;   // optional: "hotel.full" → 25
}
// technologyPartner { enabled, name, sharePct, appliesTo, apps } as already defined: the share is a % of Sheetal's commission
```

**Computed once, when the payment is confirmed, inside the same transaction** that issues the invoice (`applyPayment` v3). One `RevenueEntry` per invoice line:

```
gross      = line total (VAT included)                       paisa
vat        = share of the invoice VAT for this line          (Money.split, lines add back to the invoice)
net        = gross − vat
commission = Money.percent(net, commissionPct)               nearest paisa
partner    = Money.percent(commission, partner.sharePct)     only if enabled and the app is covered
sheetalNet = commission − partner
publisher  = net − commission                                (what is not Sheetal's; zero when commission = 100%)
```

Stored on the row, with the **percentages used** (`commissionBp`, `partnerBp`) and `catalogVersion`. Reports **sum stored amounts, never recalculate from today's setting** (SETTINGS.md §6 rule 1). Refunds write negative rows with the same percentages. Own-gateway payments, test payments and manual transfers outside the platform are not entries. (Manual bank transfers **to Sheetal** are platform payments and are included.)

Reported in Admin → Reports → Revenue (SETTINGS.md §7 screen, extended) and Admin → Sales:

- Ranges: today, 7 days, 30 days, custom (max 366 days), all in **Nepal time**; each with the previous period of the same length and the % change.
- Measures: `gross`, `vat`, `net`, `commission`, `partnerShare`, `publisher`, `sheetalNet`, `refunds`, `count`, plus new `newSales`, `renewals`, `upgrades`, `mrrPaisa` (active paid subscriptions, normalised to a month, without VAT), `trialsStarted`, `trialsConverted`, `churned`.
- Breakdowns: day (week over 31 days), app, edition, business, payment method.
- **Sales list**: every sale (date, business, app, edition, new/renewal/upgrade, method, gross, commission, status) with a filter and CSV (export audited). This is "super admin sees every sale".
- Who sees what: `platform.revenue.read` (finance, super admin) sees amounts; the partner's **name** appears only on the revenue-share settings screen (super admin). Nothing here appears on any public page.

One SQL statement per source, aggregated in the database after `AT TIME ZONE 'Asia/Kathmandu'`; indexes `(paidAt)`, `(appId, paidAt)`, `(tenantId, paidAt)`; cached 60 seconds; "Today" never longer.

---

## 14. Screens

### 14.1 Business side

| Screen | What it shows |
|---|---|
| **Marketplace** `/business/marketplace` | cards from manifests and catalog; category filters and search; "Popular for your type" first; each card: icon, tagline, Free / price, AI badge, status chip (Not installed, Free, Trial n days, Paid, Past due). Buttons: **Install free**, **Try 14 days**, **Upgrade**. A drawer compares editions in a table (limits, features, price month/year, "you save 2 months"). "Coming soon" cards with "Tell me when it is ready". |
| **Cart and checkout** | several apps in one cart become **one payment** (manual payments are costly for people). Shows the quote lines, proration notes, coupon box, VAT, total, then the payment methods Sheetal has live. The tax invoice appears on return. |
| **Subscriptions** `/business/billing` | each app with edition, status, next renewal, price, usage bars (limit used/limit); next invoice preview; invoices and credit notes; add-ons (seats, storage, AI credits); AI plan or own key; "Download my data". Cancel and undo. |
| **Price protection card** | for migrated businesses: today's protected price, lock end date, "Choose the apps you keep" button 60 days before. |
| **Read-only and locked states** | a banner at the top of the app ("Your {App} subscription is paused. Everything is safe. Renew to add or change records."). |

### 14.2 Upgrade prompts inside the apps

One component kit (`packages/ui`, FRONTEND-KIT.md; task P3-FE-2), same words everywhere:

| Moment | Component | Rules |
|---|---|---|
| 80% of a limit | `<LimitBanner>` under the page title | once a day, dismiss 7 days, never over a form |
| A hard stop (402 `limit_reached`) | `<UpgradePanel>` replaces the failed action's toast: what happened, the exact numbers, the next edition and its price, **Upgrade** and **Not now** | never a modal over unsaved work |
| A paid feature (button, menu item, tab) | `<EditionBadge>` "Full" chip and a short tooltip; clicking opens the same drawer as the marketplace | the feature is visible so people learn it exists |
| AI feature locked | `<AiLocked>` preview with sample output and "Turn on AI" | no model call |
| Read-only | `<ReadOnlyBanner>` | explains, links to billing and export |
| After upgrade | a toast "Upgraded. {n} items are now available" | |

The front-end never decides a price or a limit: it shows what `GET /entitlements` (a new small route returning access, edition, limits with usage, features per installed app) and `GET /marketplace` return.

### 14.3 Staff side (Admin)

| Screen | What it does | Permission |
|---|---|---|
| **Pricing** | app list; edition editor (price month/year, free toggle, limits with `hard`/`soft` and %, features, trial days, visibility); business seats and add-ons; Sheetal AI plans and rates; "who is affected" count before saving; reason box; approval if paying customers | `platform.pricing.manage` |
| **Coupons** | create, pause, see redemptions; fields in §15 | `platform.pricing.manage` |
| **Subscriptions** (in Businesses) | one business's subscriptions, usage, events, invoices; **gift or extend** (an `EntitlementGrant` with reason and end date); extend trial; mark bank proof; start a refund request | `platform.business.read`, `platform.pricing.manage` |
| **Sales** and **Revenue** | §13 | `platform.revenue.read` |
| **Billing** | payments, proofs, invoices, credit notes, VAT summary, "Not sent to IRD", refunds waiting for approval, shadow differences | `platform.billing.read` |
| **Legal and required info** | the sale terms, refund policy, invoice footer (content pages, `platform.legal.*`), and the **required business information** before a paid purchase (PAN, address, VAT registration; field builder, SETTINGS.md §5) | `platform.settings.update` |
| **Revenue share** | §13 settings | `platform.revenue_share.manage` (super admin) |

The old Admin → Plans and Add-ons pages become read-only "Legacy plans" (how many businesses are still protected) and are removed in a later cleanup, not in Phase 3.

### 14.4 Website (Next.js)

Public pages `/apps` and `/apps/<id>` (name, tagline, screenshots, editions, prices, free limits) and `/pricing`, built from the **public** catalog endpoint (only `public` fields; no PAN, no partner, no internal names). They replace `Plans.jsx` and `PlanCards.jsx`. A visitor who clicks "Start free" signs in, creates or picks a business, and lands on the marketplace card. Website posting stays free: it uses its own fair-use settings (`platform.posting.fairUse`: active posts per person, posts per day, higher for verified posters), **not** marketplace limits; unverified posters' posts wait for review, verified posters publish directly; the public pages never print "verified" (task P3-BE-11).

---

## 15. Data model (for the Database specialist)

All new models get `/// @app platform` directly above `model X {` (TEAM-RULES #17) and are added to the platform manifest's `models`. Money columns are `BigInt` named `…Paisa`. Names below are the intended columns; the DB specialist adds indexes and `map` names in the existing style. **Never edit an older copy of `schema.prisma`** (TEAM-RULES #10); the two DB tasks are strictly one after the other because both edit the same file.

| Model | Columns (main) | Notes |
|---|---|---|
| `Subscription` | `id`, `tenantId` (FK Tenant, cascade), `appId`, `editionId`, `status`, `periodMonths Int?`, `priceGrossPaisa`, `listPriceGrossPaisa`, `currentPeriodStart?`, `currentPeriodEnd?`, `trialEndsAt?`, `trialUsedAt?`, `graceUntil?`, `readOnlyFrom?`, `cancelAtPeriodEnd`, `cancelledAt?`, `pendingEditionId?`, `pendingPeriodMonths?`, `couponId?`, `couponPeriodsLeft?`, `source`, `installedAt`, `uninstalledAt?`, `migrationRunId?`, `version Int` | unique `(tenantId, appId)`; indexes `(status, currentPeriodEnd)`, `(tenantId)`; CHECK on `status`, `source` |
| `SubscriptionEvent` | `id`, `subscriptionId`, `tenantId`, `appId`, `type`, `fromStatus?`, `toStatus?`, `fromEdition?`, `toEdition?`, `amountPaisa?`, `invoiceId?`, `actorKind`, `actorId?`, `reason?`, `at` | append-only; index `(tenantId, at)`, `(type, at)` |
| `EntitlementGrant` | `id`, `tenantId`, `kind` (app, limit, feature, seats, ai_credits_monthly), `appId?`, `key?`, `value Int?` (null = unlimited), `source` (migration, covered, gift, staff, partner), `reason`, `startsAt`, `endsAt?`, `revokedAt?`, `createdBy`, `migrationRunId?` | index `(tenantId, endsAt)` |
| `AddonSubscription` | `id`, `tenantId`, `appId?`, `addonKey`, `qty`, `renewQty`, `unitPriceGrossPaisa`, `periodMonths`, `currentPeriodEnd`, `source`, `migrationRunId?` | unique `(tenantId, appId, addonKey)`; `TenantAddon` stays, read once by the migration, then unused |
| `BillingLock` | `tenantId` (unique), `legacyMonthlyGrossPaisa`, `legacyPeriodMonths`, `coversApps String[]`, `lockEnd`, `migrationRunId` | §8.3 |
| `Coupon` | `id`, `code` (unique, upper case), `kind` (percent, fixed_paisa, trial_days), `value`, `appliesTo` (all, apps, editions) + `appIds[]`, `editionIds[]`, `firstPurchaseOnly`, `minSpendPaisa?`, `validFrom?`, `validTo?`, `maxRedemptions?`, `perBusinessLimit` (default 1), `periods` (1 to 12), `active`, `createdBy` | one coupon per invoice; does not stack with another coupon |
| `CouponRedemption` | `id`, `couponId`, `tenantId`, `userId`, `invoiceId`, `discountPaisa`, `at` | unique `(couponId, tenantId, invoiceId)`; abuse checks by owner user and PAN |
| `Invoice` (changed) | add `no?`, `fy?`, `issuedAt?`, `subtotalPaisa`, `vatPaisa`, `totalPaisa`, `sellerSnapshot Json`, `creditForId?`, `couponId?`, `catalogVersion?`; `planId` becomes optional; `kind` gains `subscription`, `credit` | old Int columns kept (dual write, rounded rupees); unique `(fy, no)` where `no` is not null |
| `InvoiceLine` | `id`, `invoiceId`, `kind`, `appId?`, `editionId?`, `subscriptionId?`, `description Json`, `periodStart?`, `periodEnd?`, `qty`, `unitGrossPaisa`, `discountPaisa`, `grossPaisa`, `netPaisa`, `vatPaisa` | lines sum to the invoice |
| `Payment` (changed) | add `amountPaisa`, `mode` (test, live), `refundedPaisa` default 0, `refundRef?`, `refundSentAt?` | old `amount` kept |
| `RevenueEntry` | `id`, `paymentId`, `invoiceId`, `invoiceLineId?`, `tenantId`, `appId?`, `editionId?`, `kind` (sale, refund), `saleType` (new, renewal, upgrade, addon, ai), `grossPaisa`, `vatPaisa`, `netPaisa`, `commissionBp`, `commissionPaisa`, `partnerBp`, `partnerPaisa`, `sheetalNetPaisa`, `publisherPaisa`, `method`, `mode`, `catalogVersion`, `paidAt` | unique `(paymentId, invoiceLineId, kind)`; index `(paidAt)`, `(appId, paidAt)`, `(tenantId, paidAt)`; append-only |
| `PlatformApproval` | same columns as `ApprovalRequest` without `tenantId` (action, resource, payload, `amountPaisa`, status, makerId, checkerId, notes, `expiresAt`, `executedAt`, `result`) | `ApprovalRequest` has a required tenant, so a separate table avoids touching Phase 1 |
| `AiCreditGrant` | `id`, `tenantId`, `credits`, `remaining`, `source`, `expiresAt`, `ref?`, `createdAt` | index `(tenantId, expiresAt)` |
| `AiUsage` (changed) | add `appId?`, `provider?`, `source`, `requestId?` | |
| `Tenant` (changed) | add `billingMode` (`plans` default, `shadow`, `apps`) | the per-business cutover flag |
| `BillingMigrationRun` | `id`, `mode`, `startedAt`, `finishedAt?`, `report Json`, `createdBy` | the `--restore` key |

Database guards (CHECK or trigger): statuses and sources are fixed words; `remaining ≤ credits`; issued invoice money columns cannot be updated; a `RevenueEntry` cannot be updated or deleted; `Subscription.currentPeriodEnd` is set when `periodMonths` is set.

---

## 16. Settings, permissions, events, routes (summary)

**Settings keys** (SETTINGS.md §2.1, one `SettingDef` each): `platform.catalog`, `platform.billing` (`vatRatePct`, `pricesIncludeVat`, `graceDays`, `readOnlyDays`, `reminderDays`, `refundWindowDays`, `minChargePaisa`, `priceChangeNoticeDays`, `quoteHours`, `trialDays` default, `seatAutoPauseDays`, `migrationLockMonths`, `migrationFreeLimitDays`, `salesEnabled`, `requireTaxInfo`, `invoiceFooter`), `platform.revenueShare` (extended), `platform.posting.fairUse`, `platform.legal.*` (content pages). Today's `billing`, `addons`, `ai.features` and `payouts` rows stay as read fallbacks for one release.

**Permissions:** reuse `platform.pricing.manage`, `platform.revenue.read`, `platform.revenue_share.manage`, `platform.billing.read`, `platform.billing.refund` (ACCESS.md §6.2); business side `workspace.billing.manage`. New ones, super admin first: `platform.billing.export`, `platform.subscription.grant`.

**Events** (declared in `platform.manifest.ts`, KERNEL.md §9): `billing.subscription.changed`, `billing.invoice.issued`, `billing.payment.paid`, `billing.refund.executed`, `billing.limit.reached`, `billing.catalog.changed`. Consumers: entitlement cache clear, mail and notifications, `tax.cbms` (if live), admin counters.

**Routes** (names fixed in the task that builds them; all under the existing servers): business `GET /marketplace`, `GET /entitlements`, `POST /subscriptions/quote`, `POST /subscriptions/checkout`, `POST /subscriptions/:appId/{install,trial,change,cancel,resume,remove}`, `POST /addons/quote|checkout`, `POST /coupons/check`, `GET /billing/overview`; admin `GET|PUT /admin/pricing`, `/admin/coupons`, `/admin/subscriptions`, `/admin/sales`, `/admin/revenue`, `/admin/refunds`; website (public, read-only) `GET /public/catalog`. A new route file does nothing until `app.ts` registers it (TEAM-RULES #11); every task's CHANGES says so.

---

## 17. Owner to confirm (everything I assumed)

| # | Assumption | Section |
|---|---|---|
| 1 | Q1 to Q5 above (**answered 13 Nov: recommendations accepted**) | 0 |
| 2 | The three new apps (payroll, accounting, restaurant) and the Promote and Mail apps are shown; payroll is paid-only | 2, 3.4 |
| 3 | Prices include VAT; yearly = 10 months; free seats = 2; the starting price list | 3.4 |
| 4 | Billing periods offered: month and year only (old 3 and 6 months are kept for existing subscriptions) | 3.1 |
| 5 | A paid app can be tried once for 14 days without a card; no trial for paid-only apps unless admin sets days | 5.2 |
| 6 | Grace 7 days, read-only 60 days, data kept forever, extra seats paused 14 days after grace | 5.5 |
| 7 | Public leads keep arriving while read-only; paid bookings are refused | 5.5 |
| 8 | Tax invoice issued at payment; zero-value purchases take no tax invoice | 9.1 |
| 9 | Whether Sheetal's own invoices go to IRD's billing system | 9.4 |
| 10 | Refund policy: 7 days on the first purchase; second-person approval always | 11 |
| 11 | Own AI key never falls back to Sheetal credits unless the owner switches it on | 10.4 |
| 12 | Covered businesses (one owner, several businesses on one Pro) keep working until the parent's lock ends; what replaces "covered" after that is not decided | 8.1 R9 |
| 13 | Commission default 100% until the split is entered; launch is blocked until it is entered | 13 |
| 14 | Seats are per business, not per app | 7.4 |
