import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PATCH" | "PUT", url: string, body?: object, tenant = ids.hotel) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant! } });
async function person(key: string, email: string) {
  const u = await app.db!.user.create({ data: { email, userName: key, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, listings, rooms, bookings, menu_items, shifts, pos_bills, units, reservations, commitments, investment_updates, outbound_emails, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("owner", "owner@lakeside.test");
  await person("desk", "desk@lakeside.test");
  await person("dev", "dev@heights.test");
  ids.hotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lakeside Inn", type: "hotel", planId: "hotel-business" }))).id;
  const role = await db.role.findFirstOrThrow({ where: { tenantId: ids.hotel, key: "frontdesk" } });
  await db.membership.create({ data: { tenantId: ids.hotel, userId: ids.desk!, roleId: role.id, status: "active" } });
  ids.devco = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.dev!, name: "Heights Builders", type: "developer", planId: "developer-business" }))).id;
  ids.sponsor = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.dev!, name: "Heights Invest", type: "sponsor", planId: "sponsor-business" }))).id;
  ids.project = String((await db.listing.create({ data: { code: "SP-0001", slug: "heights", tenantId: ids.devco, kind: "project", purpose: "sale", category: "Project", title: "Heights Residency", status: "published" } })).id);
  ids.invest = String((await db.listing.create({ data: { code: "SP-0002", slug: "lodge", tenantId: ids.sponsor, kind: "invest", purpose: "sale", category: "Investment", title: "Chitwan Lodge", status: "published", price: 50_000_000n } })).id);
});
afterAll(async () => { await app.close(); });

describe("rooms and bookings", () => {
  it("adds rooms within the plan and refuses duplicates", async () => {
    expect((await call("desk", "POST", "/rooms", { type: "Deluxe", rate: 6000, nos: ["101", "102"] })).statusCode).toBe(403);
    expect((await call("owner", "POST", "/rooms", { type: "Deluxe", rate: 6000, nos: ["101", "102"] })).statusCode).toBe(200);
    expect((await call("owner", "POST", "/rooms", { type: "Deluxe", rate: 6000, nos: ["102"] })).statusCode).toBe(409);
    expect((await call("owner", "POST", "/rooms", { type: "Suite", rate: 12000, nos: Array.from({ length: 39 }, (_, i) => `S${i}`) })).statusCode).toBe(400); // 40 rooms on Business
  });

  it("never books one room twice, nor more rooms of a type than there are", async () => {
    const rooms = (await call("desk", "GET", "/rooms")).json().data;
    ids.r101 = rooms.find((r: { no: string }) => r.no === "101").id;
    const a = await call("desk", "POST", "/bookings", { type: "Deluxe", roomId: ids.r101, guest: "Sita Gurung", phone: "9800000001", from: day(0), to: day(3) });
    expect(a.json().data).toMatchObject({ code: "BK-0001", nights: 3, rate: 6000, amount: 18000 });
    ids.b1 = a.json().data.id;
    expect((await call("desk", "POST", "/bookings", { type: "Deluxe", roomId: ids.r101, guest: "Ram", from: day(2), to: day(4) })).statusCode).toBe(409);
    expect((await call("desk", "POST", "/bookings", { type: "Deluxe", guest: "Hari", from: day(1), to: day(2) })).statusCode).toBe(200); // the other Deluxe
    expect((await call("desk", "POST", "/bookings", { type: "Deluxe", guest: "Gita", from: day(1), to: day(2) })).statusCode).toBe(409); // both taken that night
    expect((await call("desk", "POST", "/bookings", { type: "Deluxe", guest: "Gita", from: day(3), to: day(5) })).statusCode).toBe(200); // check-out day is free
    expect((await call("desk", "GET", `/availability?from=${day(1)}&to=${day(2)}`)).json().data).toEqual([expect.objectContaining({ type: "Deluxe", rooms: 2, free: 0 })]);
  });

  it("checks in only with the guest's ID seen, then bills nights, extras and the restaurant with service and VAT", async () => {
    expect((await call("desk", "POST", `/bookings/${ids.b1}/check-in`, {})).statusCode).toBe(422);
    const ci = await call("desk", "POST", `/bookings/${ids.b1}/check-in`, { idChecked: true });
    expect(ci.json().data).toMatchObject({ status: "checked_in", room: "101", bill: { subtotal: 18000 } });
    await call("desk", "POST", `/bookings/${ids.b1}/folio`, { kind: "extra", what: "Airport pickup", amount: 1500 });
    expect((await call("desk", "POST", `/bookings/${ids.b1}/folio`, { kind: "discount", what: "Regular guest", amount: 500 })).statusCode).toBe(403); // front desk can't discount
    await call("owner", "POST", "/menu", { items: [{ name: "Chicken momo", price: 420, category: "Nepali" }, { name: "Masala tea", price: 120, category: "Drinks" }] });
    const menu = (await call("desk", "GET", "/menu")).json().data;
    // The menu price wins over what the till sends.
    const bill = await call("desk", "POST", "/pos/bills", { outlet: "Restaurant", method: "room", bookingId: ids.b1, lines: [{ itemId: menu.find((m: { name: string }) => m.name === "Chicken momo").id, name: "x", qty: 2, price: 1 }] });
    expect(bill.json().data).toMatchObject({ subtotal: 840, method: "room" });
    const d = (await call("desk", "GET", `/bookings/${ids.b1}`)).json().data;
    // 18,000 + 1,500 + 840 = 20,340; service 2,034; VAT 13% of 22,374 = 2,909; total 25,283
    expect(d.bill).toMatchObject({ subtotal: 20340, service: 2034, vat: 2909, total: 25283, due: 25283 });
  });

  it("checks out only when the bill is paid; the room goes to housekeeping", async () => {
    expect((await call("desk", "POST", `/bookings/${ids.b1}/check-out`)).statusCode).toBe(400);
    await call("desk", "POST", `/bookings/${ids.b1}/payments`, { method: "fonepay", amount: 25283, ref: "FP123" });
    expect((await call("desk", "POST", `/bookings/${ids.b1}/check-out`)).statusCode).toBe(200);
    expect((await call("desk", "GET", "/rooms")).json().data.find((r: { no: string }) => r.no === "101").status).toBe("dirty");
  });
});

