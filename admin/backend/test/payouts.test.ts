import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { nepalDay, recordCollected } from "@sheetal/backend-core/domain/payouts";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body?: object) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });
async function person(key: string, email: string, platformRole: string | null = null) {
  const u = await app.db!.user.create({ data: { email, userName: key, platformRole, passwordHash: "x" } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
const BANK = { bank: "NIC Asia", holder: "Everest Realty Pvt Ltd", account: "0012345678901", branch: "Kathmandu" };
const collect = (tenantId: string, ref: string, gross: number, on: string) => recordCollected(app.db!, { tenantId, source: "rent", ref, what: `Rent ${ref}`, gross, on });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, payouts, payout_items RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("boss", "admin@sheetal.test", "super_admin");
  await person("finance", "finance@sheetal.test", "finance");
  await person("ops", "ops@sheetal.test", "operations");
  await person("owner", "owner@everest.test");
  await person("owner2", "owner@lakeside.test");
  ids.everest = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency" }))).id;
  ids.lakeside = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner2!, name: "Lakeside Hotel", type: "hotel" }))).id;
  await db.tenant.update({ where: { id: ids.everest }, data: { settings: { payments: { mode: "shetal", payoutBank: BANK } } } });
  // Lakeside has no bank account yet.
});
afterAll(async () => { await app.close(); });

describe("payout run", () => {
  it("needs finance or the super admin", async () => {
    expect((await call("ops", "GET", "/admin/payouts")).statusCode).toBe(403);
    expect((await call("ops", "POST", "/admin/payouts/run")).statusCode).toBe(403);
    expect((await call("finance", "GET", "/admin/payouts")).statusCode).toBe(200);
  });

  it("pays out only money that is past the hold days, one payout per business and branch, and skips what can't be paid", async () => {
    // Old money for two businesses, and one payment from today that is still on hold.
    await collect(ids.everest!, "RC-1", 20_000, "2026-01-05");
    await collect(ids.everest!, "RC-2", 10_000, "2026-01-06");
    await collect(ids.everest!, "RC-3", 7_000, nepalDay());
    await collect(ids.lakeside!, "BK-1", 30_000, "2026-01-05");
    const before = (await call("finance", "GET", "/admin/payouts")).json().data.summary;
    expect(before.waiting).toMatchObject({ count: 4, businesses: 2 });

    expect((await call("finance", "POST", "/admin/payouts/run")).json().data).toMatchObject({ made: [expect.stringMatching(/^PO-\d{4}$/)], skipped: [{ tenant: "Lakeside Hotel", reason: "No bank account set up." }] });
    const list = (await call("finance", "GET", "/admin/payouts")).json().data;
    expect(list.rows).toHaveLength(1);
    // Agency commission is 0% by default: 30,000 collected, 30,000 paid out. Waiting: today's Rs. 7,000 and Lakeside's 30,000 less its 10% (27,000).
    expect(list.rows[0]).toMatchObject({ tenant: "Everest Realty", branch: "Head office", status: "pending", kind: "batch", gross: 30_000, fee: 0, net: 30_000, bank: { account: BANK.account } });
    expect(list.summary).toMatchObject({ waiting: { count: 2, net: 7_000 + 27_000 }, pending: { count: 1, net: 30_000 } });
    // Running again makes nothing new: the same money is never in two payouts.
    expect((await call("finance", "POST", "/admin/payouts/run")).json().data.made).toEqual([]);
    expect(await app.db!.payoutItem.count({ where: { payoutId: { not: null } } })).toBe(2);
  });

  it("takes the commission set by staff, and only the super admin can set it", async () => {
    const body = { commission: { stays: 12, projects: 1, agency: 5, investments: 2 }, day: "sunday", holdDays: 1 };
    expect((await call("finance", "PUT", "/admin/settings/payouts", body)).statusCode).toBe(403);
    expect((await call("boss", "PUT", "/admin/settings/payouts", { ...body, commission: { ...body.commission, agency: 80 } })).statusCode).toBe(422);
    expect((await call("boss", "PUT", "/admin/settings/payouts", body)).statusCode).toBe(200);
    expect((await call("finance", "GET", "/admin/settings/payouts")).json().data).toEqual({ ...body, canEdit: false });
    expect((await call("boss", "GET", "/admin/settings/payouts")).json().data).toEqual({ ...body, canEdit: true });
    await collect(ids.everest!, "RC-4", 10_000, "2026-01-07");
    expect(await app.db!.payoutItem.findFirstOrThrow({ where: { ref: "RC-4" } })).toMatchObject({ feeBp: 500, fee: 500, net: 9500 });
    // Money collected earlier keeps the commission it was collected with.
    expect(await app.db!.payoutItem.findFirstOrThrow({ where: { ref: "RC-1" } })).toMatchObject({ feeBp: 0, fee: 0 });
  });
});

