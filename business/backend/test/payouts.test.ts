import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { dayOf } from "@sheetal/backend-core/domain/money";
import { commissionBp, feeOf, holdCutoff, nextPayoutOn, payoutSettings, recordCollected } from "@sheetal/backend-core/domain/payouts";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-payouts-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, url: string, branch?: string, tenant = ids.agency!) =>
  app.inject({ method: "GET", url: `/v1${url}`, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant, ...(branch ? { "x-branch": branch } : {}) } });

const ACCOUNT = "0012345678901";

/** A payout of a branch with one line, made the way a payout run makes it (the admin test covers the run itself). */
async function payout(branchId: string, over: { status?: string; net?: number; paidOn?: string } = {}) {
  const db = app.db!;
  const net = over.net ?? 9000;
  const p = await db.payout.create({ data: { tenantId: ids.agency!, branchId, status: over.status ?? "paid", gross: net + 1000, fee: 1000, net, scheduledOn: dayOf("2026-11-01"), paidOn: over.status === "pending" ? null : dayOf(over.paidOn ?? "2026-11-02"), bankRef: "NIC-77", bank: { bank: "NIC Asia", holder: "Everest Realty Pvt Ltd", account: ACCOUNT, branch: "Kathmandu" } } });
  await db.payoutItem.create({ data: { tenantId: ids.agency!, branchId, payoutId: p.id, source: "rent", ref: `RC-${p.seq}`, what: "Rent, Baneshwor flat", gross: net + 1000, feeBp: 1000, fee: 1000, net, collectedOn: dayOf("2026-10-30") } });
  return p;
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, outbound_emails, audit_logs, app_settings, payouts, payout_items RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "accountant", "agent", "pokhara", "outsider"]) {
    const u = await db.user.create({ data: { email: `${k}@everest.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.other = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.outsider!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency, name: "Head office" } })).id;
  ids.pokhara_branch = (await db.branch.create({ data: { tenantId: ids.agency!, name: "Pokhara" } })).id;
  await db.tenant.update({ where: { id: ids.other }, data: { settings: { payments: { mode: "own" } } } });
  await db.tenant.update({ where: { id: ids.agency }, data: { settings: { payments: { mode: "shetal", payoutBank: { bank: "NIC Asia", holder: "Everest Realty Pvt Ltd", account: ACCOUNT, branch: "Kathmandu" } } } } });
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.accountant!, roleId: (await role("accountant")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: (await role("agent")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.pokhara!, roleId: (await role("accountant")).id, status: "active", scopes: ["Pokhara"] } });
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("payout rules", () => {
  it("works out commission in whole rupees by what the business does", async () => {
    const s = await payoutSettings(app.db!);
    expect(s).toMatchObject({ day: "friday", holdDays: 2, commission: { stays: 10, projects: 1, agency: 0, investments: 2 } });
    expect(commissionBp(s, "hotel")).toBe(1000);
    expect(commissionBp(s, "sponsor")).toBe(200);
    expect(feeOf(12_345, 1000)).toBe(1235);
    expect(feeOf(-5000, 1000)).toBe(-500);
  });

  it("finds the next payout weekday and the hold cut-off", () => {
    expect(nextPayoutOn("2026-11-05", "friday")).toBe("2026-11-06"); // Thursday → Friday
    expect(nextPayoutOn("2026-11-06", "friday")).toBe("2026-11-06"); // today counts
    expect(nextPayoutOn("2026-11-07", "friday")).toBe("2026-11-13");
    expect(holdCutoff("2026-11-05", 2)).toBe("2026-11-03");
  });

  it("records collected money once, with the commission taken, and never for a business that collects its own", async () => {
    const db = app.db!;
    await db.appSetting.upsert({ where: { key: "payouts" }, create: { key: "payouts", value: { commission: { agency: 2 } } }, update: { value: { commission: { agency: 2 } } } });
    const one = { tenantId: ids.agency!, source: "rent" as const, ref: "RC-100", what: "Rent, Lazimpat", gross: 10_000, on: "2026-11-01" };
    expect(await recordCollected(db, one)).toBe(true);
    expect(await recordCollected(db, one)).toBe(false);
    expect(await db.payoutItem.findMany({ where: { ref: "RC-100" } })).toMatchObject([{ gross: 10_000, feeBp: 200, fee: 200, net: 9800, payoutId: null, branchId: ids.head }]);
    await db.appSetting.deleteMany({ where: { key: "payouts" } });
    expect(await recordCollected(db, { ...one, tenantId: ids.other!, ref: "RC-101" })).toBe(false);
    await expect(recordCollected(db, { ...one, ref: "RC-102", gross: 0 })).rejects.toThrow();
    await db.payoutItem.deleteMany({});
  });
});

describe("payouts page", () => {
  it("needs the payouts permission", async () => {
    expect((await call("agent", "/payouts")).statusCode).toBe(403);
    expect((await call("agent", "/payouts/statement")).statusCode).toBe(403);
    expect((await call("accountant", "/payouts")).statusCode).toBe(200);
    expect((await call("outsider", "/payouts")).statusCode).toBe(403); // not a member of Everest Realty
  });

  it("lists payouts, what is waiting and the schedule, and hides all but the last four digits of the account", async () => {
    const db = app.db!;
    await payout(ids.head!, { net: 9000 });
    await payout(ids.head!, { status: "pending", net: 4000 });
    await db.payoutItem.create({ data: { tenantId: ids.agency!, branchId: ids.head!, source: "booking", ref: "BK-0009", what: "Booking BK-0009", gross: 5000, feeBp: 1000, fee: 500, net: 4500, collectedOn: dayOf("2026-11-04") } });
    const res = await call("accountant", "/payouts");
    const d = res.json().data;
    expect(d.mode).toBe("sheetal");
    expect(d.bank).toEqual({ bank: "NIC Asia", holder: "Everest Realty Pvt Ltd", last4: "8901" });
    expect(res.body).not.toContain(ACCOUNT);
    expect(d.schedule).toMatchObject({ day: "friday", holdDays: 2 });
    expect(d.payouts).toHaveLength(2);
    expect(d.payouts[0]).toMatchObject({ no: expect.stringMatching(/^PO-\d{4}$/), branch: "Head office" });
    expect(d.waiting).toEqual({ count: 1, gross: 5000, fee: 500, net: 4500 });
    expect(d.onTheWay).toEqual({ count: 1, net: 4000 });
  });

  it("shows a payout with its lines, and the statement of every line", async () => {
    const list = (await call("owner", "/payouts")).json().data.payouts as { id: string; status: string }[];
    const paid = list.find((p) => p.status === "paid")!;
    const one = (await call("owner", `/payouts/${paid.id}`)).json().data;
    expect(one.lines).toMatchObject([{ source: "rent", what: "Rent, Baneshwor flat", gross: 10_000, feePct: 10, fee: 1000, net: 9000, on: "2026-10-30" }]);
    expect(one.bankRef).toBe("NIC-77");
    const rows = (await call("owner", "/payouts/statement")).json().data as { payout: string; collected: number }[];
    expect(rows.map((r) => r.payout).filter((x) => x === "Waiting")).toHaveLength(1);
    expect(rows.length).toBe(3);
    expect((await call("owner", "/payouts/statement?from=2026-11-01")).json().data).toHaveLength(1);
    expect((await call("owner", "/payouts/statement?from=soon")).statusCode).toBe(422);
    expect((await call("owner", "/payouts/statement?from=2026-02-30")).statusCode).toBe(422);
  });

  it("gives branch-limited people only their branch's money", async () => {
    await payout(ids.pokhara_branch!, { net: 2000 });
    const mine = (await call("pokhara", "/payouts")).json().data;
    expect(mine.payouts).toHaveLength(1);
    expect(mine.payouts[0]).toMatchObject({ branch: "Pokhara", net: 2000 });
    expect(mine.waiting).toEqual({ count: 0, gross: 0, fee: 0, net: 0 });
    expect(mine.onTheWay).toEqual({ count: 0, net: 0 });
    expect((await call("pokhara", "/payouts", ids.head!)).statusCode).toBe(403);
    const headId = (await app.db!.payout.findFirstOrThrow({ where: { branchId: ids.head! } })).id;
    expect((await call("pokhara", `/payouts/${headId}`)).statusCode).toBe(404);
    expect((await call("pokhara", "/payouts/statement")).json().data).toHaveLength(1);
    // The owner sees every branch, or just the one picked.
    expect((await call("owner", "/payouts")).json().data.payouts).toHaveLength(3);
    expect((await call("owner", "/payouts", ids.pokhara_branch!)).json().data.payouts).toHaveLength(1);
  });

  it("keeps one business's payouts away from another", async () => {
    const mine = (await app.db!.payout.findFirstOrThrow({ where: { tenantId: ids.agency! } })).id;
    expect((await call("outsider", `/payouts/${mine}`, undefined, ids.other)).statusCode).toBe(404);
    expect((await call("outsider", "/payouts", undefined, ids.other)).json().data.payouts).toEqual([]);
  });

  it("shows an empty page to a business that collects its own payments", async () => {
    const d = (await call("outsider", "/payouts", undefined, ids.other)).json().data;
    expect(d.mode).toBe("own");
    expect(d.payouts).toEqual([]);
  });
});
