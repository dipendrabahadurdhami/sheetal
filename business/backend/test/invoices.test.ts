import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { fiscalYearOf } from "@sheetal/backend-core/domain/money";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const media = mkdtempSync(join(tmpdir(), "sheetal-invoices-"));
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: object, branch?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": ids.agency!, ...(branch ? { "x-branch": branch } : {}) } });

const base = { to: "Sita Gurung", phone: "9841010101", pan: "301234567", date: "2026-11-04", due: "2026-11-14", vatPct: 13, lines: [{ what: "Consultation", qty: 2, rate: 3000 }, { what: "Service fee", qty: 1, rate: 500 }] };
const make = async (over: object = {}, send = true) => (await call("owner", "POST", "/invoices", { ...base, branchId: ids.head, send, ...over })).json();

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: media }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, listings, leads, outbound_emails, audit_logs, app_settings, biz_invoices, doc_counters RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "accountant", "agent", "pokhara"]) {
    const u = await db.user.create({ data: { email: `${k}@everest.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency, name: "Head office" } })).id;
  ids.pokhara_branch = (await db.branch.create({ data: { tenantId: ids.agency!, name: "Pokhara" } })).id;
  const role = (key: string) => db.role.findFirstOrThrow({ where: { tenantId: ids.agency, key } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.accountant!, roleId: (await role("accountant")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.agent!, roleId: (await role("agent")).id, status: "active" } });
  await db.membership.create({ data: { tenantId: ids.agency!, userId: ids.pokhara!, roleId: (await role("accountant")).id, status: "active", scopes: ["Pokhara"] } });
});
afterAll(async () => { await app.close(); rmSync(media, { recursive: true, force: true }); });

describe("fiscal year", () => {
  it("starts on Shrawan 1 (17 July) and is named by the two Bikram Sambat years", () => {
    expect(fiscalYearOf(new Date("2026-11-04T00:00:00Z"))).toBe("2083-84");
    expect(fiscalYearOf(new Date("2026-07-16T00:00:00Z"))).toBe("2082-83");
    expect(fiscalYearOf(new Date("2026-07-17T00:00:00Z"))).toBe("2083-84");
    expect(fiscalYearOf(new Date("2027-07-16T00:00:00Z"))).toBe("2083-84");
  });
});

describe("customer invoices", () => {
  it("keeps drafts without a number and numbers sent invoices per business and fiscal year", async () => {
    const d = await make({}, false);
    expect(d.data).toMatchObject({ status: "draft", no: null });
    expect(d.data.label).toMatch(/^DRAFT-\d{4}$/);
    const a = await make();
    const b = await make();
    expect([a.data.no, b.data.no]).toEqual(["INV-2083-84-0001", "INV-2083-84-0002"]);
    expect((await make({ date: "2026-07-10", due: "2026-07-20" })).data.no).toBe("INV-2082-83-0001");
    expect((await make()).data.no).toBe("INV-2083-84-0003");
    // Sending the draft takes the next number, so numbers never have a gap.
    const sent = (await call("owner", "POST", `/invoices/${d.data.id}/send`)).json().data;
    expect(sent).toMatchObject({ status: "sent", no: "INV-2083-84-0004" });
  });

  it("works out VAT and totals on the server, never from the browser", async () => {
    const r = await make({ total: 1, subtotal: 1, vat: 1 });
    expect(r.data.t).toMatchObject({ sub: 6500, vat: 845, total: 7345, paid: 0, balance: 7345 });
    expect((await make({ vatPct: 0 })).data.t).toMatchObject({ sub: 6500, vat: 0, total: 6500 });
    expect((await call("owner", "POST", "/invoices", { ...base, branchId: ids.head, vatPct: 18 })).statusCode).toBe(422);
    expect((await call("owner", "POST", "/invoices", { ...base, branchId: ids.head, due: "2026-11-01" })).statusCode).toBe(400);
    expect((await call("owner", "POST", "/invoices", { ...base, branchId: ids.head, lines: [{ what: "Free", qty: 1, rate: 0 }] })).statusCode).toBe(400);
  });

  it("takes payments as numbered receipts and refuses too much or too early", async () => {
    const inv = (await make()).data;
    const p1 = await call("accountant", "POST", `/invoices/${inv.id}/receipts`, { amount: 3000, method: "fonepay", at: "2026-11-05" }, ids.head);
    expect(p1.statusCode).toBe(200);
    expect(p1.json().data).toMatchObject({ t: { paid: 3000, balance: 4345 }, receipts: [{ no: expect.stringMatching(/^RC-2083-84-\d{4}$/), amount: 3000, method: "fonepay" }] });
    expect((await call("owner", "POST", `/invoices/${inv.id}/receipts`, { amount: 5000, method: "cash", at: "2026-11-05" })).statusCode).toBe(400);
    expect((await call("owner", "POST", `/invoices/${inv.id}/receipts`, { amount: 100, method: "cash", at: "2026-11-01" })).statusCode).toBe(400);
    expect((await call("owner", "POST", `/invoices/${inv.id}/receipts`, { amount: 4345, method: "cash", at: "2026-11-06" })).json().data.t.balance).toBe(0);
    expect((await call("owner", "POST", `/invoices/${inv.id}/receipts`, { amount: 1, method: "cash", at: "2026-11-06" })).statusCode).toBe(400);
    // Paid money documents are not cancelled or edited.
    expect((await call("owner", "POST", `/invoices/${inv.id}/cancel`, { reason: "Raised by mistake" })).statusCode).toBe(400);
    expect((await call("owner", "PUT", `/invoices/${inv.id}`, base)).statusCode).toBe(400);
    expect((await call("owner", "DELETE", `/invoices/${inv.id}`)).statusCode).toBe(400);
  });

  it("two payments at the same moment cannot pay more than the balance", async () => {
    const inv = (await make()).data;
    const pay = () => call("owner", "POST", `/invoices/${inv.id}/receipts`, { amount: 5000, method: "cash", at: "2026-11-05" });
    const codes = (await Promise.all([pay(), pay()])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 400]);
  });

  it("cancels an unpaid invoice but keeps its number and reason", async () => {
    const inv = (await make()).data;
    expect((await call("owner", "POST", `/invoices/${inv.id}/cancel`, {})).statusCode).toBe(422);
    const c = (await call("owner", "POST", `/invoices/${inv.id}/cancel`, { reason: "Duplicate invoice" })).json().data;
    expect(c).toMatchObject({ status: "cancelled", no: inv.no, cancelReason: "Duplicate invoice", t: { balance: 0 } });
    expect((await call("owner", "POST", `/invoices/${inv.id}/receipts`, { amount: 100, method: "cash", at: "2026-11-05" })).statusCode).toBe(400);
    const next = await make();
    expect(Number(next.data.no.slice(-4))).toBeGreaterThan(Number(inv.no.slice(-4)));
  });

  it("issues credit notes up to what is left, and splits VAT so it adds up", async () => {
    const inv = (await make()).data; // 7,345 with VAT
    await call("owner", "POST", `/invoices/${inv.id}/receipts`, { amount: 7345, method: "bank", at: "2026-11-05" });
    const cn = await call("owner", "POST", `/invoices/${inv.id}/credit`, { amount: 1000, reason: "One session not held", date: "2026-11-06" });
    expect(cn.statusCode).toBe(200);
    expect(cn.json().data).toMatchObject({ kind: "credit", no: expect.stringMatching(/^CN-2083-84-\d{4}$/), creditFor: inv.no, t: { sub: -885, vat: -115, total: -1000, balance: 0 } });
    expect((await call("owner", "POST", `/invoices/${inv.id}/credit`, { amount: 6346, reason: "Too much" })).statusCode).toBe(400);
    expect((await call("owner", "POST", `/invoices/${inv.id}/credit`, { amount: 6345, reason: "The rest" })).statusCode).toBe(200);
    expect((await call("owner", "POST", `/invoices/${inv.id}/credit`, { amount: 1, reason: "Nothing left" })).statusCode).toBe(400);
    expect((await call("owner", "POST", `/invoices/${inv.id}/cancel`, { reason: "Duplicate invoice" })).statusCode).toBe(400);
    const list = (await call("owner", "GET", "/invoices")).json().data as { kind: string; creditFor: string | null }[];
    expect(list.filter((x) => x.kind === "credit" && x.creditFor === inv.no)).toHaveLength(2);
  });

  it("only lets invoice people in, and only on their branches", async () => {
    const hq = (await make()).data;
    expect((await call("agent", "GET", "/invoices")).statusCode).toBe(403);
    expect((await call("agent", "POST", "/invoices", { ...base, branchId: ids.head })).statusCode).toBe(403);
    expect((await call("accountant", "GET", "/invoices")).json().data.length).toBeGreaterThan(0);
    // A Pokhara-only accountant sees nothing of Head office, and can't write there.
    expect((await call("pokhara", "GET", "/invoices")).json().data).toEqual([]);
    expect((await call("pokhara", "POST", `/invoices/${hq.id}/receipts`, { amount: 100, method: "cash", at: "2026-11-05" })).statusCode).toBe(404);
    expect((await call("pokhara", "POST", "/invoices", { ...base, branchId: ids.head })).statusCode).toBe(403);
    const own = await call("pokhara", "POST", "/invoices", { ...base, send: true });
    expect(own.statusCode).toBe(200);
    expect(own.json().data.branchId).toBe(ids.pokhara_branch);
    expect((await call("owner", "GET", "/invoices", undefined, ids.pokhara_branch)).json().data.map((x: { id: string }) => x.id)).toEqual([own.json().data.id]);
  });

  it("links a booking code to the real booking", async () => {
    expect((await call("owner", "POST", "/invoices", { ...base, branchId: ids.head, order: "BK-9999" })).statusCode).toBe(400);
    const bk = await app.db!.booking.create({ data: { tenantId: ids.agency!, branchId: ids.head!, roomType: "Deluxe", guestName: "Rita Maharjan", checkIn: new Date("2026-11-01"), checkOut: new Date("2026-11-03"), rate: 5000 } });
    const code = `BK-${String(bk.seq).padStart(4, "0")}`;
    const r = (await call("owner", "POST", "/invoices", { ...base, branchId: ids.head, order: code.toLowerCase() })).json().data;
    expect(r).toMatchObject({ order: code, bookingId: bk.id });
  });

  it("makes the room bill into an invoice, with the service charge and what the guest paid at the desk", async () => {
    const bk = await app.db!.booking.create({ data: { tenantId: ids.agency!, branchId: ids.head!, roomType: "Deluxe", guestName: "Rita Maharjan", phone: "9815550011", checkIn: new Date("2026-11-01"), checkOut: new Date("2026-11-03"), rate: 5000 } });
    await app.db!.folioLine.createMany({ data: [{ bookingId: bk.id, kind: "room", what: "Deluxe room night", qty: 2, amount: 10000 }, { bookingId: bk.id, kind: "pos", what: "Dinner", qty: 1, amount: 1000 }] });
    await app.db!.guestPayment.create({ data: { bookingId: bk.id, method: "cash", amount: 2000 } });
    const code = `BK-${String(bk.seq).padStart(4, "0")}`;
    const d = (await call("owner", "POST", "/invoices/from-booking", { booking: code, date: "2026-11-03" })).json().data;
    // 11,000 + 10% service 1,100 = 12,100; 13% VAT 1,573.
    expect(d).toMatchObject({ status: "draft", to: "Rita Maharjan", order: code, t: { sub: 12100, vat: 1573, total: 13673 } });
    expect(d.lines).toEqual([{ what: "Deluxe room night", qty: 2, rate: 5000 }, { what: "Dinner", qty: 1, rate: 1000 }, { what: "Service charge 10%", qty: 1, rate: 1100 }]);
    expect((await call("owner", "POST", "/invoices/from-booking", { booking: code })).statusCode).toBe(409);
    const sent = (await call("owner", "POST", `/invoices/${d.id}/send`)).json().data;
    expect(sent.t).toMatchObject({ paid: 2000, balance: 11673 });
    expect(sent.receipts).toEqual([expect.objectContaining({ amount: 2000, method: "cash", note: "Paid at the front desk" })]);
    expect((await call("owner", "POST", "/invoices/from-booking", { booking: "BK-9999" })).statusCode).toBe(404);
  });

  it("imports invoices as sent, counting what was paid", async () => {
    const r = await call("owner", "POST", "/invoices/import", { rows: [{ to: "Hari KC", date: "2026-11-02", item: "Room 201, 3 nights", amount: 19500, vat: 13, paid: 22035 }, { to: "Gita Rai", date: "2026-11-02", item: "Consultation", amount: 1000, paid: 500 }] }, ids.head);
    expect(r.statusCode).toBe(200);
    const list = (await call("owner", "GET", "/invoices", undefined, ids.head)).json().data as { to: string; status: string; t: { total: number; paid: number; balance: number } }[];
    expect(list.find((x) => x.to === "Hari KC")).toMatchObject({ status: "sent", t: { total: 22035, paid: 22035, balance: 0 } });
    expect(list.find((x) => x.to === "Gita Rai")).toMatchObject({ t: { total: 1130, paid: 500, balance: 630 } });
    expect((await call("owner", "POST", "/invoices/import", { rows: [{ to: "X", date: "2026-11-02", item: "Y", amount: 100, paid: 500 }] }, ids.head)).statusCode).toBe(400);
    expect((await call("owner", "POST", "/invoices/import", { rows: [] }, ids.head)).statusCode).toBe(422);
    // The Export button gets the same columns back (customer, date, item, amount before VAT, VAT %, paid).
    expect((await call("owner", "GET", "/invoices/rows", undefined, ids.head)).json().data).toEqual(expect.arrayContaining([expect.objectContaining({ to: "Hari KC", item: "Room 201, 3 nights", amount: 19500, vat: 13, paid: 22035 })]));
  });

  it("keeps a branch with invoices from being deleted", async () => {
    const r = await call("owner", "DELETE", `/branches/${ids.pokhara_branch}`);
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toContain("invoice");
  });
});
