// Tests for Reviews on the kernel (P1-BE-6): what the move to apps/reviews/backend added. The old review test (branches.test.ts) and the website write test are NOT repeated here.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by backend-core/test/setup-db.ts): npm run test -w @sheetal/business-api
// How it works: a real business API with a few people in "Everest Realty" (owner, a Pokhara-only reader, roles with the old and the new permission names) and one more
// business; calls go through HTTP (app.inject), the database is read straight afterwards to check what was really written.
// Rules: covers isolation (other business, other branch), unpublished and deleted reviews, the reply audit/event/notification, the old and new permission names, the
// read-only support session, a stale version (409) and the event rolling back with the reply. Counts of shared tables (audit_logs, event_outbox, notifications) are
// always filtered by this test's own ids.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { createDb } from "@sheetal/platform/db/client";
import type { EventBus } from "@sheetal/platform/core/events";
import { makeTestContext } from "@sheetal/platform/core/testing/context";
import { ReviewRepository } from "@sheetal/app-reviews/backend/review.repository";
import { ReviewService } from "@sheetal/app-reviews/backend/review.service";
import { teamWith } from "@sheetal/platform/notify/index";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const rv: Record<string, string> = {};   // review ids by letter
const call = (who: string, method: "GET" | "POST", url: string, body?: object, o: { tenant?: string } = {}) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": o.tenant ?? ids.agency! } });
const list = async (who: string, query = "") => {
  const res = await call(who, "GET", `/reviews${query}`);
  return { res, comments: (res.json().data ?? []).map((r: { comment: string }) => r.comment) as string[], body: res.json() };
};
const reply = (who: string, key: string, text: string, extra: object = {}) => call(who, "POST", `/reviews/${rv[key]}/reply`, { text, ...extra });
const row = (key: string) => app.db!.review.findUniqueOrThrow({ where: { id: rv[key]! } });
const audits = (key: string) => app.db!.auditLog.findMany({ where: { tenantId: ids.agency, target: rv[key]!, action: { startsWith: "review." } }, orderBy: { createdAt: "asc" } });
const events = async (key: string) =>
  (await app.db!.eventOutbox.findMany({ where: { tenantId: ids.agency, name: "reviews.review.replied" }, orderBy: { createdAt: "asc" } }))
    .filter((e) => (e.payload as { reviewId?: string }).reviewId === rv[key]);
const notes = (userId: string) => app.db!.notification.findMany({ where: { userId, type: "review_reply" } });

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, app_settings, notifications, outbound_emails, audit_logs, event_outbox, reviews, listings RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other", "newread", "newreply", "oldview", "oldreply", "pokhara", "nobody", "r1", "r2", "r3", "r4"]) {
    const u = await db.user.create({ data: { email: `${k}@reviews.test`, userName: k, emailVerifiedAt: new Date() } });
    ids[k] = u.id;
    tok[k] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
  }
  ids.agency = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.second = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.agency, name: "Head office" } })).id;
  ids.otherHead = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.second, name: "Head office" } })).id;
  ids.pk = (await db.branch.create({ data: { tenantId: ids.agency!, name: "Pokhara" } })).id;
  const custom = async (key: string, perms: string[]) => (await db.role.create({ data: { tenantId: ids.agency!, key, name: key, system: false, perms } })).id;
  const join = (userId: string, roleId: string, extra: object = {}) => db.membership.create({ data: { tenantId: ids.agency!, userId, roleId, status: "active", ...extra } });
  await join(ids.newread!, await custom("rv_new_read", ["reviews.review.read:branch"]));                                      // new names
  await join(ids.newreply!, await custom("rv_new_reply", ["reviews.review.reply:branch"]));
  await join(ids.oldview!, await custom("rv_old_view", ["customers.view"]));                                                  // old names
  await join(ids.oldreply!, await custom("rv_old_reply", ["reviews.reply"]));
  await join(ids.pokhara!, await custom("rv_pokhara", ["reviews.review.read:branch", "reviews.review.reply:branch"]), { scopes: ["Pokhara"] });
  await join(ids.nobody!, await custom("rv_nobody", ["expenses.expense.read:branch"]));                                       // no review permission

  const listing = (n: number, tenantId: string, branchId: string, title: string) =>
    db.listing.create({ data: { code: `RV-${n}`, slug: `rv-${n}`, tenantId, branchId, purpose: "sale", category: "House", title } });
  const headFlat = await listing(1, ids.agency!, ids.head!, "Head flat");
  const pkHouse = await listing(2, ids.agency!, ids.pk!, "Pokhara lake house");
  const theirs = await listing(3, ids.second!, ids.otherHead!, "Their house");
  // Reviews are written the way the website writes them: no version, no createdBy (the table's defaults).
  const make = async (key: string, data: { userId: string; tenantId?: string; listingId?: number; rating: number; comment: string; status?: string; deletedAt?: Date }) => {
    rv[key] = (await db.review.create({ data })).id;
  };
  await make("A", { userId: ids.r1!, tenantId: ids.agency!, rating: 5, comment: "Great agency" });                // the business itself
  await make("B", { userId: ids.r1!, listingId: headFlat.id, rating: 4, comment: "Nice flat" });                   // Head office listing
  await make("C", { userId: ids.r1!, listingId: pkHouse.id, rating: 2, comment: "Lake view but old photos" });     // Pokhara listing
  await make("D", { userId: ids.r2!, listingId: headFlat.id, rating: 1, comment: "Hidden by Sheetal", status: "hidden" });
  await make("E", { userId: ids.r3!, listingId: headFlat.id, rating: 3, comment: "Deleted for good", deletedAt: new Date() });
  await make("F", { userId: ids.r1!, tenantId: ids.second!, rating: 5, comment: "Other business" });
  await make("G", { userId: ids.r4!, listingId: theirs.id, rating: 4, comment: "Other listing" });
});
afterAll(async () => { await app.close(); });

