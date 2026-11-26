// P3-OPS-1: the cutover switch (src/domain/billing-mode.ts). Billing modes plans -> shadow -> apps and back (MB section 8.6).
// What it proves: the rules of checkMove one by one (pure), and on a database: the list, a dry run that writes nothing, shadow needs the
// migration rows, apps needs shadow + days + zero "less" differences (recorded or now), apps voids ONLY the open plan and add-on invoices of
// that business (R10) in the same transaction as the mode and the audit row, a payment in flight refuses and can't be forced, going back is
// refused after a sale on the new system, another business is never touched.
// The suite's database is shared by every file: everything made here is removed in afterAll.
import type {} from "@sheetal/platform/test/setup-db";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { apply, migrationEnv } from "../src/domain/billing-migration.js";
import { MODE_CHANGED, checkMove, compareNow, modeStatus, setMode, type ModeRow } from "../src/domain/billing-mode.js";
import { NOW, PLANS, RENEWS } from "./migrate-plans.fixtures.js";

const DAY = 864e5;
const row = (over: Partial<ModeRow> = {}): ModeRow => ({
  id: "b1", masked: "Te… (b1)", mode: "plans", status: "active", migrated: true, gifted: false, shadowSince: null, lessReports: 0, reports: 0, lessNow: [],
  openInvoices: [], paymentsInFlight: 0, sold: false, ...over,
});
const rules = { now: NOW, minShadowDays: 7 };
const onShadow = (days: number, over: Partial<ModeRow> = {}) => row({ mode: "shadow", shadowSince: new Date(NOW.getTime() - days * DAY), ...over });

describe("checkMove: the rules", () => {
  it("a business already on the target mode is 'same'", () => {
    expect(checkMove(row(), "plans", rules)).toBe("same");
    expect(checkMove(onShadow(1), "shadow", rules)).toBe("same");
  });
  it("shadow and apps need the migration rows; shadow is open to a migrated business on plans", () => {
    expect(checkMove(row({ migrated: false }), "shadow", rules)).toMatch(/app rows/);
    expect(checkMove(row({ migrated: false }), "apps", { ...rules, force: true })).toMatch(/app rows/);
    // A business the migration skipped, that staff gave every app as a live gift, may move (forced past shadow): it keeps every app.
    expect(checkMove(row({ migrated: false, gifted: true }), "apps", { ...rules, force: true })).toBeNull();
    expect(checkMove(row({ migrated: false, gifted: true }), "apps", rules)).toMatch(/shadow first/);
    expect(checkMove(row(), "shadow", rules)).toBeNull();
  });
  it("apps needs shadow first, the days, and no 'less' difference recorded or now", () => {
    expect(checkMove(row(), "apps", rules)).toMatch(/shadow first/);
    expect(checkMove(onShadow(6), "apps", rules)).toMatch(/6 day\(s\); it needs 7/);
    expect(checkMove(onShadow(7), "apps", rules)).toBeNull();
    expect(checkMove(onShadow(0), "apps", { ...rules, minShadowDays: 0 })).toBeNull(); // the pilot
    expect(checkMove(onShadow(9, { lessReports: 2 }), "apps", rules)).toMatch(/2 recorded difference/);
    expect(checkMove(onShadow(9, { lessNow: ["limit rooms -> hotel.rooms (10 -> 5)"] }), "apps", rules)).toMatch(/less than the plan today/);
  });
  it("force skips the shadow rules, never the payment in flight", () => {
    expect(checkMove(row(), "apps", { ...rules, force: true })).toBeNull();
    expect(checkMove(onShadow(9, { lessReports: 1 }), "apps", { ...rules, force: true })).toBeNull();
    expect(checkMove(onShadow(9, { paymentsInFlight: 1 }), "apps", { ...rules, force: true })).toMatch(/in flight/);
  });
  it("going back: shadow -> plans always; apps -> plans only before a sale (never forced); apps -> shadow never", () => {
    expect(checkMove(onShadow(3), "plans", rules)).toBeNull();
    expect(checkMove(row({ mode: "apps" }), "plans", rules)).toBeNull();
    expect(checkMove(row({ mode: "apps", sold: true }), "plans", { ...rules, force: true })).toMatch(/stays on apps/);
    expect(checkMove(row({ mode: "apps" }), "shadow", rules)).toMatch(/back to plans first/);
  });
});

// ───────────── the database side ─────────────

const db = new PrismaClient({ datasources: { db: { url: inject("databaseUrl") } } });
const ids = { agency: "mode-agency-biz", hotel: "mode-hotel-starter", busy: "mode-in-flight", never: "mode-not-migrated", other: "mode-other" };
const all = Object.values(ids);
const modeOf = async (id: string) => (await db.tenant.findUniqueOrThrow({ where: { id } })).billingMode;
const invoice = (tenantId: string, kind: string, status: string) =>
  db.invoice.create({ data: { tenantId, planId: kind === "plan" || kind === "addon" ? "agency-business" : null, months: 1, subtotal: 1327, vat: 173, total: 1500, status, kind, dueAt: RENEWS, paidAt: status === "paid" ? NOW : null } });
