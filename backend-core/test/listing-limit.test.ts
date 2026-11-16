// The owner's rule of 16 Nov 2026 (src/domain/listing-limit.ts and billing-free.ts): a business shows on the website only as many listings
// as its Listings edition allows; the extra ones are paused, never deleted, and exactly those come back when the limit rises; a listing that
// was not on the website before is never shown by the system.
// What it proves on a database: which listings stay (featured first, then the newest); sold and rented ones and other businesses are never
// touched; the way back restores only what the system paused; a listing a person changed meanwhile is left alone; a business on plans is
// never touched; moving a business to the free tier ends every paid thing in one transaction and applies the listing rule; a dry run
// writes nothing; a payment in flight refuses.
// The suite's database is shared by every file: everything made here is removed in afterAll.
import type {} from "@sheetal/platform/test/setup-db";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { apply, migrationEnv } from "../src/domain/billing-migration.js";
import { setMode } from "../src/domain/billing-mode.js";
import { moveToFree } from "../src/domain/billing-free.js";
import { listingLimitOf, reconcileAllListingLimits, reconcileInTx, reconcileListingLimit } from "../src/domain/listing-limit.js";
import { NOW, PLANS, RENEWS } from "./migrate-plans.fixtures.js";

const db = new PrismaClient({ datasources: { db: { url: inject("databaseUrl") } } });
const ids = { pro: "lim-agency-pro", other: "lim-other", plans: "lim-on-plans", busy: "lim-busy" };
const all = Object.values(ids);
const day = (n: number) => new Date(NOW.getTime() - n * 864e5);
let seq = 0;
const listing = (tenantId: string, status: string, o: { featured?: boolean; publishedAt?: Date | null } = {}) => {
  const n = ++seq;
  return db.listing.create({ data: { tenantId, title: `Lim ${n}`, code: `LIM-${n}`, slug: `lim-${n}`, purpose: "rent", category: "flat", status: status as never, featured: !!o.featured, publishedAt: o.publishedAt === undefined ? day(n) : o.publishedAt } });
};
const statusOf = async (id?: number) => (await db.listing.findUniqueOrThrow({ where: { id: id! } })).status;
const marked = async (id?: number) => (await db.listing.findUniqueOrThrow({ where: { id: id! } })).limitPausedAt !== null;
const run = (tenantId: string, limit: number | null, now = NOW) => db.$transaction((tx) => reconcileInTx(tx, tenantId, limit, now));
const L: Record<string, number> = {};

beforeAll(async () => {
  for (const p of PLANS) await db.plan.upsert({ where: { id: p.id }, create: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort }, update: {} });
  for (const [id, name] of [[ids.pro, "Limit Realty"], [ids.other, "Limit Other"], [ids.plans, "Limit Plans"], [ids.busy, "Limit Busy"]] as const) {
    await db.tenant.create({ data: { id, name, type: "agency", planId: "agency-pro", status: "active", period: 12, renewsAt: RENEWS } });
  }
  // The Pro agency: six on the website (one featured and old), one sold, one rented, a draft, one the owner paused, one archived.
  L.newest = (await listing(ids.pro, "published", { publishedAt: day(1) })).id;
  L.second = (await listing(ids.pro, "published", { publishedAt: day(2) })).id;
  L.third = (await listing(ids.pro, "published", { publishedAt: day(3) })).id;
  L.fourth = (await listing(ids.pro, "published", { publishedAt: day(4) })).id;
  L.fifth = (await listing(ids.pro, "published", { publishedAt: day(5) })).id;
  L.featuredOld = (await listing(ids.pro, "published", { featured: true, publishedAt: day(300) })).id;
  L.sold = (await listing(ids.pro, "sold")).id;
  L.rented = (await listing(ids.pro, "rented")).id;
  L.draft = (await listing(ids.pro, "draft", { publishedAt: null })).id;
  L.ownerPaused = (await listing(ids.pro, "paused")).id;
  L.archived = (await listing(ids.pro, "archived")).id;
  for (let i = 0; i < 5; i++) L[`other${i}`] = (await listing(ids.other, "published")).id;
  for (let i = 0; i < 5; i++) L[`plans${i}`] = (await listing(ids.plans, "published")).id;
  // All four get their app rows; three move to apps (forced: the shadow days are not what this file tests); "plans" stays on plans.
  const r = await apply(db as never, await migrationEnv(db as never, { now: NOW }), { only: all });
  expect(r.ok).toBe(true);
  await setMode(db as never, { to: "apps", only: [ids.pro, ids.other, ids.busy], apply: true, force: true, now: NOW });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { tenantId: { in: all } } });
  await db.payment.deleteMany({ where: { tenantId: { in: all } } });
  await db.invoice.deleteMany({ where: { tenantId: { in: all } } });
  await db.listing.deleteMany({ where: { tenantId: { in: all } } });
  await db.tenant.deleteMany({ where: { id: { in: all } } });
  await db.billingMigrationRun.deleteMany({});
  await db.$disconnect();
});