describe("what a person sees", () => {
  it("shows the business's own published reviews and its listings' reviews, and nothing of another business", async () => {
    const { res, comments, body } = await list("owner");
    expect(res.statusCode).toBe(200);
    expect(new Set(comments)).toEqual(new Set(["Great agency", "Nice flat", "Lake view but old photos"]));
    expect(body.meta).toMatchObject({ count: 3, unanswered: 3, canReply: true });
    expect(body.data[0]).toHaveProperty("version");
  });

  it("does not show an unpublished (hidden) or a deleted review, and cannot reply to one", async () => {
    expect((await list("owner")).comments).not.toContain("Hidden by Sheetal");
    expect((await list("owner")).comments).not.toContain("Deleted for good");
    for (const k of ["D", "E"]) {
      const res = await reply("owner", k, "hello");
      expect(res.statusCode).toBe(404);
      expect(res.json().message).toBe("Review not found.");
      expect((await row(k)).reply).toBeNull();
    }
  });

  it("does not find, or reply to, another business's review", async () => {
    for (const k of ["F", "G"]) {
      expect((await reply("owner", k, "hello")).statusCode).toBe(404);
      expect((await row(k)).reply).toBeNull();
    }
    // …and the owner of the other business sees only its own two.
    const res = await call("other", "GET", "/reviews", undefined, { tenant: ids.second });
    expect((res.json().data as { comment: string }[]).map((r) => r.comment).sort()).toEqual(["Other business", "Other listing"]);
  });

  it("shows a person limited to Pokhara the business's reviews and Pokhara's listings only", async () => {
    const { comments } = await list("pokhara");
    expect(new Set(comments)).toEqual(new Set(["Great agency", "Lake view but old photos"]));
    const res = await reply("pokhara", "B", "hello");   // a Head office listing's review
    expect(res.statusCode).toBe(404);
    expect((await row("B")).reply).toBeNull();
  });

  it("filters: unanswered and low", async () => {
    expect((await list("owner", "?show=low")).comments).toEqual(["Lake view but old photos"]);
    expect((await list("owner", "?show=unanswered")).comments).toHaveLength(3);
    expect((await call("owner", "GET", "/reviews?show=nonsense")).statusCode).toBe(422);
  });
});

