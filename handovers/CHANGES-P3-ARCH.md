# CHANGES P3-ARCH

Design only. **No code file, schema, migration or script was changed.** Three new documents under `docs/architecture/`.

| File | What it is |
|---|---|
| `MARKETPLACE-AND-BILLING.md` | The model (App, Edition, Price, FreeLimit, Trial, Subscription, Add-on, Coupon, Grant), states and proration in NPR, Entitlements from subscriptions, limit behaviour, grace and read-only, migration from Starter/Business/Pro with a dry-run/proof script design, Nepal invoices (VAT 13%, PAN, fiscal-year numbering, IRD points), refunds, the two payment systems, commission and partner share, AI (Sheetal AI vs own key), screens, data model, settings, assumptions |
| `PHASE-3-TASKS.md` | 22 ordered tasks (QA, DB, BE, FE, OPS) with goal, files, tests, hand test, go-back, needs, and a parallel / not-parallel map |
| `PHASE-3-RISKS.md` | Risks for money, migration, tax, gateways, abuse; launch gates G1 to G10 |

## Commands
None. Copy the three files into `docs/architecture/` of the repo (Lead).

## How to check by hand
Read MB section 0 (the five questions), section 5.3 (worked examples; check the arithmetic), section 8 (migration), and the gates in RISKS section 6.

## Could not do
- No Phase 2 code and no Integration Center code was in the zip; tasks say which files each chat needs.
- Tax and IRD points are marked "Accountant to confirm"; I could not check the rules.
- Prices in MB 3.4 are a proposal for the seed file, not facts.
- Nothing was run; there is no code.

## Differences from earlier design docs
- Adds `Entitlements.access()`, `requireWrite()`, `requireLimit()` (additive to KERNEL 5.3).
- Adds optional manifest field `availability`.
- Adds `PlatformApproval` (ApprovalRequest requires a tenant).
- Tax invoice is issued at payment, not at reminder time (removes numbering gaps).
- `fiscalYearOf()` needs a Nepal-time fix (MB 9.2).
