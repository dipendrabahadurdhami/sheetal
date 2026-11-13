// Tests for listing check-ups on the kernel (P2-W6): the daily reviews moved from business/backend/src/modules/reviews/checkups.ts into
// apps/listings/backend. There was no old test file for these routes, so this one covers the main flow as well as the kernel rules.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: setup, decide and pick write their audit line and event together; a review writes its row and event together (the review is its own history);
// a change outside a person's access level is refused and writes nothing; another business's listings are "not found"; the 15-minute job decides older
// changes with its event; a read-only support session changes nothing. Reviews are never deleted.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { makeTestContext } from "@sheetal/platform/core/testing/context";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { CheckupService } from "@sheetal/app-listings/backend/checkup.service";
import { checkupJob } from "@sheetal/app-listings/backend";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PUT", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.biz! } });
const events = (name: string) => app.db!.eventOutbox.count({ where: { tenantId: ids.biz, name } });
const audits = (action: string) => app.db!.auditLog.count({ where: { tenantId: ids.biz, action } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, audit_logs, event_outbox, listings, listing_reviews RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other", "agent"]) {
    const u = await db.user.create({ data: { email: `${k}@kernel-chk.test`, userName: `kc-${k}`, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.biz } })).id;
  ids.listing = String((await db.listing.create({ data: { code: "ER-0001", slug: "er-1", tenantId: ids.biz!, branchId: ids.head!, purpose: "sale", category: "House", title: "House in Lalitpur", status: "published", price: 1000n } })).id);
});
afterAll(async () => { await app.close(); });

describe("listing check-ups on the kernel", () => {
  it("saves the setup with its audit line and event", async () => {
    expect((await call("owner", "PUT", "/checkups/setup", { perDay: 3 })).json().message).toBe("Check-up settings saved.");
    expect([await audits("checkups.setup"), await events("listings.checkup.setup_saved")]).toEqual([1, 1]);
    expect((await call("owner", "GET", "/checkups/setup")).json().data.setup.perDay).toBe(3);
  });

  it("gives the owner today's listing, and an 'all correct' writes the review and its event together", async () => {
    const today = (await call("owner", "GET", "/checkups/today")).json().data;
    expect(today.listings.map((l: { id: string }) => l.id)).toEqual(["ER-0001"]);
    expect((await call("owner", "POST", "/checkups/review/ER-0001", { action: "ok" })).json().message).toBe("Thanks, marked as correct.");
    expect(await app.db!.listingReview.count({ where: { tenantId: ids.biz, action: "ok" } })).toBe(1);
    expect(await events("listings.checkup.reviewed")).toBe(1);
    expect((await app.db!.listing.findUniqueOrThrow({ where: { id: Number(ids.listing) } })).checkDueAt).not.toBeNull();
  });

  it("a change outside the person's level is refused and writes nothing; another business is not found", async () => {
    const role = await app.db!.role.findFirstOrThrow({ where: { tenantId: ids.biz, key: "agent" } });
    await app.db!.membership.create({ data: { tenantId: ids.biz!, userId: ids.agent!, roleId: role.id, status: "active" } });
    const before = [await app.db!.listingReview.count(), await app.db!.eventOutbox.count(), await app.db!.auditLog.count()];
    const r = await call("agent", "POST", "/checkups/review/ER-0001", { action: "change", changes: { price: 5 } });
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toContain("You can't change: price");
    expect((await call("other", "POST", "/checkups/review/ER-0001", { action: "ok" }, ids.otherBiz)).statusCode).toBe(404);
    expect((await call("other", "POST", "/checkups/conflicts/ER-0001", { title: "Mine" }, ids.otherBiz)).statusCode).toBe(404);
    expect([await app.db!.listingReview.count(), await app.db!.eventOutbox.count(), await app.db!.auditLog.count()]).toEqual(before);
  });

  it("a change holds the listing; deciding applies it with its audit line and event", async () => {
    expect((await call("owner", "POST", "/checkups/review/ER-0001", { action: "change", changes: { title: "House in Jhamsikhel" } })).statusCode).toBe(200);
    expect((await app.db!.listing.findUniqueOrThrow({ where: { id: Number(ids.listing) } })).reviewHold).toBe(true);
    const d = await call("owner", "POST", "/checkups/decide");
    expect(d.json().data).toEqual({ applied: 1, conflicts: 0 });
    expect(await app.db!.listing.findUniqueOrThrow({ where: { id: Number(ids.listing) } })).toMatchObject({ title: "House in Jhamsikhel", reviewHold: false });
    expect([await audits("checkups.decided"), await events("listings.checkup.decided")]).toEqual([1, 1]);
  });

  it("the 15-minute job decides older changes, with its event", async () => {
    await app.db!.listingReview.create({ data: { tenantId: ids.biz!, branchId: ids.head!, listingId: Number(ids.listing), userId: ids.owner!, day: "2020-01-01", action: "change", changes: { bedrooms: 4 } } });
    await checkupJob(app).run();
    expect((await app.db!.listing.findUniqueOrThrow({ where: { id: Number(ids.listing) } })).bedrooms).toBe(4);
    expect(await events("listings.checkup.decided")).toBe(2);
  });

  it("refuses every change in a read-only support session", async () => {
    const REFUSED = { statusCode: 403, message: "This is a read-only support session. Changes are not allowed." };
    const ctx = {
      ...makeTestContext({ db: app.db!, businessId: ids.biz!, branches: [{ id: ids.head! }], userId: "support-1", isOwner: false }),
      actor: { kind: "staff" as const, staffId: "support-1", name: "Support", role: "support" },
      impersonation: { staffId: "support-1", reason: "customer asked for help", expiresAt: new Date(Date.now() + 15 * 60_000), readOnly: true },
    };
    const s = new CheckupService({ bus: app.events!.bus, mediaBase: "/media" });
    await expect(s.setup(ctx)).resolves.toMatchObject({ canManage: true });
    const before = [await app.db!.listingReview.count(), await app.db!.eventOutbox.count(), await app.db!.auditLog.count()];
    for (const [what, run] of [
      ["setup", () => s.saveSetup(ctx, { perDay: 9 })], ["review", () => s.review(ctx, "ER-0001", { action: "ok" })],
      ["decide", () => s.decideNow(ctx)], ["pick", () => s.pick(ctx, "ER-0001", { title: "x" })],
    ] as const) await expect(run(), what).rejects.toMatchObject(REFUSED);
    expect([await app.db!.listingReview.count(), await app.db!.eventOutbox.count(), await app.db!.auditLog.count()]).toEqual(before);
  });
});
