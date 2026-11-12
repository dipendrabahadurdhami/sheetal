import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { confirmRentPayment, rejectRentPayment } from "@sheetal/app-rentals/backend/rentpay";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-rent-"));
const ids: Record<string, string> = {};
let token = "";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const call = (method: "GET" | "POST", url: string, body?: object, signedIn = false) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: signedIn ? { authorization: `Bearer ${token}` } : {}, remoteAddress: `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "website"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, audit_logs, listings, rent_owners, rent_units, rent_leases, rent_bills, rent_payments, rent_repairs, owner_statements, payouts, payout_items RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  const owner = await db.user.create({ data: { email: "owner@everest.test", userName: "owner", emailVerifiedAt: new Date() } });
  const renter = await db.user.create({ data: { email: "sita@renter.test", userName: "sita", emailVerifiedAt: new Date() } });
  ids.renter = renter.id;
  token = await createSession(app, renter.id, { ip: "127.0.0.1", headers: {} } as never);
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: owner.id, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  const branchId = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency } })).id;
  const listing = await db.listing.create({ data: { code: "ER-0001", oldCodes: ["SP-0001"], slug: "flat-1", tenantId: ids.agency, kind: "rentout", purpose: "rent", category: "Apartment", title: "Flat in Sanepa", status: "published" } });
  const ownerRow = await db.rentOwner.create({ data: { tenantId: ids.agency!, branchId, name: "Ram Thapa" } });
  const unit = await db.rentUnit.create({ data: { tenantId: ids.agency!, branchId, ownerId: ownerRow.id, property: "Sanepa Apartments", name: "Flat 3A", rent: 20_000, status: "let", listingId: listing.id } });
  const lease = await db.rentLease.create({ data: { tenantId: ids.agency!, branchId, unitId: unit.id, renter: "Sita Sharma", phone: "+977 980-1234567", startOn: new Date("2025-01-01"), endOn: new Date("2025-12-31"), rent: 20_000 } });
  ids.lease = lease.id; ids.leaseNo = `LS-${String(lease.seq).padStart(4, "0")}`;
  ids.bill = (await db.rentBill.create({ data: { tenantId: ids.agency!, branchId, leaseId: lease.id, month: "2025-03", dueOn: new Date("2025-03-07"), amount: 20_000 } })).id;
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("pay rent online", () => {
  it("finds a lease only with the right code and mobile number", async () => {
    expect((await call("POST", "/rent/find", { code: "ER-0001", phone: "9800000000" })).statusCode).toBe(404);
    expect((await call("POST", "/rent/find", { code: "ER-9999", phone: "9801234567" })).statusCode).toBe(404);
    const r = await call("POST", "/rent/find", { code: "er-0001", phone: "9801234567" });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ lease: ids.leaseNo, unit: "Sanepa Apartments · Flat 3A", business: "Everest Realty", payTo: "sheetal", bills: [{ month: "2025-03", left: 20_000 }] });
    expect(r.json().data.methods[0]).toMatchObject({ method: "fonepay", qr: "/pay/fonepay-qr.png" });
    expect((await call("POST", "/rent/find", { code: "SP-0001", phone: "9801234567" })).statusCode).toBe(200); // the old code
    expect((await call("POST", "/rent/find", { code: ids.leaseNo, phone: "9801234567" })).statusCode).toBe(200);
  });

  it("links the lease to a signed-in person who finds it, and lists it under My rentals", async () => {
    expect((await call("GET", "/rent/mine")).statusCode).toBe(401);
    expect((await call("GET", "/rent/mine", undefined, true)).json().data).toEqual([]);
    expect((await call("POST", "/rent/find", { code: "ER-0001", phone: "9801234567" }, true)).statusCode).toBe(200);
    const mine = (await call("GET", "/rent/mine", undefined, true)).json().data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ leaseId: ids.lease, view: { lease: ids.leaseNo } });
  });

  it("takes a payment that waits to be confirmed, and never more than is owed", async () => {
    const body = { leaseId: ids.lease, billId: ids.bill, method: "fonepay", ref: "FP-123456", paidOn: "2025-03-08", proof: PNG };
    expect((await call("POST", "/rent/pay", { ...body, amount: 25_000 }, true)).statusCode).toBe(400);
    expect((await call("POST", "/rent/pay", { ...body, amount: 5_000, proof: Buffer.from("not a picture at all").toString("base64") }, true)).statusCode).toBe(400);
    expect((await call("POST", "/rent/pay", { ...body, leaseId: null, amount: 5_000 })).statusCode).toBe(400); // not signed in, no code
    const r = await call("POST", "/rent/pay", { ...body, amount: 20_000 }, true);
    expect(r.statusCode).toBe(200);
    expect(r.json().data.collectedBy).toBe("sheetal");
    expect((await call("POST", "/rent/pay", { ...body, amount: 1 }, true)).statusCode).toBe(400); // the rest is already waiting
    const p = await app.db!.rentPayment.findFirstOrThrow({ where: { billId: ids.bill } });
    expect(p).toMatchObject({ status: "pending", source: "online", collectedBy: "sheetal", userId: ids.renter });
    expect(p.proofFile).toBeTruthy();
    expect((await app.db!.rentBill.findUniqueOrThrow({ where: { id: ids.bill } })).paid).toBe(0);
    ids.payment = p.id;
  });

  it("adds a confirmed payment to the bill once, and records Sheetal's money for the payout", async () => {
    const db = app.db!;
    await confirmRentPayment(db, { paymentId: ids.payment!, by: ids.renter! });
    await expect(confirmRentPayment(db, { paymentId: ids.payment!, by: ids.renter! })).rejects.toThrow();
    expect((await db.rentBill.findUniqueOrThrow({ where: { id: ids.bill } })).paid).toBe(20_000);
    expect(await db.payoutItem.findFirstOrThrow({ where: { ref: `RP-${ids.payment}` } })).toMatchObject({ tenantId: ids.agency, source: "rent", gross: 20_000, payoutId: null });
    await expect(rejectRentPayment(db, { paymentId: ids.payment!, by: ids.renter!, note: "Too late" })).rejects.toThrow();
    const mine = (await call("GET", "/rent/mine", undefined, true)).json().data[0];
    expect(mine.payments[0]).toMatchObject({ amount: 20_000, status: "confirmed" });
    expect(mine.view.bills).toEqual([]);
  });

  it("sends rent to the business's own account when it collects its own payments", async () => {
    await app.db!.tenant.update({ where: { id: ids.agency }, data: { settings: { payments: { mode: "own", own: { esewa: { on: true, merchant: "9801111111" }, khalti: { on: false, key: "secret" } } } } } });
    const v = (await call("POST", "/rent/find", { code: "ER-0001", phone: "9801234567" })).json().data;
    expect(v).toMatchObject({ payTo: "business", methods: [{ method: "esewa", detail: "9801111111" }] });
    expect(JSON.stringify(v)).not.toContain("secret");
  });
});