let inv: Record<"openPlan" | "openAddon" | "openBoost" | "paid" | "otherOpen" | "busyOpen", string>;

beforeAll(async () => {
  for (const p of PLANS) await db.plan.upsert({ where: { id: p.id }, create: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort }, update: {} });
  await db.tenant.create({ data: { id: ids.agency, name: "Mode Realty", type: "agency", planId: "agency-business", status: "active", period: 1, renewsAt: RENEWS } });
  await db.tenant.create({ data: { id: ids.hotel, name: "Mode Hotel", type: "hotel", planId: "hotel-starter", status: "active" } });
  await db.tenant.create({ data: { id: ids.busy, name: "Mode Busy", type: "agency", planId: "agency-business", status: "active", period: 1, renewsAt: RENEWS } });
  await db.tenant.create({ data: { id: ids.never, name: "Mode Never", type: "agency", planId: "agency-starter", status: "active" } });
  await db.tenant.create({ data: { id: ids.other, name: "Mode Other", type: "agency", planId: "agency-business", status: "active", period: 1, renewsAt: RENEWS } });
  inv = {
    openPlan: (await invoice(ids.agency, "plan", "open")).id, openAddon: (await invoice(ids.agency, "addon", "open")).id,
    openBoost: (await invoice(ids.agency, "boost", "open")).id, paid: (await invoice(ids.agency, "plan", "paid")).id,
    otherOpen: (await invoice(ids.other, "plan", "open")).id, busyOpen: "",
  };
  // The migration writes the app rows of four of them (not "never"); every one stays on plans.
  const r = await apply(db as never, await migrationEnv(db as never, { now: NOW }), { only: [ids.agency, ids.hotel, ids.busy, ids.other] });
  expect(r.ok).toBe(true);
  // A payment that starts after the migration (the migration itself skips a business with one).
  inv.busyOpen = (await invoice(ids.busy, "plan", "open")).id;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { tenantId: { in: all } } });
  await db.payment.deleteMany({ where: { tenantId: { in: all } } });
  await db.invoice.deleteMany({ where: { tenantId: { in: all } } });
  await db.tenant.deleteMany({ where: { id: { in: all } } }); // subscriptions, grants, add-ons and locks go with them
  await db.billingMigrationRun.deleteMany({});
  await db.$disconnect();
});