describe("paying and failing", () => {
  it("marks a payout paid once, tells the business, and keeps the bank reference", async () => {
    const p = (await call("finance", "GET", "/admin/payouts")).json().data.rows[0] as { id: string; no: string };
    expect((await call("ops", "POST", `/admin/payouts/${p.id}/paid`, { bankRef: "NIC-1" })).statusCode).toBe(403);
    expect((await call("finance", "POST", `/admin/payouts/${p.id}/paid`, { bankRef: "NIC-1", paidOn: "2026-11-05" })).statusCode).toBe(200);
    expect((await call("finance", "POST", `/admin/payouts/${p.id}/paid`, { bankRef: "NIC-1" })).statusCode).toBe(400);
    expect((await call("finance", "POST", `/admin/payouts/${p.id}/fail`, { reason: "Too late" })).statusCode).toBe(400);
    expect(await app.db!.payout.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: "paid", bankRef: "NIC-1" });
    const note = await app.db!.notification.findFirst({ where: { userId: ids.owner!, type: "payout" } });
    expect(note).toMatchObject({ tenantId: ids.everest, link: "/business/payouts" });
    expect(note!.title).toContain(p.no);
    expect((await call("finance", "GET", "/admin/payouts?status=paid")).json().data.rows).toHaveLength(1);
  });

  it("gives the money back to waiting when a transfer fails, so the next run picks it up", async () => {
    await app.db!.tenant.update({ where: { id: ids.lakeside }, data: { settings: { payments: { mode: "shetal", payoutBank: { ...BANK, account: "000999888" } } } } });
    const run = (await call("finance", "POST", "/admin/payouts/run")).json().data;
    expect(run.made).toHaveLength(2); // Everest's Rs. 10,000 (RC-4) and Lakeside's Rs. 30,000
    const rows = (await call("finance", "GET", "/admin/payouts")).json().data.rows as { id: string; tenant: string; net: number }[];
    const lake = rows.find((r) => r.tenant === "Lakeside Hotel")!;
    expect(lake.net).toBe(27_000); // collected at the old 10% stays commission, so the new 12% doesn't change it
    expect((await call("finance", "POST", `/admin/payouts/${lake.id}/fail`, {})).statusCode).toBe(422);
    expect((await call("finance", "POST", `/admin/payouts/${lake.id}/fail`, { reason: "Account closed" })).statusCode).toBe(200);
    expect(await app.db!.payout.findUniqueOrThrow({ where: { id: lake.id } })).toMatchObject({ status: "failed", failReason: "Account closed" });
    expect(await app.db!.payoutItem.count({ where: { tenantId: ids.lakeside!, payoutId: null } })).toBe(1);
    expect((await call("finance", "POST", "/admin/payouts/run")).json().data.made).toHaveLength(1);
  });
});

describe("manual payouts", () => {
  it("records a settlement paid outside the run, already paid", async () => {
    const body = { tenantId: ids.everest, gross: 50_000, fee: 2_500, paidOn: "2026-11-03", bankRef: "CHQ-88", note: "October site settlement" };
    expect((await call("ops", "POST", "/admin/payouts/manual", body)).statusCode).toBe(403);
    expect((await call("finance", "POST", "/admin/payouts/manual", { ...body, fee: 60_000 })).statusCode).toBe(422);
    expect((await call("finance", "POST", "/admin/payouts/manual", { ...body, note: "" })).statusCode).toBe(422);
    expect((await call("finance", "POST", "/admin/payouts/manual", { ...body, tenantId: "nope" })).statusCode).toBe(404);
    expect((await call("finance", "POST", "/admin/payouts/manual", body)).statusCode).toBe(200);
    expect(await app.db!.payout.findFirstOrThrow({ where: { kind: "manual" } })).toMatchObject({ status: "paid", gross: 50_000, fee: 2_500, net: 47_500, bankRef: "CHQ-88", note: "October site settlement" });
    expect(await app.db!.payoutItem.count({ where: { payout: { kind: "manual" } } })).toBe(0);
  });

  it("pays out the waiting money by hand, so the next run can't pay it again", async () => {
    // Everest still has RC-3 (Rs. 7,000 from today, on hold).
    expect((await call("finance", "GET", `/admin/payouts/waiting/${ids.everest}`)).json().data).toMatchObject({ count: 1, net: 7_000 });
    const body = { tenantId: ids.everest, settleWaiting: true, paidOn: "2026-11-05", bankRef: "NIC-9", note: "Paid early on request" };
    expect((await call("finance", "POST", "/admin/payouts/manual", { ...body, settleWaiting: false })).statusCode).toBe(422); // no amount
    expect((await call("finance", "POST", "/admin/payouts/manual", { ...body, branchId: "nope" })).statusCode).toBe(400);
    expect((await call("finance", "POST", "/admin/payouts/manual", body)).statusCode).toBe(200);
    expect(await app.db!.payoutItem.findFirstOrThrow({ where: { ref: "RC-3" }, include: { payout: true } })).toMatchObject({ payout: { kind: "manual", status: "paid", net: 7_000, bankRef: "NIC-9" } });
    expect((await call("finance", "GET", `/admin/payouts/waiting/${ids.everest}`)).json().data).toMatchObject({ count: 0, net: 0 });
    expect((await call("finance", "POST", "/admin/payouts/manual", body)).statusCode).toBe(400); // nothing left
  });

  it("keeps a refund next to its payment under the same ref", async () => {
    expect(await collect(ids.everest!, "RC-1", -1_000, "2026-11-04")).toBe(true);
    expect(await collect(ids.everest!, "RC-1", -1_000, "2026-11-04")).toBe(false);
    expect(await app.db!.payoutItem.findFirstOrThrow({ where: { ref: "RC-1:refund" } })).toMatchObject({ gross: -1_000, payoutId: null });
  });
});