describe("point of sale", () => {
  it("needs an open shift for cash and counts the drawer at close", async () => {
    const lines = [{ name: "Masala tea", qty: 3, price: 120 }];
    expect((await call("desk", "POST", "/pos/bills", { outlet: "Café", method: "cash", lines })).statusCode).toBe(400);
    await call("desk", "POST", "/shifts/open", { float: 2000 });
    const b = (await call("desk", "POST", "/pos/bills", { outlet: "Café", method: "cash", lines })).json().data; // 360 + 36 + 51 = 447
    expect(b).toMatchObject({ total: 447, code: expect.stringMatching(/^POS-/) });
    expect((await call("desk", "GET", "/shifts/current")).json().data).toMatchObject({ expectedCash: 2447 });
    const close = await call("desk", "POST", "/shifts/close", { counted: 2400 });
    expect(close.json().data).toEqual({ expected: 2447, counted: 2400, diff: -47 });
  });
});

describe("projects", () => {
  it("holds a unit for one buyer at a time, reserves it with a plan, and sells it when paid", async () => {
    expect((await call("dev", "POST", `/projects/${ids.project}/units`, { block: "A", type: "2BHK", sizeSqft: 1100, price: 12_000_000, nos: ["101", "102"] }, ids.devco)).statusCode).toBe(200);
    const unit = (await call("dev", "GET", "/projects", undefined, ids.devco)).json().data[0].units[0];
    expect((await call("dev", "POST", `/units/${unit.id}/hold`, { days: 3 }, ids.devco)).statusCode).toBe(200);
    expect((await call("dev", "POST", `/units/${unit.id}/hold`, { days: 3 }, ids.devco)).statusCode).toBe(409);
    expect((await call("dev", "POST", `/units/${unit.id}/reserve`, { buyer: "Bikash", plan: [{ label: "Booking", due: day(0), amount: 1_000_000 }] }, ids.devco)).statusCode).toBe(400); // must add up
    const r = (await call("dev", "POST", `/units/${unit.id}/reserve`, { buyer: "Bikash", plan: [{ label: "Booking", due: day(0), amount: 2_000_000 }, { label: "Handover", due: day(300), amount: 10_000_000 }] }, ids.devco)).json().data;
    expect(r).toMatchObject({ status: "reserved", due: 12_000_000, unit: { status: "reserved" } });
    expect((await call("dev", "POST", `/units/${unit.id}/reserve`, { buyer: "Other" }, ids.devco)).statusCode).toBe(409);
    const first = (await call("dev", "POST", `/reservations/${r.id}/collections`, { amount: 2_000_000, method: "bank", ref: "NIC1" }, ids.devco)).json().data;
    expect(first.plan[0]).toMatchObject({ done: true });
    expect((await call("dev", "POST", `/reservations/${r.id}/collections`, { amount: 20_000_000, method: "bank" }, ids.devco)).statusCode).toBe(400);
    const done = await call("dev", "POST", `/reservations/${r.id}/collections`, { amount: 10_000_000, method: "bank" }, ids.devco);
    expect(done.json()).toMatchObject({ message: "Fully paid. The unit is sold.", data: { status: "sold", due: 0, unit: { status: "sold" } } });
  });
});

