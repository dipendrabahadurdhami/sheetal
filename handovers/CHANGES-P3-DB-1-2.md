# CHANGES P3-DB-1 + P3-DB-2: the Phase 3 billing tables (one stage, two migrations)

Phase 3, first stage. Both database tasks of PHASE-3-TASKS.md, one after the other on one branch (they edit the same `schema.prisma`, so they
were never run side by side). Design: MARKETPLACE-AND-BILLING.md (MB) section 15. Nothing in the app writes the new tables yet.

## Migrations (additive only)
| Migration | What |
|---|---|
| `20261113200000_p3_subscriptions` | tables `subscriptions`, `subscription_events`, `entitlement_grants`, `addon_subscriptions`, `billing_locks`, `billing_migration_runs`, `ai_credit_grants`; `tenants.billing_mode` (`plans` default, `shadow`, `apps`); `ai_usage.app_id / provider / source / request_id` (old own-key rows get `source = 'own'`) |
| `20261113210000_p3_invoicing_revenue` | `invoices`: `no`, `fy`, `issued_at`, `subtotal/vat/total_paisa`, `seller_snapshot`, `credit_for_id`, `coupon_id`, `catalog_version`, `plan_id` optional, unique `(fy, no)`; `payments`: `amount_paisa`, `mode`, `refunded_paisa`, `refund_ref`, `refund_sent_at`; tables `invoice_lines`, `revenue_entries`, `coupons`, `coupon_redemptions`, `platform_approvals` |

**Backfill:** every old invoice and payment gets its paisa twin (rupees × 100). eSewa test-merchant payments (`EPAYTEST` in the gateway answer) get `mode = 'test'`.

**Database guards** (Prisma does not see these; the model comments name them):
- CHECKs on every fixed word (statuses, sources, kinds, modes); `remaining` between 0 and `credits`; a grant has a reason; a paid subscription period has an end date;
  coupon codes upper case, percent at most 100; a refund never exceeds the payment; the approval checker is never the maker; line and revenue amounts add up
  (net + VAT = gross; commission + publisher = net; partner + Sheetal's net = commission); revenue rows are `live` only.
- Triggers: old invoice kinds (plan, addon, boost, banner) keep paisa = rupees × 100 on every write (today's code changes nothing); payments get the paisa twin
  when it is missing; an **issued** tax invoice's number and money can't change; `revenue_entries` can't be updated or deleted.
- `invoices_kind_check` is `NOT VALID` (old rows are not re-checked; they only ever had the four old kinds).

## Code touched (only what the schema change needs)
- `backend-core/src/domain/billing.ts`, `business/backend/src/modules/billing/routes.ts`: `Invoice.planId` is now optional; the old plan path reads it with a fallback
  (old plan invoices always have one, so nothing changes for them).
- `admin/backend/src/modules/billing.ts`: the old Payments and Invoices lists leave out the new columns (BigInt can't go into JSON; the old screen keeps its shape).
- `platform/src/tenancy/platform.manifest.ts` (+ `apps.generated.ts`): the 12 new models; `docs/architecture/MODEL-OWNERS.md`: 113 models.

## Tests
`backend-core/test/p3-billing-tables.test.ts` (new): tables empty, keys and BigInt money; existing businesses stay on `plans`; every CHECK and trigger above refuses
a bad row; old invoices keep their paisa twins on insert and update; the fiscal-year numbering is unique per year; cascade from a business only. Old tests unchanged.

## Owner
Nothing to see yet. The next RUN-UPDATE backs up and applies both migrations.

## Go back
Revert the PR before any Phase 3 sale. If applied: drop the 12 new tables, the new columns, and the functions `invoices_paisa_sync`, `invoices_issued_guard`,
`payments_paisa_fill`, `revenue_entries_append_only` (with their triggers), and re-add NOT NULL on `invoices.plan_id`.

## Fixed after the first CI run
- The new tests matched unique keys by constraint name; PostgreSQL names the columns instead (`Key (tenant_id, app_id)`): matched on that.
- An old test (`business/backend/test/people-kernel.test.ts`, the 409 attendance fix) failed when the suite ran between 00:00 and 09:00 Nepal time:
  it moved a check-in to 09:00 while the check-out was "now". The test now sends a check-out of 23:59 as well; its assertions are unchanged.
