// Tests for P3-DB-1 and P3-DB-2: the Phase 3 billing tables (MARKETPLACE-AND-BILLING.md section 15), their CHECKs and triggers, and the
// paisa twins of old invoices and payments.
// Where it fits: the suite's temporary database (platform/test/setup-db.ts) has migrations 20261113200000_p3_subscriptions and
// 20261113210000_p3_invoicing_revenue applied. Nothing in the app writes these tables yet (P3-BE tasks do); these tests prove the database
// itself keeps the money rules, so no later code can break them by mistake.
// How it works: plain SQL, every test inside one transaction that is rolled back (savepoints for the statements that must fail), so the
// shared test database stays as it was.
// Run with: npm run test -w @sheetal/backend-core
import type {} from "@sheetal/platform/test/setup-db";
import { PrismaClient, type Prisma } from "@prisma/client";
import { afterAll, describe, expect, inject, it } from "vitest";

type Tx = Prisma.TransactionClient;
class Rollback extends Error {}

const db = new PrismaClient({ datasources: { db: { url: inject("databaseUrl") } } });
afterAll(() => db.$disconnect());

/** Runs `fn` in a transaction and always rolls it back. */
async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.$transaction(async (tx) => { await fn(tx); throw new Rollback(); }, { timeout: 60_000, maxWait: 20_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

const exec = (tx: Tx, sql: string, ...p: unknown[]) => tx.$executeRawUnsafe(sql, ...p);
const rows = <T>(tx: Tx | PrismaClient, sql: string, ...p: unknown[]) => tx.$queryRawUnsafe<T[]>(sql, ...p);

/** The statement must be refused by the database; the transaction carries on (a savepoint undoes the failed statement). */
async function refused(tx: Tx, sql: string, ...p: unknown[]): Promise<string> {
  await exec(tx, "SAVEPOINT p3");
  try {
    await exec(tx, sql, ...p);
  } catch (e) {
    await exec(tx, "ROLLBACK TO SAVEPOINT p3");
    return String((e as Error).message);
  }
  throw new Error(`The database accepted: ${sql}`);
}

/** A plan and a business to hang rows on. */
async function business(tx: Tx, id = "p3-biz"): Promise<string> {
  await exec(tx, `INSERT INTO plans (id, type, name, price, limits, features) VALUES ('p3-plan', 'agency', 'Business', 1500, '{}', '{}') ON CONFLICT DO NOTHING`);
  await exec(tx, `INSERT INTO tenants (id, name, type, plan_id, updated_at) VALUES ($1, 'P3 Realty', 'agency', 'p3-plan', now())`, id);
  return id;
}

const SUB = `INSERT INTO subscriptions (id, tenant_id, app_id, edition_id, status, period_months, current_period_end, source, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`;

// ───────────── P3-DB-1: subscriptions ─────────────

describe("migration 20261113200000_p3_subscriptions", () => {
  it("creates the seven tables, empty, with their keys", async () => {
    const tables = ["subscriptions", "subscription_events", "entitlement_grants", "addon_subscriptions", "billing_locks", "billing_migration_runs", "ai_credit_grants"];
    for (const t of tables) expect((await rows<{ n: bigint }>(db, `SELECT count(*) AS n FROM "${t}"`))[0]!.n).toBe(0n);
    const idx = (await rows<{ indexname: string }>(db, `SELECT indexname FROM pg_indexes WHERE tablename = 'subscriptions'`)).map((r) => r.indexname).sort();
    expect(idx).toEqual(["subscriptions_pkey", "subscriptions_status_current_period_end_idx", "subscriptions_tenant_id_app_id_key"]);
    const money = await rows<{ c: string; t: string }>(db, `SELECT table_name || '.' || column_name AS c, data_type AS t FROM information_schema.columns
      WHERE table_name IN ('subscriptions','subscription_events','addon_subscriptions','billing_locks') AND column_name LIKE '%paisa'`);
    expect(money.length).toBeGreaterThanOrEqual(5);
    for (const m of money) expect(`${m.c}:${m.t}`).toBe(`${m.c}:bigint`);
  });

  it("existing businesses stay on today's plans (billing_mode 'plans'), and the mode takes only three words", async () => {
    await rolledBack(async (tx) => {
      const id = await business(tx);
      expect((await rows<{ m: string }>(tx, `SELECT billing_mode AS m FROM tenants WHERE id = $1`, id))[0]!.m).toBe("plans");
      for (const m of ["shadow", "apps", "plans"]) await exec(tx, `UPDATE tenants SET billing_mode = $1 WHERE id = $2`, m, id);
      expect(await refused(tx, `UPDATE tenants SET billing_mode = 'pro' WHERE id = $1`, id)).toMatch(/tenants_billing_mode_check/);
    });
  });

  it("one subscription per business per app; fixed status and source words; a paid period has an end date", async () => {
    await rolledBack(async (tx) => {
      const t = await business(tx);
      await exec(tx, SUB, "s1", t, "hotel", "free", "active", null, null, "install");
      expect(await refused(tx, SUB, "s2", t, "hotel", "full", "trialing", null, null, "trial")).toMatch(/subscriptions_tenant_id_app_id_key/);
      expect(await refused(tx, SUB, "s3", t, "crm", "full", "paused", null, null, "install")).toMatch(/subscriptions_status_check/);
      expect(await refused(tx, SUB, "s4", t, "crm", "full", "active", null, null, "bought")).toMatch(/subscriptions_source_check/);
      expect(await refused(tx, SUB, "s5", t, "crm", "full", "active", 1, null, "purchase")).toMatch(/subscriptions_period_end_check/);
      expect(await refused(tx, SUB, "s6", t, "crm", "full", "active", 2, new Date(), "purchase")).toMatch(/subscriptions_period_months_check/);
      for (const [i, st] of ["active", "trialing", "past_due", "read_only", "cancelled", "expired"].entries()) {
        await exec(tx, SUB, `ok${i}`, t, `app${i}`, "full", st, 1, new Date("2026-12-14T18:15:00Z"), "purchase");
      }
      // Removing the business removes its subscriptions and their history (cascade), nothing else.
      await exec(tx, `INSERT INTO subscription_events (id, subscription_id, tenant_id, app_id, type, actor_kind) VALUES ('e1', 's1', $1, 'hotel', 'installed', 'user')`, t);
      expect(await refused(tx, `INSERT INTO subscription_events (id, subscription_id, tenant_id, app_id, type, actor_kind) VALUES ('e2', 's1', $1, 'hotel', 'installed', 'robot')`, t))
        .toMatch(/subscription_events_actor_kind_check/);
      await exec(tx, `DELETE FROM tenants WHERE id = $1`, t);
      expect((await rows<{ n: bigint }>(tx, `SELECT count(*) AS n FROM subscription_events WHERE id = 'e1'`))[0]!.n).toBe(0n);
    });
  });

  it("AI credits can never be overspent or made up, and grants always give a reason", async () => {
    await rolledBack(async (tx) => {
      const t = await business(tx);
      const grant = `INSERT INTO ai_credit_grants (id, tenant_id, credits, remaining, source, expires_at) VALUES ($1, $2, $3, $4, $5, now() + interval '14 days')`;
      await exec(tx, grant, "g1", t, 100, 100, "trial");
      expect(await refused(tx, `UPDATE ai_credit_grants SET remaining = -1 WHERE id = 'g1'`)).toMatch(/ai_credit_grants_remaining_check/);
      expect(await refused(tx, `UPDATE ai_credit_grants SET remaining = 101 WHERE id = 'g1'`)).toMatch(/ai_credit_grants_remaining_check/);
      expect(await refused(tx, grant, "g2", t, 10, 10, "free")).toMatch(/ai_credit_grants_source_check/);
      const eg = `INSERT INTO entitlement_grants (id, tenant_id, kind, source, reason, created_by) VALUES ($1, $2, $3, $4, $5, 'staff-1')`;
      await exec(tx, eg, "eg1", t, "limit", "gift", "Launch partner");
      expect(await refused(tx, eg, "eg2", t, "limit", "gift", "  ")).toMatch(/entitlement_grants_reason_check/);
      expect(await refused(tx, eg, "eg3", t, "discount", "gift", "x")).toMatch(/entitlement_grants_kind_check/);
    });
  });

  it("an add-on is unique per business, app and key (empty app = business-level), and a lock is one per business", async () => {
    await rolledBack(async (tx) => {
      const t = await business(tx);
      const add = `INSERT INTO addon_subscriptions (id, tenant_id, app_id, addon_key, qty, renew_qty, unit_price_gross_paisa, period_months, current_period_end, updated_at)
                   VALUES ($1, $2, $3, 'seats', 2, 2, 15000, 1, now(), now())`;
      await exec(tx, add, "a1", t, "");
      expect(await refused(tx, add, "a2", t, "")).toMatch(/addon_subscriptions_tenant_id_app_id_addon_key_key/);
      await exec(tx, add, "a3", t, "hotel");
      const lock = `INSERT INTO billing_locks (tenant_id, legacy_monthly_gross_paisa, legacy_period_months, lock_end, migration_run_id) VALUES ($1, 150000, 1, now(), 'run-1')`;
      await exec(tx, lock, t);
      expect(await refused(tx, lock, t)).toMatch(/billing_locks_pkey/);
    });
  });

  it("old AI usage rows made with the business's own key are marked 'own'", async () => {
    await rolledBack(async (tx) => {
      await exec(tx, `INSERT INTO ai_usage (id, feature, model, input_tokens, output_tokens, credits) VALUES ('u1', 'compare', 'm', 1, 1, 1)`);
      expect((await rows<{ s: string }>(tx, `SELECT source AS s FROM ai_usage WHERE id = 'u1'`))[0]!.s).toBe("sheetal");
      expect(await refused(tx, `UPDATE ai_usage SET source = 'free' WHERE id = 'u1'`)).toMatch(/ai_usage_source_check/);
    });
  });
});

// ───────────── P3-DB-2: invoices, payments, revenue, coupons, approvals ─────────────

const OLD_INVOICE = `INSERT INTO invoices (id, tenant_id, plan_id, months, subtotal, vat, total, kind, due_at) VALUES ($1, $2, 'p3-plan', 1, 1327, 173, 1500, $3, now())`;
const NEW_INVOICE = `INSERT INTO invoices (id, tenant_id, months, subtotal, vat, total, kind, due_at, subtotal_paisa, vat_paisa, total_paisa)
                     VALUES ($1, $2, 1, 354, 46, 400, 'subscription', now(), 35398, 4602, 40000)`;

describe("migration 20261113210000_p3_invoicing_revenue", () => {
  it("old invoice kinds keep paisa = rupees × 100 on insert and on every change; Phase 3 invoices keep their own paisa", async () => {
    await rolledBack(async (tx) => {
      const t = await business(tx);
      for (const k of ["plan", "addon", "boost", "banner"]) await exec(tx, OLD_INVOICE, `old-${k}`, t, k);
      const p = await rows<{ s: bigint; v: bigint; t: bigint }>(tx, `SELECT subtotal_paisa AS s, vat_paisa AS v, total_paisa AS t FROM invoices WHERE id = 'old-plan'`);
      expect(p[0]).toEqual({ s: 132_700n, v: 17_300n, t: 150_000n });
      // Repricing an open plan invoice (today's code changes the rupee columns): the twins follow.
      await exec(tx, `UPDATE invoices SET subtotal = 1416, vat = 184, total = 1600 WHERE id = 'old-plan'`);
      expect((await rows<{ t: bigint }>(tx, `SELECT total_paisa AS t FROM invoices WHERE id = 'old-plan'`))[0]!.t).toBe(160_000n);
      await exec(tx, NEW_INVOICE, "new-1", t);
      expect((await rows<{ t: bigint; p: string | null }>(tx, `SELECT total_paisa AS t, plan_id AS p FROM invoices WHERE id = 'new-1'`))[0]).toEqual({ t: 40_000n, p: null });
      expect(await refused(tx, OLD_INVOICE, "bad-kind", t, "gift")).toMatch(/invoices_kind_check/);
    });
  });

  it("a number comes with its fiscal year and issue time, is unique per fiscal year, and an issued invoice can't change", async () => {
    await rolledBack(async (tx) => {
      const t = await business(tx);
      await exec(tx, NEW_INVOICE, "i1", t);
      await exec(tx, NEW_INVOICE, "i2", t);
      expect(await refused(tx, `UPDATE invoices SET no = 1 WHERE id = 'i1'`)).toMatch(/invoices_number_check/);
      await exec(tx, `UPDATE invoices SET no = 1, fy = '2083-84', issued_at = now(), status = 'paid' WHERE id = 'i1'`);
      expect(await refused(tx, `UPDATE invoices SET no = 1, fy = '2083-84', issued_at = now() WHERE id = 'i2'`)).toMatch(/invoices_fy_no_key/);
      await exec(tx, `UPDATE invoices SET no = 1, fy = '2084-85', issued_at = now() WHERE id = 'i2'`); // the next year starts at 1 again
      expect(await refused(tx, `UPDATE invoices SET total_paisa = 39999 WHERE id = 'i1'`)).toMatch(/issued tax invoice can't be changed/);
      expect(await refused(tx, `UPDATE invoices SET no = 7 WHERE id = 'i1'`)).toMatch(/issued tax invoice can't be changed/);
      // Things that are not money or the number may still change (the status, the paid time).
      await exec(tx, `UPDATE invoices SET status = 'paid', paid_at = now() WHERE id = 'i1'`);
    });
  });

  it("payments get their paisa twin, a test/live mode, and a refund never exceeds the payment", async () => {
    await rolledBack(async (tx) => {
      const t = await business(tx);
      await exec(tx, OLD_INVOICE, "inv", t, "plan");
      await exec(tx, `INSERT INTO payments (id, invoice_id, tenant_id, provider, amount, ref) VALUES ('pay1', 'inv', $1, 'esewa', 1500, 'R-1')`, t);
      expect((await rows<{ a: bigint; m: string; r: bigint }>(tx, `SELECT amount_paisa AS a, mode AS m, refunded_paisa AS r FROM payments WHERE id = 'pay1'`))[0])
        .toEqual({ a: 150_000n, m: "live", r: 0n });
      await exec(tx, `UPDATE payments SET refunded_paisa = 150000 WHERE id = 'pay1'`);
      expect(await refused(tx, `UPDATE payments SET refunded_paisa = 150001 WHERE id = 'pay1'`)).toMatch(/payments_refunded_check/);
      expect(await refused(tx, `UPDATE payments SET mode = 'sandbox' WHERE id = 'pay1'`)).toMatch(/payments_mode_check/);
    });
  });

  it("invoice lines and revenue entries always add up, revenue is live money only, and the ledger is append-only", async () => {
    await rolledBack(async (tx) => {
      const t = await business(tx);
      await exec(tx, NEW_INVOICE, "inv", t);
      const line = `INSERT INTO invoice_lines (id, invoice_id, kind, unit_gross_paisa, gross_paisa, net_paisa, vat_paisa) VALUES ($1, 'inv', 'subscription', 40000, 40000, $2, $3)`;
      await exec(tx, line, "l1", 35_398, 4_602);
      expect(await refused(tx, line, "l2", 35_398, 4_603)).toMatch(/invoice_lines_money_check/);
      const rev = `INSERT INTO revenue_entries (id, payment_id, invoice_id, invoice_line_id, tenant_id, kind, sale_type, gross_paisa, vat_paisa, net_paisa,
                     commission_bp, commission_paisa, partner_bp, partner_paisa, sheetal_net_paisa, publisher_paisa, method, mode, paid_at)
                   VALUES ($1, 'pay', 'inv', $2, $3, 'sale', 'new', 40000, 4602, 35398, 10000, 35398, 2000, 7080, 28318, 0, 'esewa', $4, now())`;
      await exec(tx, rev, "r1", "l1", t, "live");
      expect(await refused(tx, rev, "r2", "l1", t, "live")).toMatch(/revenue_entries_payment_id_invoice_line_id_kind_key/);
      expect(await refused(tx, rev, "r3", "l9", t, "test")).toMatch(/revenue_entries_mode_check/);
      expect(await refused(tx, `UPDATE revenue_entries SET method = 'khalti' WHERE id = 'r1'`)).toMatch(/can't be changed or deleted/);
      expect(await refused(tx, `DELETE FROM revenue_entries WHERE id = 'r1'`)).toMatch(/can't be changed or deleted/);
      expect(await refused(tx, `INSERT INTO revenue_entries (id, payment_id, invoice_id, tenant_id, kind, sale_type, gross_paisa, vat_paisa, net_paisa,
                     commission_bp, commission_paisa, partner_bp, partner_paisa, sheetal_net_paisa, publisher_paisa, method, paid_at)
                   VALUES ('r4', 'pay2', 'inv', $1, 'sale', 'new', 40000, 4602, 35398, 10000, 35398, 2000, 7080, 28317, 0, 'esewa', now())`, t))
        .toMatch(/revenue_entries_money_check/);
    });
  });

  it("coupons: upper-case codes, sane values, one use per business per invoice; approvals: the checker is never the maker", async () => {
    await rolledBack(async (tx) => {
      const t = await business(tx);
      const coupon = `INSERT INTO coupons (id, code, kind, value, created_by, updated_at) VALUES ($1, $2, $3, $4, 'staff-1', now())`;
      await exec(tx, coupon, "c1", "LAUNCH20", "percent", 20);
      expect(await refused(tx, coupon, "c2", "launch20", "percent", 20)).toMatch(/coupons_code_check/);
      expect(await refused(tx, coupon, "c3", "LAUNCH20", "percent", 10)).toMatch(/coupons_code_key/);
      expect(await refused(tx, coupon, "c4", "TOOMUCH", "percent", 101)).toMatch(/coupons_value_check/);
      await exec(tx, coupon, "c5", "RS500OFF", "fixed_paisa", 50_000);
      const red = `INSERT INTO coupon_redemptions (id, coupon_id, tenant_id, user_id, invoice_id, discount_paisa) VALUES ($1, 'c1', $2, 'u1', 'inv-1', 8000)`;
      await exec(tx, red, "cr1", t);
      expect(await refused(tx, red, "cr2", t)).toMatch(/coupon_redemptions_coupon_id_tenant_id_invoice_id_key/);
      expect(await refused(tx, `DELETE FROM coupons WHERE id = 'c1'`)).toMatch(/coupon_redemptions_coupon_id_fkey/); // a used coupon stays
      const appr = `INSERT INTO platform_approvals (id, action, resource, payload, maker_id, checker_id, expires_at) VALUES ($1, 'platform.billing.refund', 'payment', '{}', 'staff-1', $2, now())`;
      await exec(tx, appr, "pa1", "staff-2");
      expect(await refused(tx, appr, "pa2", "staff-1")).toMatch(/platform_approvals_checker_check/);
      expect(await refused(tx, `UPDATE platform_approvals SET status = 'done' WHERE id = 'pa1'`)).toMatch(/platform_approvals_status_check/);
    });
  });
});