describe("the listing rule", () => {
  it("a moved Pro agency has no listing limit; nothing is paused", async () => {
    expect(await listingLimitOf(db as never, ids.pro, NOW)).toBeNull();
    expect(await reconcileListingLimit(db as never, ids.pro, { now: NOW })).toMatchObject({ limit: null, published: 6, paused: 0, restored: 0 });
  });

  it("over the limit: the featured one and the newest stay, the rest are paused and marked; nothing else is touched", async () => {
    const r = await run(ids.pro, 3);
    expect(r).toMatchObject({ limit: 3, published: 3, paused: 3, restored: 0, stillPaused: 3 });
    expect(await Promise.all([L.featuredOld, L.newest, L.second].map(statusOf))).toEqual(["published", "published", "published"]);
    expect(await Promise.all([L.third, L.fourth, L.fifth].map(statusOf))).toEqual(["paused", "paused", "paused"]);
    expect(await Promise.all([L.third, L.fourth, L.fifth].map(marked))).toEqual([true, true, true]);
    // Sold, rented, a draft, one the owner paused, an archived one: exactly as they were, and not marked.
    expect(await Promise.all([L.sold, L.rented, L.draft, L.ownerPaused, L.archived].map(statusOf))).toEqual(["sold", "rented", "draft", "paused", "archived"]);
    expect(await marked(L.ownerPaused)).toBe(false);
    expect(await db.listing.count({ where: { tenantId: ids.other, status: "published" } })).toBe(5); // another business
    expect(await db.listing.count({ where: { tenantId: ids.pro } })).toBe(11); // nothing deleted
    expect(await db.auditLog.count({ where: { tenantId: ids.pro, action: "listings.limit_paused", target: "3" } })).toBe(1);
  });

  it("running it again changes nothing", async () => {
    expect(await run(ids.pro, 3)).toMatchObject({ paused: 0, restored: 0, published: 3, stillPaused: 3 });
    expect(await db.auditLog.count({ where: { tenantId: ids.pro, action: { startsWith: "listings.limit_" } } })).toBe(1);
  });

  it("a little more room: the newest of the paused ones comes back first, only as many as fit", async () => {
    expect(await run(ids.pro, 4)).toMatchObject({ restored: 1, published: 4, stillPaused: 2 });
    expect(await statusOf(L.third)).toBe("published");
    expect(await marked(L.third)).toBe(false);
    expect(await statusOf(L.fourth)).toBe("paused");
  });

  it("a listing a person changed meanwhile is theirs: it loses the mark and is never shown again by the system", async () => {
    await db.listing.update({ where: { id: L.fourth }, data: { status: "archived" } });
    const r = await run(ids.pro, null); // the business pays: unlimited
    expect(r).toMatchObject({ restored: 1, stillPaused: 0 });
    expect(await statusOf(L.fifth)).toBe("published");
    expect(await statusOf(L.fourth)).toBe("archived");
    expect(await marked(L.fourth)).toBe(false);
    // The inconsistency the owner ruled out: what was hidden before stays hidden.
    expect(await Promise.all([L.draft, L.ownerPaused, L.archived].map(statusOf))).toEqual(["draft", "paused", "archived"]);
    expect(await db.auditLog.count({ where: { tenantId: ids.pro, action: "listings.limit_restored" } })).toBe(2);
  });

  it("a limit of 0 (the business has no Listings app) pauses every published listing, and they all return", async () => {
    expect(await run(ids.other, 0)).toMatchObject({ paused: 5, published: 0 });
    expect(await run(ids.other, null)).toMatchObject({ restored: 5, published: 5, stillPaused: 0 });
  });

  it("a business on plans is never touched, by one call or by the hourly job", async () => {
    expect(await reconcileListingLimit(db as never, ids.plans, { now: NOW })).toBeNull();
    await reconcileAllListingLimits(db as never, { now: NOW });
    expect(await db.listing.count({ where: { tenantId: ids.plans, status: "published" } })).toBe(5);
  });
});

