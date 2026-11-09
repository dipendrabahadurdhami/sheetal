import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const get = (who: string, url: string) => app.inject({ method: "GET", url: `/v1${url}`, headers: { authorization: `Bearer ${tok[who]}` } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, invoices, payments, payouts, payout_items RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, role] of [["finance", "finance"], ["ops", "operations"], ["owner", null]] as const) {
    const u = await db.user.create({ data: { email: `${k}@sheetal.test`, userName: k, platformRole: role, emailVerifiedAt: new Date() } });
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
    if (k === "owner") {
      const t = await db.$transaction((tx) => createWorkspace(tx, { ownerId: u.id, name: "Lakeside Hotel", type: "hotel", planId: "hotel-business" }));
      const branchId = (await db.branch.findFirstOrThrow({ where: { tenantId: t.id } })).id;
      const paidAt = new Date("2026-03-15T06:00:00Z");
      const pay = async (kind: string, total: number, vat: number, status: string) => {
        const i = await db.invoice.create({ data: { tenantId: t.id, planId: "hotel-business", months: 1, kind, subtotal: total - vat, vat, total, status: "paid", dueAt: paidAt, paidAt } });
        await db.payment.create({ data: { invoiceId: i.id, tenantId: t.id, provider: "esewa", amount: total, ref: `R${kind}${total}`, status, paidAt } });
      };
      await pay("plan", 1695, 195, "paid");
      await pay("addon", 339, 39, "paid");
      await pay("plan", 1130, 130, "refunded");
      await db.payout.create({ data: { tenantId: t.id, branchId, status: "paid", gross: 20_000, fee: 2_000, net: 18_000, scheduledOn: new Date("2026-03-20"), paidOn: new Date("2026-03-20") } });
      await db.payout.create({ data: { tenantId: t.id, branchId, status: "pending", gross: 9_000, fee: 900, net: 8_100, scheduledOn: new Date("2026-03-25") } });
    }
  }
});
afterAll(async () => { await app.close(); });

describe("platform earnings", () => {
  it("needs billing staff", async () => {
    expect((await get("ops", "/admin/earnings")).statusCode).toBe(403);
    expect((await get("owner", "/admin/earnings")).statusCode).toBe(403);
    expect((await get("finance", "/admin/earnings?from=2026-04&to=2026-03")).statusCode).toBe(400);
    expect((await get("finance", "/admin/earnings?from=soon")).statusCode).toBe(422);
  });

  it("counts plans and add-ons without VAT, commission on paid payouts, less refunds", async () => {
    const d = (await get("finance", "/admin/earnings?from=2026-02&to=2026-03")).json().data;
    expect(d.rows).toHaveLength(2);
    expect(d.rows[0]).toEqual({ month: "2026-03", plans: 1500, addons: 300, boosts: 0, commission: 2000, refunds: 1000, vat: 104, total: 2800 });
    expect(d.rows[1]).toMatchObject({ month: "2026-02", total: 0 });
    expect(d.totals.total).toBe(2800);
    expect(d.byType).toEqual([{ type: "hotel", total: 2800 }]);
    expect(d.top[0]).toMatchObject({ name: "Lakeside Hotel", total: 2800 });
  });
});