describe("the repository", () => {
  const db = createDb(inject("databaseUrl"))!;
  it("answers 'not found' for a review of another business, for a hidden one and for a deleted one", async () => {
    const repo = new ReviewRepository();
    const ctx = makeTestContext({ db, businessId: ids.agency!, branches: [{ id: ids.head! }, { id: ids.pk! }], userId: ids.owner! });
    expect((await repo.get(ctx, rv.A!, "all")).comment).toBe("Great agency");
    for (const k of ["D", "E", "F", "G"]) await expect(repo.get(ctx, rv[k]!, "all")).rejects.toMatchObject({ statusCode: 404, message: "Review not found." });
    // A person who works only at Pokhara: scope "branch" follows the picked branch.
    const pk = makeTestContext({ db, businessId: ids.agency!, branches: [{ id: ids.head! }, { id: ids.pk! }], allowed: [ids.pk!], userId: ids.owner! });
    await expect(repo.get(pk, rv.B!, "branch")).rejects.toMatchObject({ statusCode: 404 });
    expect((await repo.get(pk, rv.C!, "branch")).id).toBe(rv.C);
  });
});

describe("replying", () => {
  it("posts a reply: row, audit line, event and a notification to the reviewer", async () => {
    const before = (await notes(ids.r1!)).length;
    const res = await reply("owner", "B", "Thank you!");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message: "Reply posted. It shows under the review on the website." });
    const saved = await row("B");
    expect(saved).toMatchObject({ reply: "Thank you!", repliedBy: ids.owner, version: 2, updatedBy: ids.owner });
    expect(saved.repliedAt).toBeInstanceOf(Date);
    expect((await audits("B")).map((a) => [a.action, a.target, a.actorId])).toEqual([["review.replied", rv.B, ids.owner]]);
    const evs = await events("B");
    expect(evs).toHaveLength(1);
    expect(evs[0]!.payload).toEqual({ reviewId: rv.B, hasReply: true });
    const mine = (await notes(ids.r1!)).filter((n) => n.link === "/property/rv-1");
    expect(mine).toHaveLength(1);
    expect((await notes(ids.r1!)).length).toBe(before + 1);
    expect(mine[0]).toMatchObject({ title: "Everest Realty replied to your review", message: "Thank you!" });
  });

  it("changing the reply notifies nobody again; an empty text takes the reply down", async () => {
    const before = (await notes(ids.r1!)).length;
    expect((await reply("owner", "B", "Thanks, come again!")).statusCode).toBe(200);
    expect((await notes(ids.r1!)).length).toBe(before);
    const gone = await reply("owner", "B", "   ");
    expect(gone.json()).toEqual({ message: "Reply removed." });
    expect(await row("B")).toMatchObject({ reply: null, repliedAt: null, repliedBy: null, version: 4 });
    expect((await audits("B")).map((a) => a.action)).toEqual(["review.replied", "review.replied", "review.reply_removed"]);
    const evs = await events("B");
    expect(evs.map((e) => (e.payload as { hasReply: boolean }).hasReply)).toEqual([true, true, false]);
    expect((await notes(ids.r1!)).length).toBe(before);   // removing notifies nobody
  });

  it("a reply to the business's own review sends the reviewer to the business page", async () => {
    expect((await reply("owner", "A", "Thank you for the kind words.")).statusCode).toBe(200);
    expect((await notes(ids.r1!)).some((n) => n.link === `/agent/${ids.agency}`)).toBe(true);
  });

  it("refuses a stale version with 409, and takes the right one", async () => {
    const stale = await reply("owner", "C", "Photos updated.", { version: 7 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().message).toBe("This review was changed by someone else. Reload and try again.");
    expect((await row("C")).reply).toBeNull();
    const ok = await reply("owner", "C", "Photos updated.", { version: (await row("C")).version });
    expect(ok.statusCode).toBe(200);
    expect((await row("C")).reply).toBe("Photos updated.");
  });

  it("keeps the old input rules: text up to 1500 characters, a text is required", async () => {
    expect((await reply("owner", "A", "x".repeat(1501))).statusCode).toBe(422);
    expect((await call("owner", "POST", `/reviews/${rv.A}/reply`, {})).statusCode).toBe(422);
  });
});

