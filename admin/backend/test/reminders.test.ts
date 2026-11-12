import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { planReminders, runReminders, REMINDER_DEFAULTS } from "@sheetal/backend-core/domain/reminders";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

// 7 Nov 2026, 11:45 in Nepal. Every date below is worked out from this day.
const NOW = new Date("2026-11-07T06:00:00Z");
const at = (iso: string) => new Date(`${iso}T06:00:00Z`);
let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body?: object) => app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}` } });
const run = () => runReminders(app.db!, app.mailer, { siteUrl: "https://sheetal.test", now: NOW });
const mails = () => app.db!.outboundEmail.findMany({ where: { to: "owner@sheetal.test" }, orderBy: { createdAt: "asc" } });
const stale = (id: number, days: number) => app.db!.$executeRaw`UPDATE listings SET updated_at = ${new Date(NOW.getTime() - days * 864e5)} WHERE id = ${id}`;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "admin"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, audit_logs, reminder_logs, boosts, banners RESTART IDENTITY CASCADE`);
  await db.outboundEmail.deleteMany(); await db.notification.deleteMany(); await db.listing.deleteMany();
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, role] of [["boss", "super_admin"], ["ops", "operations"], ["owner", null]] as const) {
    const u = await db.user.create({ data: { email: `${k}@sheetal.test`, userName: k, platformRole: role, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.tenant = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Lakeside Hotel", type: "hotel", planId: "hotel-business" }))).id;
});
afterAll(async () => { await app.close(); });

describe("plan renewal reminders", () => {
  it("send the 3-day reminder once, to the owner, as a bell and an email", async () => {
    await app.db!.tenant.update({ where: { id: ids.tenant }, data: { status: "active", autoRenew: false, renewsAt: at("2026-11-10") } });
    const plan = await planReminders(app.db!, NOW);
    expect(plan.map((p) => [p.kind, p.sendOn])).toEqual([["plan_renewal_3", "2026-11-07"]]); // 7 and 1 are the billing cycle's days
    expect(await run()).toEqual({ plan: 1, listings: 0, boosts: 0, banners: 0 });
    const m = await mails();
    expect(m).toHaveLength(1);
    expect(m[0]!.subject).toBe("Lakeside Hotel: Business renews in 3 days");
    expect(m[0]!.text).toContain("will not renew by itself");
    expect(m[0]!.text).toContain("https://sheetal.test/business/billing");
    expect(await app.db!.notification.count({ where: { userId: ids.owner, type: "reminder" } })).toBe(1);
    expect(await app.db!.reminderLog.findMany()).toEqual([expect.objectContaining({ kind: "plan_renewal_3", refId: `${ids.tenant}:2026-11-10`, day: "2026-11-07" })]);
    expect(await run()).toEqual({ plan: 0, listings: 0, boosts: 0, banners: 0 }); // nothing twice
    expect(await mails()).toHaveLength(1);
  });

  it("skip businesses on auto-pay, past due, or on the days billing already covers", async () => {
    const db = app.db!;
    await db.reminderLog.deleteMany();
    await db.tenant.update({ where: { id: ids.tenant }, data: { autoRenew: true } });
    expect(await planReminders(db, NOW)).toEqual([]);
    await db.tenant.update({ where: { id: ids.tenant }, data: { autoRenew: false, status: "past_due" } });
    expect(await planReminders(db, NOW)).toEqual([]);
    await db.tenant.update({ where: { id: ids.tenant }, data: { status: "active", renewsAt: at("2026-11-08") } }); // 1 day left: billing's day
    expect(await planReminders(db, NOW)).toEqual([]);
    await db.tenant.update({ where: { id: ids.tenant }, data: { renewsAt: at("2026-11-17") } }); // 10 days left
    expect(await planReminders(db, NOW)).toEqual([expect.objectContaining({ kind: "plan_renewal_3", sendOn: "2026-11-14" })]); // listed for next week, not sent yet
    expect((await planReminders(db, NOW, 0))).toEqual([]);
    expect(REMINDER_DEFAULTS.plan.days).toEqual([7, 3, 1]);
  });
});

describe("listings nobody has updated", () => {
  it("send one message per business listing the stale ones, and never again until they change", async () => {
    const db = app.db!;
    const mk = (n: number) => db.listing.create({ data: { code: `SP-91${n}`, slug: `sp-91${n}`, purpose: "rent", category: "Hotel", title: `Room ${n}`, kind: "stay_hotel", tenantId: ids.tenant!, status: "published" } });
    const [a, b, fresh] = [await mk(1), await mk(2), await mk(3)];
    await stale(a.id, 95); await stale(b.id, 120); await stale(fresh.id, 10);
    const before = (await mails()).length;
    expect((await run()).listings).toBe(2);
    const m = (await mails()).slice(before);
    expect(m).toHaveLength(1); // one email for the business
    expect(m[0]!.subject).toBe("2 listing(s) need a look");
    expect(m[0]!.text).toContain("• Room 1");
    expect(m[0]!.text).toContain("• Room 2");
    expect(m[0]!.text).not.toContain("Room 3");
    expect(m[0]!.text).toContain("haven't been updated for 90 days");
    expect(await app.db!.reminderLog.count({ where: { kind: "listing_stale" } })).toBe(2);
    expect((await run()).listings).toBe(0);
    // A listing that is edited and later gets stale again is a new reminder.
    await stale(a.id, 100);
    expect((await run()).listings).toBe(1);
  });

  it("follow the days staff set, and can be switched off", async () => {
    expect((await call("boss", "PUT", "/admin/reminders", { listings: { staleDays: 400 } })).statusCode).toBe(200);
    expect((await planReminders(app.db!, NOW)).filter((p) => p.kind === "listing_stale")).toEqual([]);
    await call("boss", "PUT", "/admin/reminders", { listings: { staleDays: 90, on: false } });
    expect((await run()).listings).toBe(0);
    await call("boss", "PUT", "/admin/reminders", { listings: { on: true } });
  });
});

describe("boosts and banners ending tomorrow", () => {
  it("remind the day before, once", async () => {
    const db = app.db!;
    const listing = await db.listing.findFirstOrThrow();
    const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
    await db.boost.create({ data: { tenantId: ids.tenant!, listingId: listing.id, place: "home", days: 5, startOn: day("2026-11-04"), endOn: day("2026-11-08"), status: "paid" } });
    await db.boost.create({ data: { tenantId: ids.tenant!, listingId: listing.id, place: "search", days: 5, startOn: day("2026-11-04"), endOn: day("2026-11-12"), status: "paid" } }); // later
    await db.boost.create({ data: { tenantId: ids.tenant!, listingId: listing.id, place: "city", days: 5, startOn: day("2026-11-01"), endOn: day("2026-11-08"), status: "stopped" } }); // stopped
    await db.banner.create({ data: { tenantId: ids.tenant!, desktop: "d.jpg", mobile: "m.jpg", link: "https://x.test", title: "Lake view", days: 7, startOn: day("2026-11-02"), endOn: day("2026-11-08"), status: "approved" } });
    const upcoming = (await planReminders(db, NOW)).filter((p) => p.kind.endsWith("_ending")).map((p) => [p.kind, p.sendOn]);
    expect(upcoming).toEqual([["boost_ending", "2026-11-07"], ["banner_ending", "2026-11-07"], ["boost_ending", "2026-11-11"]]);
    const before = (await mails()).length;
    expect(await run()).toMatchObject({ boosts: 1, banners: 1 });
    const m = (await mails()).slice(before).map((x) => x.subject).sort();
    expect(m).toEqual(["Your banner ends tomorrow", "Your boost ends tomorrow"]);
    expect(await run()).toMatchObject({ boosts: 0, banners: 0 });
  });
});

describe("Admin → Messages → Expiry", () => {
  it("shows settings, what is coming and what went out, to settings staff only", async () => {
    expect((await call("ops", "GET", "/admin/reminders")).statusCode).toBe(403);
    const d = (await call("boss", "GET", "/admin/reminders")).json().data;
    expect(d.settings).toEqual(REMINDER_DEFAULTS);
    expect(Array.isArray(d.upcoming)).toBe(true);
    expect(d.recent.length).toBeGreaterThan(0);
    expect(d.recent[0]).toMatchObject({ business: "Lakeside Hotel" });
  });

  it("checks settings and audits changes", async () => {
    for (const bad of [{ plan: { days: [] } }, { plan: { days: [1, 2, 3, 4, 5, 6] } }, { plan: { days: [0] } }, { listings: { staleDays: 5 } }, { boosts: { on: "yes" } }, { other: 1 }]) expect((await call("boss", "PUT", "/admin/reminders", bad)).statusCode, JSON.stringify(bad)).toBe(422);
    expect((await call("ops", "PUT", "/admin/reminders", { boosts: { on: false } })).statusCode).toBe(403);
    expect((await call("boss", "PUT", "/admin/reminders", { plan: { days: [2, 5] }, banners: { on: false } })).json().data.plan.days).toEqual([5, 2]);
    const t = (await app.db!.auditLog.findMany({ where: { action: "reminders.settings" } })).map((a) => a.target);
    expect(t).toContain("plan.days: 7,3,1 → 5,2");
    expect(t).toContain("banners.on: true → false");
    expect((await call("boss", "PUT", "/admin/reminders", { plan: { days: [5, 2] } })).json().message).toBe("Nothing changed.");
  });

  it("can send today's reminders now", async () => {
    expect((await call("ops", "POST", "/admin/reminders/run")).statusCode).toBe(403);
    const r = await call("boss", "POST", "/admin/reminders/run");
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual({ plan: expect.any(Number), listings: expect.any(Number), boosts: expect.any(Number), banners: expect.any(Number) });
    expect((await app.db!.auditLog.findMany({ where: { action: "reminders.run" } })).length).toBe(1);
  });
});