describe("investments", () => {
  it("tracks pledges and payments against the target and emails updates to investors", async () => {
    await call("dev", "POST", `/investments/${ids.invest}/commitments`, { name: "Anita", email: "anita@x.test", amount: 1_000_000 }, ids.sponsor);
    await call("dev", "POST", `/investments/${ids.invest}/commitments`, { name: "Kumar", amount: 500_000 }, ids.sponsor);
    let inv = (await call("dev", "GET", "/investments", undefined, ids.sponsor)).json().data[0];
    expect(inv).toMatchObject({ target: 50_000_000, pledged: 1_500_000, paid: 0 });
    await call("dev", "PATCH", `/commitments/${inv.investors.find((i: { name: string }) => i.name === "Anita").id}`, { status: "paid", ref: "BANK-1" }, ids.sponsor);
    inv = (await call("dev", "GET", "/investments", undefined, ids.sponsor)).json().data[0];
    expect(inv.paid).toBe(1_000_000);
    const u = await call("dev", "POST", `/investments/${ids.invest}/updates`, { title: "Foundation done", body: "The foundation is finished and the first floor starts next week." }, ids.sponsor);
    expect(u.json().message).toContain("1 investor");
    expect(await app.db!.outboundEmail.count({ where: { to: "anita@x.test" } })).toBe(1);
  });
});

describe("calendar", () => {
  // A night's day of the week, n days from today (UTC dates, as the calendar uses).
  const dow = (n: number) => new Date(`${day(n)}T00:00:00Z`).getUTCDay();
  const nextWeekday = (from: number, want: number[]) => { let n = from; while (!want.includes(dow(n))) n++; return n; };
  const month = (n: number) => day(n).slice(0, 7);

  it("shows the month's nights at the normal price, and only people with calendar rights change it", async () => {
    const cal = (await call("desk", "GET", `/calendar?month=${month(40)}&type=Deluxe`)).json().data;
    expect(cal).toMatchObject({ type: "Deluxe", base: 6000, rooms: 2, rule: { weekendPct: 0, minNights: 1 } });
    expect(cal.days.every((d: { price: number }) => d.price === 6000)).toBe(true);
    expect((await call("desk", "PUT", "/calendar/days", { type: "Deluxe", days: [day(40)], rate: 1 })).statusCode).toBe(403);
  });

  it("charges the night prices set in the calendar, with the weekend markup", async () => {
    const mon = nextWeekday(40, [1]);
    expect((await call("owner", "PUT", "/calendar/days", { type: "Deluxe", days: [day(mon)], rate: 9000 })).statusCode).toBe(200);
    expect((await call("owner", "PUT", "/calendar/rules", { type: "Deluxe", weekendPct: 20, minNights: 1 })).statusCode).toBe(200);
    const fri = nextWeekday(mon, [5]);
    const cal = (await call("owner", "GET", `/calendar?month=${month(fri)}&type=Deluxe`)).json().data;
    expect(cal.days.find((d: { day: string }) => d.day === day(fri))).toMatchObject({ price: 7200, weekend: true, override: null });
    // Monday at 9000 plus Tuesday at 6000: 7500 a night on average.
    const b = await call("owner", "POST", "/bookings", { type: "Deluxe", guest: "Price Test", from: day(mon), to: day(mon + 2) });
    expect(b.json().data).toMatchObject({ rate: 7500, amount: 15000 });
    // Back to the normal price.
    await call("owner", "PUT", "/calendar/days", { type: "Deluxe", days: [day(mon)], rate: null });
    expect((await call("owner", "GET", `/calendar?month=${month(mon)}&type=Deluxe`)).json().data.days.find((d: { day: string }) => d.day === day(mon)).override).toBeNull();
    await call("owner", "PUT", "/calendar/rules", { type: "Deluxe", weekendPct: 0, minNights: 1 });
  });

  it("refuses bookings on closed nights and shorter than the shortest stay, and shows them as not free", async () => {
    await call("owner", "PUT", "/calendar/days", { type: "Deluxe", days: [day(60)], closed: true });
    const c = await call("owner", "POST", "/bookings", { type: "Deluxe", guest: "Closed Test", from: day(59), to: day(61) });
    expect(c.statusCode).toBe(409);
    expect(c.json().message).toContain(`closed on ${day(60)}`);
    expect((await call("desk", "GET", `/availability?from=${day(60)}&to=${day(61)}`)).json().data).toEqual([expect.objectContaining({ type: "Deluxe", free: 0, closed: [day(60)] })]);
    await call("owner", "PUT", "/calendar/days", { type: "Deluxe", days: [day(60)], closed: false });
    expect((await call("owner", "POST", "/bookings", { type: "Deluxe", guest: "Open Again", from: day(60), to: day(61) })).statusCode).toBe(200);
    await call("owner", "PUT", "/calendar/rules", { type: "Deluxe", weekendPct: 0, minNights: 3 });
    const short = await call("owner", "POST", "/bookings", { type: "Deluxe", guest: "Short Stay", from: day(70), to: day(71) });
    expect(short.statusCode).toBe(400);
    expect(short.json().message).toContain("at least 3 nights");
    await call("owner", "PUT", "/calendar/rules", { type: "Deluxe", weekendPct: 0, minNights: 1 });
    expect((await call("owner", "PUT", "/calendar/days", { type: "Penthouse", days: [day(60)], closed: true })).statusCode).toBe(400);
  });
});