describe("permissions: old names and new names", () => {
  it("customers.view (old) can read but not reply", async () => {
    const r = await list("oldview");
    expect(r.res.statusCode).toBe(200);
    expect(r.body.meta.canReply).toBe(false);
    const no = await reply("oldview", "A", "hi");
    expect(no.statusCode).toBe(403);
    expect(no.json().message).toBe("Your role can't reply to reviews.");
  });
  it("reviews.reply (old) can read and reply", async () => {
    const r = await list("oldreply");
    expect(r.res.statusCode).toBe(200);
    expect(r.body.meta.canReply).toBe(true);
    expect((await reply("oldreply", "A", "Old role reply")).statusCode).toBe(200);
    expect((await row("A")).reply).toBe("Old role reply");
  });
  it("reviews.review.read (new) reads and cannot reply", async () => {
    expect((await list("newread")).res.statusCode).toBe(200);
    expect((await reply("newread", "A", "nope")).statusCode).toBe(403);
  });
  it("reviews.review.reply (new) replies, and (as the old reviews.reply did) may read", async () => {
    expect((await reply("newreply", "C", "New role reply")).statusCode).toBe(200);
    expect((await row("C")).reply).toBe("New role reply");
    expect((await list("newreply")).res.statusCode).toBe(200);
  });
  it("a role with no review permission can neither read nor reply", async () => {
    const r = await list("nobody");
    expect(r.res.statusCode).toBe(403);
    expect(r.body.message).toBe("Your role can't see reviews.");
    expect((await reply("nobody", "A", "hi")).statusCode).toBe(403);
  });
});

describe("the service", () => {
  const db = createDb(inject("databaseUrl"))!;
  const ctxFor = (extra: object = {}) => ({ ...makeTestContext({ db, businessId: ids.agency!, branches: [{ id: ids.head! }, { id: ids.pk! }], userId: ids.owner! }), ...extra }) as ReturnType<typeof makeTestContext>;
  const stubBus = (publish: () => Promise<unknown>) => ({ publish }) as unknown as EventBus;

  it("refuses a reply in a read-only support session", async () => {
    const service = new ReviewService({ bus: stubBus(async () => ({})) });
    const ctx = ctxFor({ impersonation: { staffId: "staff-1", reason: "checking", expiresAt: new Date(Date.now() + 60_000), readOnly: true } });
    const before = (await audits("A")).length;
    await expect(service.reply(ctx, rv.A!, { text: "from support" })).rejects.toMatchObject({ statusCode: 403 });
    expect((await row("A")).reply).toBe("Old role reply");
    expect((await audits("A")).length).toBe(before);
  });

  it("a reply that was saved stays a success when the notification to the reviewer fails (QA, P1-BE-6 fix 1)", async () => {
    const service = new ReviewService({ bus: app.events!.bus });
    const fresh = (await db.review.create({ data: { userId: ids.r2!, tenantId: ids.agency!, rating: 4, comment: "Notify me" } })).id;
    // ctx.db is only used for the notification after the commit; make that one call fail.
    const broken = new Proxy(db, { get: (t, p) => (p === "notification" ? { createMany: async () => { throw new Error("bell is down"); } } : Reflect.get(t, p)) });
    const ctx = { ...ctxFor(), db: broken } as ReturnType<typeof makeTestContext>;
    await expect(service.reply(ctx, fresh, { text: "Thank you!" })).resolves.toMatchObject({ posted: true });
    expect((await db.review.findUniqueOrThrow({ where: { id: fresh } })).reply).toBe("Thank you!");
  });

  it("new reviews reach people by the NEW reply name, and old-name roles still (QA, P1-BE-6 fix 2)", async () => {
    const people = await teamWith(db, ids.agency!, ["reviews.review.reply"]);   // the name the website's review notice uses now
    expect(people).toEqual(expect.arrayContaining([ids.owner, ids.newreply, ids.oldreply]));
    expect(people).not.toContain(ids.newread);
    expect(people).not.toContain(ids.oldview);
    expect(people).not.toContain(ids.nobody);
  });

  it("writes the event in the reply's transaction: if the event fails, the reply and the audit line are gone", async () => {
    const service = new ReviewService({ bus: stubBus(async () => { throw new Error("outbox down"); }) });
    const before = (await audits("C")).length;
    const was = await row("C");
    await expect(service.reply(ctxFor(), rv.C!, { text: "will not stay" })).rejects.toThrow("outbox down");
    expect(await row("C")).toMatchObject({ reply: was.reply, version: was.version });
    expect((await audits("C")).length).toBe(before);
  });
});