describe("moving a business to the free tier", () => {
  it("a dry run says what would happen and writes nothing", async () => {
    const r = await moveToFree(db as never, { tenantId: ids.pro, now: NOW });
    expect(r).toMatchObject({ ok: true, changed: false, planBefore: "agency-pro", planAfter: "agency-starter", lockRemoved: true, published: 5, listingLimit: 3, listingsPaused: 2 });
    expect(r.toFree).toContain("listings");
    expect(r.ended).toContain("mail"); // no free edition
    expect(r.grantsRevoked).toBeGreaterThan(0);
    expect(await db.subscription.count({ where: { tenantId: ids.pro, editionId: "full" } })).toBeGreaterThan(5);
    expect((await db.tenant.findUniqueOrThrow({ where: { id: ids.pro } })).planId).toBe("agency-pro");
    expect(await db.listing.count({ where: { tenantId: ids.pro, status: "published" } })).toBe(5);
  });

  it("it is refused for a business that is not on apps, and while a payment is in flight", async () => {
    expect(await moveToFree(db as never, { tenantId: ids.plans, apply: true, now: NOW })).toMatchObject({ ok: false, reason: expect.stringMatching(/move it to apps first/) });
    expect(await moveToFree(db as never, { tenantId: "no-such", apply: true, now: NOW })).toMatchObject({ ok: false, reason: "no such business" });
    const inv = await db.invoice.create({ data: { tenantId: ids.busy, months: 1, subtotal: 1327, vat: 173, total: 1500, status: "open", kind: "subscription", dueAt: RENEWS } });
    await db.payment.create({ data: { invoiceId: inv.id, tenantId: ids.busy, provider: "esewa", amount: 1500, status: "initiated", ref: "lim-ref-1" } });
    expect(await moveToFree(db as never, { tenantId: ids.busy, apply: true, force: true, now: NOW })).toMatchObject({ ok: false, changed: false, reason: expect.stringMatching(/in flight/) });
    expect(await db.subscription.count({ where: { tenantId: ids.busy, editionId: "full" } })).toBeGreaterThan(5);
  });

  it("apply: every app on its free edition, Mail ended, grants and lock gone, Starter plan, one audit row, and the website keeps 3 listings", async () => {
    const r = await moveToFree(db as never, { tenantId: ids.pro, apply: true, now: NOW, by: "test" });
    expect(r).toMatchObject({ ok: true, changed: true, listingLimit: 3, listingsPaused: 2 });
    const subs = await db.subscription.findMany({ where: { tenantId: ids.pro } });
    expect(subs.filter((s) => s.appId !== "mail").every((s) => s.editionId === "free" && s.status === "active" && s.periodMonths === null && s.currentPeriodEnd === null && s.priceGrossPaisa === 0n)).toBe(true);
    expect(subs.find((s) => s.appId === "mail")).toMatchObject({ status: "expired" });
    expect(await db.entitlementGrant.count({ where: { tenantId: ids.pro, revokedAt: null } })).toBe(0);
    expect(await db.billingLock.count({ where: { tenantId: ids.pro } })).toBe(0);
    expect(await db.tenant.findUniqueOrThrow({ where: { id: ids.pro } })).toMatchObject({ planId: "agency-starter", renewsAt: null, billingMode: "apps", status: "active" });
    expect(await db.subscriptionEvent.count({ where: { tenantId: ids.pro, type: "moved_to_free", actorKind: "staff" } })).toBe(r.toFree.length + r.ended.length);
    const audit = await db.auditLog.findFirstOrThrow({ where: { tenantId: ids.pro, action: "billing.moved_to_free" } });
    expect((audit.meta as { planBefore: string; lock: object | null; subscriptions: unknown[] })).toMatchObject({ planBefore: "agency-pro", lock: expect.any(Object) });
    // The listings: the free edition's 3 stay (the featured one and the two newest), 2 are paused and marked, nothing is deleted.
    expect(await listingLimitOf(db as never, ids.pro, NOW)).toBe(3);
    expect(await Promise.all([L.featuredOld, L.newest, L.second].map(statusOf))).toEqual(["published", "published", "published"]);
    expect(await db.listing.count({ where: { tenantId: ids.pro, status: "paused", limitPausedAt: { not: null } } })).toBe(2);
    expect(await db.listing.count({ where: { tenantId: ids.pro } })).toBe(11);
    expect(await moveToFree(db as never, { tenantId: ids.pro, apply: true, now: NOW })).toMatchObject({ ok: true, changed: false, reason: "already on the free tier" });
  });

  it("when the business pays for Listings again, exactly the paused ones return", async () => {
    // What a paid checkout leaves behind: the Listings subscription on the full edition for a year (500 listings).
    await db.subscription.updateMany({ where: { tenantId: ids.pro, appId: "listings" }, data: { editionId: "full", status: "active", periodMonths: 12, currentPeriodStart: NOW, currentPeriodEnd: new Date(NOW.getTime() + 365 * 864e5), source: "purchase" } });
    const r = await reconcileListingLimit(db as never, ids.pro, { now: NOW });
    expect(r).toMatchObject({ limit: 500, restored: 2, published: 5, stillPaused: 0 });
    expect(await Promise.all([L.draft, L.ownerPaused, L.archived, L.fourth].map(statusOf))).toEqual(["draft", "paused", "archived", "archived"]);
  });
});