describe("the switch on a database", () => {
  it("the list shows the mode, the app rows, the open plan invoices and no 'less' difference for a moved business", async () => {
    const rows = await modeStatus(db as never, { only: all, now: NOW });
    const agency = rows.find((r) => r.id === ids.agency)!;
    expect(agency).toMatchObject({ mode: "plans", migrated: true, shadowSince: null, lessNow: [], sold: false, paymentsInFlight: 0 });
    expect(agency.openInvoices.sort()).toEqual([inv.openPlan, inv.openAddon].sort()); // never the boost invoice
    expect(agency.masked).not.toMatch(/Mode Realty/);
    expect(rows.find((r) => r.id === ids.never)).toMatchObject({ mode: "plans", migrated: false });
    expect((await compareNow(db as never, ids.agency, NOW)).filter((d) => d.kind === "less")).toEqual([]);
  });

  it("a dry run says what would happen and writes nothing", async () => {
    const res = await setMode(db as never, { to: "shadow", only: [ids.agency, ids.never, "no-such-business"], now: NOW });
    expect(res.find((r) => r.id === ids.agency)).toMatchObject({ ok: true, changed: false, from: "plans", to: "shadow" });
    expect(res.find((r) => r.id === ids.never)).toMatchObject({ ok: false, reason: expect.stringMatching(/app rows/) });
    expect(res.find((r) => r.id === "no-such-business")).toMatchObject({ ok: false, reason: "no such business" });
    // "all" = every business with app rows (and nobody else); still nothing written.
    const everyone = await setMode(db as never, { to: "shadow", all: true, now: NOW });
    expect(everyone.map((r) => r.id)).toEqual(expect.arrayContaining([ids.agency, ids.hotel, ids.busy, ids.other]));
    expect(everyone.some((r) => r.id === ids.never)).toBe(false);
    expect(await modeOf(ids.agency)).toBe("plans");
    expect(await db.auditLog.count({ where: { tenantId: { in: all }, action: MODE_CHANGED } })).toBe(0);
  });

  it("it must be told which businesses", async () => {
    await expect(setMode(db as never, { to: "shadow", apply: true })).rejects.toThrow(/Name the businesses/);
  });

  it("shadow: moves every named business with app rows, writes one audit row each, and leaves the others and every invoice alone", async () => {
    const res = await setMode(db as never, { to: "shadow", only: all, apply: true, now: NOW });
    expect(res.filter((r) => r.changed).map((r) => r.id).sort()).toEqual([ids.agency, ids.hotel, ids.busy, ids.other].sort());
    expect(await modeOf(ids.never)).toBe("plans");
    expect(await db.auditLog.count({ where: { tenantId: ids.agency, action: MODE_CHANGED, target: "plans -> shadow" } })).toBe(1);
    expect(await db.invoice.count({ where: { tenantId: ids.agency, status: "open" } })).toBe(3);
    const again = await setMode(db as never, { to: "shadow", only: [ids.agency], apply: true, now: NOW });
    expect(again[0]).toMatchObject({ ok: true, changed: false, reason: "already on shadow" });
    expect(await db.auditLog.count({ where: { tenantId: ids.agency, action: MODE_CHANGED } })).toBe(1);
  });

  it("apps is refused before the 7 days, and after a recorded 'less' difference", async () => {
    const early = await setMode(db as never, { to: "apps", only: [ids.agency], apply: true, now: new Date(NOW.getTime() + 3 * DAY) });
    expect(early[0]).toMatchObject({ ok: false, changed: false, reason: expect.stringMatching(/3 day\(s\); it needs 7/) });
    expect(await modeOf(ids.agency)).toBe("shadow");
    // A report with only "more" differences does not block; one with a "less" does.
    await db.auditLog.create({ data: { tenantId: ids.hotel, action: "billing.shadow_diff", target: "0 less, 2 more", createdAt: new Date(NOW.getTime() + DAY) } });
    await db.auditLog.create({ data: { tenantId: ids.other, action: "billing.shadow_diff", target: "1 less, 0 more", createdAt: new Date(NOW.getTime() + DAY) } });
    const late = await setMode(db as never, { to: "apps", only: [ids.hotel, ids.other], now: new Date(NOW.getTime() + 8 * DAY) });
    expect(late.find((r) => r.id === ids.hotel)).toMatchObject({ ok: true });
    expect(late.find((r) => r.id === ids.other)).toMatchObject({ ok: false, reason: expect.stringMatching(/1 recorded difference/) });
  });

  it("apps (the pilot, --min-days=0): the mode, the open plan and add-on invoices voided and the audit row, in one go; nothing else", async () => {
    const res = await setMode(db as never, { to: "apps", only: [ids.agency], apply: true, minShadowDays: 0, now: NOW });
    expect(res[0]).toMatchObject({ ok: true, changed: true, from: "shadow", to: "apps" });
    expect(res[0]!.voided.sort()).toEqual([inv.openPlan, inv.openAddon].sort());
    expect(await modeOf(ids.agency)).toBe("apps");
    const status = async (id: string) => (await db.invoice.findUniqueOrThrow({ where: { id } })).status;
    expect([await status(inv.openPlan), await status(inv.openAddon)]).toEqual(["void", "void"]);
    expect([await status(inv.openBoost), await status(inv.paid), await status(inv.otherOpen)]).toEqual(["open", "paid", "open"]); // R10
    const audit = await db.auditLog.findFirstOrThrow({ where: { tenantId: ids.agency, action: MODE_CHANGED, target: "shadow -> apps" } });
    expect((audit.meta as { voidedInvoices: string[] }).voidedInvoices.sort()).toEqual([inv.openPlan, inv.openAddon].sort());
    expect(await modeOf(ids.other)).toBe("shadow");
  });

  it("a plan payment in flight refuses apps, even forced, and nothing of that business changes", async () => {
    await db.payment.create({ data: { invoiceId: inv.busyOpen, tenantId: ids.busy, provider: "esewa", amount: 1500, status: "pending_review", ref: "mode-ref-1" } });
    const res = await setMode(db as never, { to: "apps", only: [ids.busy], apply: true, force: true, now: NOW });
    expect(res[0]).toMatchObject({ ok: false, changed: false, reason: expect.stringMatching(/in flight/) });
    expect(await modeOf(ids.busy)).toBe("shadow");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.busyOpen } })).status).toBe("open");
  });

  it("going back: apps -> plans before any sale; refused (even forced) once the business installed an app itself", async () => {
    const back = await setMode(db as never, { to: "plans", only: [ids.agency], apply: true, now: NOW });
    expect(back[0]).toMatchObject({ ok: true, changed: true, from: "apps", to: "plans" });
    expect(await modeOf(ids.agency)).toBe("plans");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.openPlan } })).status).toBe("void"); // a voided invoice stays void
    // Forward again (forced: it is on plans), then the business installs an app on the new system.
    await setMode(db as never, { to: "apps", only: [ids.agency], apply: true, force: true, now: NOW });
    await db.subscription.create({ data: { id: "mode-own-sub", tenantId: ids.agency, appId: "restaurant", editionId: "free", status: "active", source: "install", installedAt: NOW } });
    const refused = await setMode(db as never, { to: "plans", only: [ids.agency], apply: true, force: true, now: NOW });
    expect(refused[0]).toMatchObject({ ok: false, changed: false, reason: expect.stringMatching(/stays on apps/) });
    expect(await modeOf(ids.agency)).toBe("apps");
    const shadow = await setMode(db as never, { to: "shadow", only: [ids.agency], apply: true, now: NOW });
    expect(shadow[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/back to plans first/) });
  });
});
