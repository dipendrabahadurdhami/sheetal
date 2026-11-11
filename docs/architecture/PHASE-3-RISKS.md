# Phase 3 risks: what could go wrong, and how each is prevented or tested

Status: design for Phase 3 (task P3-ARCH). Companions: [MARKETPLACE-AND-BILLING.md](MARKETPLACE-AND-BILLING.md) (**MB**), [PHASE-3-TASKS.md](PHASE-3-TASKS.md).
Each row: the risk, how the design prevents it, and the test or check that proves it. "Likelihood" and "Impact" are H (high), M, L.

---

## 1. Money

| # | Risk | L / I | Prevention | Test |
|---|---|---|---|---|
| M1 | A paisa is lost or added: lines do not add to the invoice, VAT drifts | M / H | All money is `BigInt` paisa and `Money`; VAT is split **once per invoice** and shared to lines with `Money.split` (MB §4) | Property tests: lines = invoice, VAT + subtotal = total, revenue net = invoice net, for 10,000 random carts (P3-BE-2, BE-4) |
| M2 | The price shown is not the price charged (admin changes a price between "see" and "pay") | M / H | The checkout stores the **invoice from the same `quote()`**; the invoice is valid 24 h; prices are copied into the subscription (MB §1 rule 3, §5.4) | Test: change the catalog between quote and pay; the amount charged equals the quote |
| M3 | A gateway charges or returns a different amount (rupee rounding, Khalti in paisa, eSewa decimals) | M / H | Verify the **paisa amount** from the gateway's status API equals the invoice before marking paid (MB §4, §12) | Test: off by one paisa is refused; each provider's amount format has a case |
| M4 | A payment is applied twice (the payer returns twice, or a retry) | H / H | `applyPayment` is idempotent (today's rule) and `RevenueEntry` has a unique key `(paymentId, line, kind)` | Test: two parallel returns create one invoice, one number, one revenue set |
| M5 | Proration is wrong (30-day assumption, leap day, Nepal midnight) | M / M | Real period days in Nepal time; pure functions; table of 33 cases (MB §5.3) | Table-driven tests incl. month ends, 29/30/31-day cycles, yearly, minimum charge |
| M6 | Commission or partner share is wrong or retroactive | M / H | Computed once in the payment transaction; percentages stored on the row; reports sum stored amounts (MB §13; SETTINGS.md §6 rule 1) | Test: change the setting; last week's totals do not move; refund reverses with the **original** percentages |
| M7 | Commission default is wrong and money is owed to a partner | M / H | Default is 100% until the owner enters the split, and **launch is blocked until it is entered** (gate G3) | Gate checklist; an admin warning banner while the default is unchanged |
| M8 | A refund is made twice, or by one person alone | L / H | Maker-checker `PlatformApproval`; checker ≠ maker; compare-and-set on status; `refundedPaisa` cannot exceed the payment (CHECK) | Tests: self-approve refused; two checkers decide once; over-refund refused |
| M9 | Staff gift or coupon abuse (free access forever, 100% coupons) | M / M | Grants always have a reason and end date (shown in a list "ending soon"); coupons have limits and per-business and per-owner counters; every grant and coupon is audited | Test: a grant without end date is refused unless super admin; abuse report query |
| M10 | Revenue report double counts or mixes test payments | M / H | `mode` on every payment; `RevenueEntry` only for live platform payments (SETTINGS.md §7.4) | Test: test-mode payment, own-gateway payment and manual-outside payment are not entries |
| M11 | Gateway fees make net revenue look better than it is | M / L | Not modelled in Phase 3; the report says "before gateway fees" | Wording check; a later `feePaisa` column is noted (MB §13) |
| M12 | A coupon discount is applied before VAT in a way the accountant rejects | L / M | One rule: discount on the gross, VAT split on the discounted total (MB §5.3) | Accountant to confirm; worked example 3 is the test |

## 2. Migration (Starter / Business / Pro → apps)

| # | Risk | L / I | Prevention | Test |
|---|---|---|---|---|
| G1 | A business loses an app, limit, feature, seat or AI credit on day one | M / H | Rules R1 to R6 and proof P1 (`v3 ≥ v1` for every key) before any write; usage proof P2 so nobody starts "over" (MB §8.1, §8.4) | Fixture of every type × plan × add-on × status; the dry run on a copy of real data (P3-OPS-1); live **shadow** mode with a diff log (MB §8.6) |
| G2 | A business pays more on its first renewal | M / H | `BillingLock` and the visible "Price protection" line; proof P3 compares in paisa with VAT | Test per fixture; the price report CSV (MB §8.5) |
| G3 | The renewal price jumps when the lock ends | M / M | 60-day "Choose the apps you keep" step; unchosen apps fall to free editions, not nothing; the price report is used to tune the catalog **before** launch | Report reviewed at gate G2; reminder mails tested |
| G4 | The script half-applies and leaves a mixed state | L / H | One transaction per business; `--restore` by `migrationRunId`; refuses when a v3 sale exists | Test: kill the script mid-run (a thrown error after business 3); state is all-or-nothing per business |
| G5 | A business pays during the migration (payment in flight) | M / H | Businesses with `initiated` or `pending_review` payments are skipped until settled (R10); the script lists them | Test with an in-flight payment |
| G6 | Old open invoices are paid after cutover | M / M | Open plan/addon invoices are voided and re-made; the pay page for a void invoice says what to do; boost/banner unaffected | Test: pay link of a voided invoice shows the new invoice |
| G7 | Covered businesses (one Pro covering others) lose Pro | M / M | R9: the covering relation is kept by a job until the parent's lock ends; **what replaces it is an owner decision** (MB §17 #12) | Test: parent pays, children keep; parent lapses, children follow |
| G8 | Suspended or cancelled businesses come back later with no subscriptions | L / M | They are listed and mapped when reactivated (script is rerunnable); a staff "reactivate" calls the same mapper | Test: reactivate a suspended fixture |
| G9 | The new free limits block existing free businesses | M / H | R3: usage-based grants (unlimited until `lockEnd`) for keys where usage is above the new free limit; 90-day free lock; notices at 30, 14, 3 days | Proof P2 on real data; mail tests |
| G10 | The shadow log shows differences and nobody reads it | M / M | The Admin → Billing screen shows the count; cutover to `apps` is blocked by the runbook until 7 days of zero | Runbook gate |
| G11 | A "go back" is impossible after sales | M / H | Honest rule: before the first sale flip to `plans`; after sales **switch sales off and fix forward**; disaster path is restore from backup (MB §8.6) | Rehearsal on the scratch copy in OPS-2 |
| G12 | An older copy of `schema.prisma`, `billing.ts`, `ai.ts`, `app.ts`, admin `routes.ts` overwrites newer code (it happened twice) | M / H | Strict DB task order; every task starts from the latest `main`; `prisma migrate diff` must be empty; CHANGES names every registered route | CI; QA checks the CHANGES list against the diff |

## 3. Tax and invoices (Nepal)

I could not check IRD rules; these are the points the accountant must confirm (gate G5).

| # | Risk | L / I | Prevention | Test or check |
|---|---|---|---|---|
| T1 | Gaps or duplicates in invoice numbers | M / H | Tax invoice is issued **at payment**, inside the transaction, from an atomic `DocCounter` row; unique `(fy, no)` (MB §9.2) | Concurrency test; failure test leaves no gap |
| T2 | Wrong fiscal year at the boundary (UTC instead of Nepal time; wrong Shrawan 1 date) | M / H | Fix `fiscalYearOf` to add 5:45; the `SHRAWAN_1` table is verified before each Shrawan (yearly checklist) | Test at 00:30 and 23:30 Nepal time around Shrawan 1; yearly checklist item in the runbook |
| T3 | VAT rate or rule changes | L / M | VAT rate is a setting; invoices store the rate used; changes apply to later invoices only | Test: change the rate; old invoices unchanged |
| T4 | An issued invoice is edited later | L / H | Trigger blocks updates of issued money columns; refunds are credit notes | Test: an `UPDATE` fails |
| T5 | Buyer PAN or business details missing or wrong on the invoice | M / M | Required tax details before the first purchase (admin-editable list); snapshot on the invoice | Test: checkout refused until the fields exist |
| T6 | Sheetal's legal details (PAN) leak publicly, or the technology company is named | L / H | Seller details live in `platform.company`, copied only into invoices (private); public catalog endpoint and pages are scanned for PAN, partner and "verified" | Build-time and test-time scans (BE-1, BE-11, FE-5) |
| T7 | IRD requires sending invoices to its billing system and Sheetal does not | M / H | Event `billing.invoice.issued` → `tax.cbms` integration at platform scope; failures retry and never block payment; "Not sent to IRD" list | Gate G5 decides yes or no; test with a fake endpoint if yes |
| T8 | Zero-value purchases (100% coupon, gift) are treated wrongly | L / L | Receipt-less notice, no tax invoice number (Accountant to confirm) | Test: no number is consumed |
| T9 | BS date on the invoice is wrong | L / M | Use the shared `bs.js`, confirmed against an official table; show AD and BS | Test on 20 known dates (QA) |
| T10 | VAT return numbers do not match invoices | L / M | The VAT summary is computed from the same rows as the invoices and credit notes | Test: summary equals the sum of invoices minus credit notes |

## 4. Payment gateways and approvals

| # | Risk | L / I | Prevention | Test or check |
|---|---|---|---|---|
| P1 | The bank card gateway (Siddhartha Bank or Global IME Bank) is late or refused | H / M | Nothing in billing depends on it: the `card` integration spec exists; when its connection is `live` it appears at checkout with no billing change (MB §12) | Test: a fake provider connection appears and disappears with its state |
| P2 | eSewa, Khalti or Fonepay approval for **business** (own) gateways is slow or the documents are rejected | H / M | The business keeps the free static QR; the Integration Center states (`in_review`, `rejected`, resubmit) are already designed (INTEGRATIONS.md §4); staff see the queue | Test of each state change; help guides editable |
| P3 | Fonepay dynamic QR spec is not available | M / L | Spec-only shell until the pack arrives; no billing change | Listed in P3-BE-9 as "adapter when the pack arrives" |
| P4 | A wrong key is saved and takes live payments down | M / H | Staged changes, test first, then apply (INTEGRATIONS.md §6.3); `down` hides a provider and tells staff | Tests in the Integration Center task; checkout hides `down` |
| P5 | A business's customers pay through Sheetal's merchant by mistake (or the reverse) | L / H | `PaymentRouter` keeps the two systems apart; no fall-back (MB §12) | Test both directions for every purpose |
| P6 | A manual bank proof is forged | M / M | Staff approve; an optional second approver over a limit; the amount and payer must match the invoice; approval issues the tax invoice at that moment | Test: approval needed for activation; audit rows |
| P7 | Gateway outage at renewal time | M / M | Grace days; other methods; manual transfer; dates decide, so nobody loses access early | Lifecycle test with a fake clock |
| P8 | Rent for Sheetal-managed properties is mixed into app revenue | L / H | It is a `sheetal.managed_rent` purpose with its own entries; never a `RevenueEntry` of app sales (commission rules for rent stay in `payouts`) | Test: a rent payment makes no `RevenueEntry` |

## 5. Product, abuse, performance

| # | Risk | L / I | Prevention | Test |
|---|---|---|---|---|
| A1 | Trial abuse (new business each 14 days) | H / M | One trial per business per app (`trialUsedAt`); the same owner user, same PAN or same phone and email count too; staff can see repeats | Test: second business with the same PAN gets no trial |
| A2 | Someone hides data to stay under the free limit or deletes to reuse | M / L | Limits count records that exist; "archived" counts the same unless the manifest says otherwise | Per-app counter tests |
| A3 | AI cost runs away | M / H | Credits are taken before the call; hard stop at zero; no silent fall-back from own key to Sheetal credits; per-feature rate table; free tier has no monthly credits (Q4) | Concurrency and refusal tests (BE-8) |
| A4 | An own AI key leaks | L / H | Sealed with the vault (v2 binding), write-only, never logged, never sent to a browser | A scan test over responses and logs |
| A5 | Entitlement lookup slows every request | M / M | Three small queries, 30-second cache cleared by event; pure functions | A load test of 1,000 requests; query count asserted |
| A6 | Read-only or locked rules break background jobs or public pages | M / M | Jobs check `access()` and skip; public leads keep arriving, paid bookings are refused with a clear page (MB §5.5; Owner to confirm) | Tests per mode |
| A7 | Marketplace confuses small owners | M / M | One cart, one payment; plain words in Nepali and English; the same limit panel everywhere; "Not now" always works; prompts never block reading | Hand test with 3 real owners (QA-2) |
| A8 | The catalog is edited into a broken state (a free edition priced, a limit removed that an app needs) | M / M | Guards in the setting definition; "who is affected" count; approval for paid changes; `check-catalog` in CI | Guard tests |
| A9 | A price rise is a surprise | M / M | 30-day notice, mail with old and new price, applies only at the next renewal after the date (MB §5.6) | Lifecycle test on notice dates |
| A10 | People hit a limit while selling (POS, bills) | M / H | Money-in limits are **soft** by default (20% over) so a sale is never lost on the first day (MB §6.3, Q1) | Test: soft over-limit allowed, then refused |
| A11 | Seats: members are paused unexpectedly | L / M | Pause (never remove) only 14 days after grace, newest first, never the owner, mail first; paying resumes at once | Test |
| A12 | `all_kinds` removal hides listing kinds for businesses that used them | M / M | Kinds come from the apps a business has; the migration installs the same apps (R1) so kinds stay | Proof P1 includes kinds; QA hand test per type |

## 6. Launch gates (all must be ticked before real sales)

| Gate | Check | Owner of the check |
|---|---|---|
| G1 | Q1 to Q5 answered or the recommendations accepted in writing | Owner |
| G2 | Price report reviewed; catalog numbers entered in Admin → Pricing | Owner, Finance |
| G3 | Revenue-share split entered (commission, partner share); a test sale shows the right entries | Owner |
| G4 | Dry run on a copy of real data: PASS; shadow mode: 7 days with zero differences | QA, Lead |
| G5 | Accountant confirmed: invoice wording and fields, time of supply, zero-value purchases, credit notes, whether invoices go to IRD, BS dates | Accountant, Owner |
| G6 | At least one Sheetal payment method is **live** with a real test payment refunded successfully | Owner, Finance |
| G7 | Sale terms, refund policy and invoice footer texts entered and approved | Owner |
| G8 | Backup taken and a restore rehearsed on the scratch copy | DevOps |
| G9 | Fiscal year table (Shrawan 1) checked against the official calendar | Finance |
| G10 | Pilot businesses ran one full cycle: trial, purchase, upgrade, cancel, refund | QA |

## 7. Not decided yet (does not block the design)

- What replaces "covered business" (one owner, several businesses on one Pro) after the lock ends: a multi-business discount, or nothing.
- Data retention after a very long unpaid period (Phase 3 deletes nothing).
- Gateway fees in revenue reports.
- Per-app seats (recommendation: no).
- Whether bundles (a price for several apps together) are wanted; coupons cover launch needs.
