// Tests of the tenancy context and of branch access by branch ID (P1-BE-3), on a real database through the business API.
// Where it fits: platform/src/tenancy/{context,branch-links}.ts, business/backend/src/modules/{access.ts,team/routes.ts,branches/routes.ts},
// backend-core/scripts/resync-branch-links.mjs. The existing team, branches and app tests run unchanged next to this file.
// How it works: a hotel with two extra branches, an agency, a Starter business and a few people. Contexts are built from a real session
// (userForToken), requests go through app.inject like the panel's. "In step" means: the old `scopes` names equal the names of the linked
// branch ids (ACCESS.md 3.4), for every membership and every pending invitation.
// Rules: the four checks of ACCESS.md section 1 (other business, app not available, role without the permission, record in another
// branch); dual write for invite, edit member, accept, rename and remove; seats on re-activation; read-only impersonation refuses writes.

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadConfig } from "@sheetal/backend-core/config";
import { effectiveLimits } from "@sheetal/backend-core/domain/addons";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession, userForToken } from "@sheetal/backend-core/modules/auth/sessions";
import { BaseService } from "@sheetal/platform/core/service";
import { buildBusinessContext, buildImpersonationContext, buildStaffContext, requireAppAccess, type TenancyDeps } from "@sheetal/platform/tenancy/context";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const deps: TenancyDeps = { effectiveLimits: (db, tenantId, plan) => effectiveLimits(db, tenantId, plan) };

/** A request as `who`, in a business (default the hotel), looking at a branch (an id, "all", or none). */
const call = (who: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: object, tenant = ids.hotel, branch?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant!, ...(branch ? { "x-branch": branch } : {}) } });
async function person(key: string, email: string, platformRole?: string) {
  const u = await app.db!.user.create({ data: { email, userName: key, emailVerifiedAt: new Date(), ...(platformRole ? { platformRole } : {}) } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
/** The same person's context, built from their session like a controller would. */
const ctxFor = async (who: string, tenant = ids.hotel, branch?: string) => {
  const found = await userForToken(app, tok[who]!);
  return buildBusinessContext({
    db: app.db!, user: found!.user, headers: { "x-tenant-id": tenant!, ...(branch ? { "x-branch": branch } : {}) },
    ip: "127.0.0.1", requestId: "test", log: app.log,
  }, deps);
};
const staffCtx = async (who: string) => buildStaffContext({ db: app.db!, user: (await userForToken(app, tok[who]!))!.user, headers: {}, ip: "127.0.0.1", requestId: "test", log: app.log });
const roleId = async (key: string, tenant = ids.hotel) => (await app.db!.role.findFirstOrThrow({ where: { tenantId: tenant, key } })).id;
const lastLink = async (to: string) => {
  const m = await app.db!.outboundEmail.findFirstOrThrow({ where: { to }, orderBy: { createdAt: "desc" } });
  return m.text.match(/token=([A-Za-z0-9_-]+)/)![1]!;
};
const addBranch = async (name: string, tenant = ids.hotel) => (await call("owner", "POST", "/branches", { name }, tenant)).json().data.id as string;
const memberOf = (who: string, tenant = ids.hotel) =>
  app.db!.membership.findFirstOrThrow({ where: { userId: ids[who]!, tenantId: tenant }, include: { branches: { include: { branch: true } }, role: true } });
const linkedNames = (rows: { branch: { name: string; sort: number } }[]) => rows.map((l) => l.branch.name).sort();

/** The invariant of dual write: for everyone, the old names are the names of the linked ids (owners and "all" people have no list). */
async function expectInStep() {
  const db = app.db!;
  for (const m of await db.membership.findMany({ include: { branches: { include: { branch: true } }, role: true } })) {
    const owner = m.role.perms.includes("*");
    if (m.allBranches || owner) { if (!owner) expect(m.scopes, `member ${m.id}`).toBe("all"); continue; }
    expect([...(m.scopes as string[])].sort(), `member ${m.id}`).toEqual(linkedNames(m.branches));
  }
  for (const i of await db.invite.findMany({ where: { status: "pending" }, include: { branches: { include: { branch: true } } } })) {
    if (i.allBranches) { expect(i.scopes, `invite ${i.id}`).toBe("all"); continue; }
    expect([...(i.scopes as string[])].sort(), `invite ${i.id}`).toEqual(linkedNames(i.branches));
  }
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, rooms, outbound_emails, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  // A plan with two seats, to test the "N seats and M are taken" message.
  await db.plan.create({ data: { id: "agency-two-seats", type: "agency", name: "Business", price: 1000, limits: { seats: 2, listings: 10 }, features: {}, sort: 9 } });
  for (const [k, e] of [["owner", "owner@ridge.test"], ["desk", "desk@ridge.test"], ["agent", "agent@ridge.test"], ["nobody", "nobody@ridge.test"], ["outsider", "out@else.test"],
    ["newbie", "newbie@ridge.test"], ["solo", "solo@tiny.test"], ["extra", "extra@tiny.test"]]) await person(k!, e!);
  await person("support", "support@sheetal.test", "support");
  await person("finance", "finance@sheetal.test", "finance");
  await person("root", "root@sheetal.test", "super_admin");
  ids.hotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Ridge Hotel", type: "hotel", planId: "hotel-business" }))).id;
  ids.realty = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Ridge Realty", type: "agency", planId: "agency-business" }))).id;
  ids.tiny = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.solo!, name: "Tiny Agency", type: "agency" }))).id;
  ids.head = (await db.branch.findFirstOrThrow({ where: { tenantId: ids.hotel } })).id;
  await db.membership.create({ data: { tenantId: ids.hotel, userId: ids.desk!, roleId: await roleId("frontdesk"), status: "active" } });
  await db.membership.create({ data: { tenantId: ids.realty, userId: ids.agent!, roleId: await roleId("agent", ids.realty), status: "active" } });
  // Limited, with no branch at all: the state a stale name leaves behind after the migration.
  await db.membership.create({ data: { tenantId: ids.hotel, userId: ids.nobody!, roleId: await roleId("frontdesk"), status: "active", allBranches: false, scopes: [] } });
  ids.pokhara = await addBranch("Pokhara");
  ids.chitwan = await addBranch("Chitwan");
  ids.lumbini = await addBranch("Lumbini");
});
afterAll(async () => { await app.close(); });

describe("the four checks (ACCESS.md section 1)", () => {
  it("1. a person who is not in the business is refused, by the route and by the context", async () => {
    expect((await call("outsider", "GET", "/team")).statusCode).toBe(403);
    expect((await call("outsider", "GET", "/branches")).statusCode).toBe(403);
    await expect(ctxFor("outsider")).rejects.toMatchObject({ statusCode: 403, message: "You are not a member of this business." });
    // ...and a member of another business can't borrow it with the header.
    await expect(ctxFor("agent", ids.hotel)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("2. a business without the app gets app_not_available; one that has it passes", async () => {
    const hotel = await ctxFor("owner", ids.hotel);
    const realty = await ctxFor("owner", ids.realty);
    expect(() => requireAppAccess(hotel, "pos")).not.toThrow();
    expect(realty.entitlements.hasApp("pos")).toBe(false);
    try { requireAppAccess(realty, "pos"); expect.unreachable(); } catch (e) {
      expect(e).toMatchObject({ statusCode: 403, code: "app_not_available" });
    }
    // Nothing that works today is switched off: the shared apps are there for every type.
    for (const app of ["workspace", "expenses", "reviews", "crm"]) expect(realty.entitlements.hasApp(app), app).toBe(true);
  });

  it("3. a role without the permission is forbidden", async () => {
    const desk = await ctxFor("desk");
    expect(desk.permissions.can("bookings.view")).toBe(true);
    expect(desk.permissions.can("hotel.booking.read")).toBe(true);     // the new name works for a role that holds the old one
    expect(desk.permissions.scopeOf("bookings.view")).toBe("branch");
    expect(() => desk.permissions.require("settings.business")).toThrowError();
    expect(() => desk.permissions.require("workspace.branch.create")).toThrowError();
    expect((await call("desk", "POST", "/branches", { name: "Desk's own" })).statusCode).toBe(403);
    expect(() => requireAppAccess(desk, "expenses")).toThrowError("Your role can't use");   // a front desk has no expenses permission
  });

  it("4. a record in another branch is not found", async () => {
    await call("owner", "PATCH", `/team/members/${ids.desk}`, { scopes: ["Pokhara"] });
    await call("owner", "POST", "/rooms", { type: "Deluxe", rate: 6000, nos: ["C1"], branchId: ids.chitwan });
    const c1 = (await call("owner", "GET", "/rooms")).json().data.find((r: { no: string }) => r.no === "C1").id;
    expect((await call("desk", "PATCH", `/rooms/${c1}`, { status: "dirty" })).statusCode).toBe(404);
    const desk = await ctxFor("desk");
    expect(desk.branches.canSee(ids.chitwan)).toBe(false);
    expect(desk.branches.canSee(ids.pokhara)).toBe(true);
    expect(desk.branches.canSee(null)).toBe(true);
    expect(desk.branches.canSee(ids.head)).toBe(false);
    // A branch of another business is never visible, not even to the owner of both.
    expect((await ctxFor("owner", ids.hotel)).branches.canSee((await app.db!.branch.findFirstOrThrow({ where: { tenantId: ids.realty } })).id)).toBe(false);
  });
});

describe("BranchScope from the real rows", () => {
  it("owner: all branches, no filter", async () => {
    const ctx = await ctxFor("owner");
    expect(ctx.member.isOwner).toBe(true);
    expect(ctx.branches.allowed).toBe("all");
    expect(ctx.branches.mine.map((b) => b.name)).toEqual(["Head office", "Pokhara", "Chitwan", "Lumbini"]);
    expect(ctx.branches.idsFor("branch")).toBeNull();
    expect(ctx.entitlements.hasApp("pos")).toBe(true);
    expect(ctx.business).toMatchObject({ id: ids.hotel, name: "Ridge Hotel", type: "hotel", planId: "hotel-business" });
  });

  it("a person limited to one branch sees only it, even with 'All branches' picked", async () => {
    const ctx = await ctxFor("desk", ids.hotel, "all");
    expect(ctx.branches.allowed).toEqual([ids.pokhara]);
    expect(ctx.branches.mine.map((b) => b.id)).toEqual([ids.pokhara]);
    expect(ctx.branches.idsFor("branch")).toEqual([ids.pokhara]);
    expect(ctx.branches.branchForNew()).toBe(ids.pokhara);   // their only open branch
    expect((await call("desk", "GET", "/branches")).json().data.branches.map((b: { name: string }) => b.name)).toEqual(["Pokhara"]);
  });

  it("a person with zero branches has no branch at all, and is never widened to all", async () => {
    const ctx = await ctxFor("nobody");
    expect(ctx.branches.allowed).toEqual([]);
    expect(ctx.branches.mine).toEqual([]);
    expect(ctx.branches.idsFor("branch")).toEqual([]);
    expect(() => ctx.branches.branchForNew()).toThrowError("You aren't given any open branch. Ask the owner to give you one on the Team page.");
    expect((await call("nobody", "GET", "/branches")).json().data.branches).toEqual([]);
    expect((await call("nobody", "GET", "/rooms")).json().data).toEqual([]);
    expect((await call("nobody", "GET", "/workspaces")).json().data.workspaces[0]).toMatchObject({ scopes: [], branchIds: [] });
  });

  it("x-branch with a branch the person may not see is refused, by the context and by the routes", async () => {
    await expect(ctxFor("desk", ids.hotel, ids.chitwan)).rejects.toMatchObject({ statusCode: 403, message: "You don't work at that branch." });
    expect((await call("desk", "GET", "/rooms", undefined, ids.hotel, ids.chitwan)).statusCode).toBe(403);
    expect((await call("desk", "GET", "/rooms", undefined, ids.hotel, ids.pokhara)).statusCode).toBe(200);
    await expect(ctxFor("owner", ids.hotel, "no-such-branch")).rejects.toMatchObject({ statusCode: 403 });
    expect((await ctxFor("owner", ids.hotel, ids.chitwan)).branches.idsFor("branch")).toEqual([ids.chitwan]);
  });

  it("builds the entitlements from today's plan", async () => {
    const hotel = await ctxFor("owner", ids.hotel);
    expect(hotel.entitlements.seats()).toEqual({ used: 2 + 1, limit: 10 });   // owner + desk + nobody (all active)
    expect(hotel.entitlements.feature("custom_roles")).toBe(true);
    expect(hotel.entitlements.limit("hotel", "rooms")).toBe(40);
    const tiny = await ctxFor("solo", ids.tiny);
    expect(tiny.entitlements.seats()).toEqual({ used: 1, limit: 1 });
    expect(tiny.entitlements.feature("custom_roles")).toBe(false);
    expect(tiny.member).toMatchObject({ userId: ids.solo, roleKey: "owner", isOwner: true });
    expect(tiny.actor).toMatchObject({ kind: "user", userId: ids.solo });
    // transaction() hands back the same context with tx set.
    expect(tiny.tx).toBeNull();
    await tiny.transaction(async (t) => { expect(t.tx).not.toBeNull(); expect(t.business.id).toBe(ids.tiny); });
  });
});

describe("dual write: names and ids stay in step", () => {
  it("an invitation by names writes the ids too; by ids writes the names too", async () => {
    const r1 = await call("owner", "POST", "/team/invites", { invites: [{ email: "agent1@ridge.test", roleId: await roleId("frontdesk"), scopes: ["Pokhara"] }] });
    expect(r1.statusCode).toBe(200);
    const i1 = await app.db!.invite.findFirstOrThrow({ where: { email: "agent1@ridge.test" }, include: { branches: true } });
    expect(i1).toMatchObject({ allBranches: false, scopes: ["Pokhara"] });
    expect(i1.branches.map((b) => b.branchId)).toEqual([ids.pokhara]);

    const r2 = await call("owner", "POST", "/team/invites", { invites: [{ email: "agent2@ridge.test", roleId: await roleId("frontdesk"), branchIds: [ids.lumbini, ids.pokhara] }] });
    expect(r2.statusCode).toBe(200);
    const i2 = await app.db!.invite.findFirstOrThrow({ where: { email: "agent2@ridge.test" }, include: { branches: true } });
    expect(i2).toMatchObject({ allBranches: false, scopes: ["Pokhara", "Lumbini"] });   // screen order, not the order sent
    expect(i2.branches.map((b) => b.branchId).sort()).toEqual([ids.pokhara, ids.lumbini].sort());

    const r3 = await call("owner", "POST", "/team/invites", { invites: [{ email: "agent3@ridge.test", roleId: await roleId("frontdesk") }] });
    expect(r3.statusCode).toBe(200);
    expect(await app.db!.invite.findFirstOrThrow({ where: { email: "agent3@ridge.test" } })).toMatchObject({ allBranches: true, scopes: "all" });
    await expectInStep();
  });

  it("refuses a name or id that is not an open branch of this business, with today's message", async () => {
    const send = (extra: object) => call("owner", "POST", "/team/invites", { invites: [{ email: "bad@ridge.test", roleId: "x", ...extra }] });
    const byName = await send({ scopes: ["Mustang"] });
    expect(byName.statusCode).toBe(400);
    expect(byName.json().message).toBe("Mustang isn't an open branch of this business.");
    expect((await send({ scopes: ["Mustang", "Pokhara", "Dolpo"] })).json().message).toBe("Mustang, Dolpo aren't open branches of this business.");
    expect((await send({ branchIds: ["no-such-id"] })).statusCode).toBe(400);
    expect((await send({ branchIds: [(await app.db!.branch.findFirstOrThrow({ where: { tenantId: ids.realty } })).id] })).statusCode).toBe(400);   // another business's branch
    expect((await send({ scopes: [] })).json().message).toBe("Pick at least one branch, or all branches.");
    await call("owner", "PATCH", `/branches/${ids.lumbini}`, { status: "closed" });
    expect((await send({ branchIds: [ids.lumbini] })).statusCode).toBe(400);   // closed
    await call("owner", "PATCH", `/branches/${ids.lumbini}`, { status: "open" });
  });

  it("accepting an invitation gives the person the invitation's branches, in both columns", async () => {
    await call("owner", "POST", "/team/invites", { invites: [{ email: "newbie@ridge.test", roleId: await roleId("frontdesk"), branchIds: [ids.chitwan, ids.pokhara] }] });
    const token = await lastLink("newbie@ridge.test");
    expect((await call("newbie", "POST", "/invites/accept", { token })).statusCode).toBe(200);
    const m = await memberOf("newbie");
    expect(m).toMatchObject({ allBranches: false, status: "active" });
    expect(linkedNames(m.branches)).toEqual(["Chitwan", "Pokhara"]);
    expect([...(m.scopes as string[])].sort()).toEqual(["Chitwan", "Pokhara"]);
    const ws = (await call("newbie", "GET", "/workspaces")).json().data.workspaces[0];
    expect(ws.scopes.sort()).toEqual(["Chitwan", "Pokhara"]);
    expect(ws.branchIds.sort()).toEqual([ids.chitwan, ids.pokhara].sort());
    // The Team page shows both, from the rows.
    const row = (await call("owner", "GET", "/team")).json().data.members.find((x: { id: string }) => x.id === ids.newbie);
    expect(row.scopes).toEqual(["Pokhara", "Chitwan"]);
    expect(row.branchIds).toEqual([ids.pokhara, ids.chitwan]);
    await expectInStep();
  });

  it("editing a member by names or ids writes both, and leaving branches out changes nothing", async () => {
    expect((await call("owner", "PATCH", `/team/members/${ids.newbie}`, { branchIds: [ids.chitwan] })).statusCode).toBe(200);
    let m = await memberOf("newbie");
    expect(m.scopes).toEqual(["Chitwan"]);
    expect(m.branches.map((b) => b.branchId)).toEqual([ids.chitwan]);

    expect((await call("owner", "PATCH", `/team/members/${ids.newbie}`, { scopes: ["Pokhara", "Chitwan"] })).statusCode).toBe(200);
    m = await memberOf("newbie");
    expect(linkedNames(m.branches)).toEqual(["Chitwan", "Pokhara"]);

    expect((await call("owner", "PATCH", `/team/members/${ids.newbie}`, { status: "paused" })).statusCode).toBe(200);
    m = await memberOf("newbie");
    expect(m).toMatchObject({ allBranches: false, status: "paused" });
    expect(linkedNames(m.branches)).toEqual(["Chitwan", "Pokhara"]);   // not widened by an edit that said nothing about branches
    expect((await call("owner", "PATCH", `/team/members/${ids.newbie}`, { status: "active" })).statusCode).toBe(200);

    // An empty body (Zod 4: defaults inside .optional()) changes nothing at all: no widening to "all" (QA, P1-BE-3 fix 5).
    const before = await memberOf("newbie");
    expect((await call("owner", "PATCH", `/team/members/${ids.newbie}`, {})).statusCode).toBe(200);
    const after = await memberOf("newbie");
    expect(after).toMatchObject({ allBranches: before.allBranches, status: before.status, roleId: before.roleId, scopes: before.scopes });
    expect(linkedNames(after.branches)).toEqual(linkedNames(before.branches));

    expect((await call("owner", "PATCH", `/team/members/${ids.newbie}`, { scopes: ["Mustang"] })).statusCode).toBe(400);
    expect(linkedNames((await memberOf("newbie")).branches)).toEqual(["Chitwan", "Pokhara"]);   // a refused edit changes nothing

    expect((await call("owner", "PATCH", `/team/members/${ids.newbie}`, { branchIds: "all" })).statusCode).toBe(200);
    m = await memberOf("newbie");
    expect(m).toMatchObject({ allBranches: true, scopes: "all" });
    expect(m.branches).toEqual([]);
    expect((await call("newbie", "GET", "/branches")).json().data.branches).toHaveLength(4);
    await call("owner", "PATCH", `/team/members/${ids.newbie}`, { branchIds: [ids.chitwan, ids.pokhara] });
    await expectInStep();
  });

  it("becoming an owner and back keeps the person's branches", async () => {
    expect((await call("owner", "PATCH", `/team/members/${ids.newbie}`, { roleId: await roleId("owner") })).statusCode).toBe(200);
    expect(await memberOf("newbie")).toMatchObject({ allBranches: true });
    expect((await call("newbie", "GET", "/branches")).json().data.branches).toHaveLength(4);   // owners see everything
    expect((await call("owner", "PATCH", `/team/members/${ids.newbie}`, { roleId: await roleId("frontdesk") })).statusCode).toBe(200);
    const m = await memberOf("newbie");
    expect(m.allBranches).toBe(false);
    expect(linkedNames(m.branches)).toEqual(["Chitwan", "Pokhara"]);   // not widened to "all" by the demotion
    await expectInStep();
  });

  it("a rename leaves the ids alone and rewrites the old names", async () => {
    expect((await call("owner", "PATCH", `/branches/${ids.pokhara}`, { name: "Pokhara Lakeside" })).statusCode).toBe(200);
    const m = await memberOf("newbie");
    expect(m.branches.map((b) => b.branchId).sort()).toEqual([ids.chitwan, ids.pokhara].sort());
    expect([...(m.scopes as string[])].sort()).toEqual(["Chitwan", "Pokhara Lakeside"]);
    expect((await call("desk", "GET", "/branches")).json().data.branches.map((b: { name: string }) => b.name)).toEqual(["Pokhara Lakeside"]);
    const inv = await app.db!.invite.findFirstOrThrow({ where: { email: "agent1@ridge.test" } });
    expect(inv.scopes).toEqual(["Pokhara Lakeside"]);
    await expectInStep();
  });

  it("removing a branch counts the link rows for 'someone's only branch', then cascades them", async () => {
    // The desk works only at Lumbini: it can't be removed until they have another branch.
    await call("owner", "PATCH", `/team/members/${ids.desk}`, { branchIds: [ids.lumbini] });
    const refused = await call("owner", "DELETE", `/branches/${ids.lumbini}`);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().message).toBe("desk only works at Lumbini. Give them another branch on the Team page first.");
    expect(await app.db!.branch.count({ where: { id: ids.lumbini } })).toBe(1);

    // With a second branch it goes, and the old names follow. A pending invitation to Lumbini only is left with NO branch (Lead decision,
    // P1-BE-3 review: the old code widened it to "all"; access is never widened automatically). The owner picks a branch on the Team page.
    await call("owner", "PATCH", `/team/members/${ids.desk}`, { branchIds: [ids.lumbini, ids.pokhara] });
    await call("owner", "POST", "/team/invites", { invites: [{ email: "lonely@ridge.test", roleId: await roleId("frontdesk"), branchIds: [ids.lumbini] }, { email: "pair@ridge.test", roleId: await roleId("frontdesk"), branchIds: [ids.lumbini, ids.chitwan] }] });
    expect((await call("owner", "DELETE", `/branches/${ids.lumbini}`)).statusCode).toBe(200);
    const desk = await memberOf("desk");
    expect(desk.branches.map((b) => b.branchId)).toEqual([ids.pokhara]);
    expect(desk.scopes).toEqual(["Pokhara Lakeside"]);
    expect(await app.db!.membershipBranch.count({ where: { branchId: ids.lumbini } })).toBe(0);
    expect(await app.db!.inviteBranch.count({ where: { branchId: ids.lumbini } })).toBe(0);
    expect(await app.db!.invite.findFirstOrThrow({ where: { email: "lonely@ridge.test" } })).toMatchObject({ allBranches: false, scopes: [] });
    expect(await app.db!.inviteBranch.count({ where: { invite: { email: "lonely@ridge.test" } } })).toBe(0);
    expect(await app.db!.invite.findFirstOrThrow({ where: { email: "pair@ridge.test" } })).toMatchObject({ allBranches: false, scopes: ["Chitwan"] });
    ids.lumbini = await addBranch("Lumbini");
    await expectInStep();
  });

  it("answers carry both branchIds and scopes (names)", async () => {
    const t = (await call("owner", "GET", "/team")).json().data;
    const desk = t.members.find((x: { id: string }) => x.id === ids.desk);
    expect(desk).toMatchObject({ scopes: ["Pokhara Lakeside"], branchIds: [ids.pokhara] });
    expect(t.members.find((x: { id: string }) => x.id === ids.owner)).toMatchObject({ scopes: "all", branchIds: "all" });
    const pair = t.invites.find((x: { email: string }) => x.email === "pair@ridge.test");
    expect(pair).toMatchObject({ scopes: ["Chitwan"], branchIds: [ids.chitwan] });
    const mine = (await call("owner", "GET", "/workspaces")).json().data.workspaces.find((w: { id: string }) => w.id === ids.hotel);
    expect(mine).toMatchObject({ scopes: "all", branchIds: "all" });
  });
});

describe("seats", () => {
  it("refuses to make a paused member active again at the seat limit (Starter: just you)", async () => {
    const db = app.db!;
    await db.membership.create({ data: { tenantId: ids.tiny, userId: ids.extra!, roleId: await roleId("agent", ids.tiny), status: "paused" } });
    const r = await call("solo", "PATCH", `/team/members/${ids.extra}`, { status: "active" }, ids.tiny);
    expect(r.statusCode).toBe(402);
    expect(r.json()).toMatchObject({ code: "seat_limit", message: "The Starter plan is just you. Upgrade to add your team." });
    expect((await memberOf("extra", ids.tiny)).status).toBe("paused");
  });

  it("says how many seats are taken, counts pending invitations, and lets the person back when there is room", async () => {
    const db = app.db!;
    await db.tenant.update({ where: { id: ids.tiny }, data: { planId: "agency-two-seats" } });
    // 1 active (solo) + 1 paused (extra): room for extra.
    await db.invite.create({ data: { tenantId: ids.tiny, email: "wait@tiny.test", roleId: await roleId("agent", ids.tiny), tokenHash: "h-wait", expiresAt: new Date(Date.now() + 864e5) } });
    // 1 active + 1 pending = 2 seats taken: no room.
    const full = await call("solo", "PATCH", `/team/members/${ids.extra}`, { status: "active" }, ids.tiny);
    expect(full.statusCode).toBe(402);
    expect(full.json().message).toBe("Your plan has 2 seats and 2 are taken.");
    // The same invitation, expired, no longer takes a seat.
    await db.invite.updateMany({ where: { tokenHash: "h-wait" }, data: { expiresAt: new Date(Date.now() - 864e5) } });
    expect((await call("solo", "PATCH", `/team/members/${ids.extra}`, { status: "active" }, ids.tiny)).statusCode).toBe(200);
    expect((await memberOf("extra", ids.tiny)).status).toBe("active");
  });

  it("does not block other edits at the limit, and inviting still refuses with the same message", async () => {
    // At the limit now (2 of 2): a role change of an active member is fine, a new invitation is not.
    expect((await call("solo", "PATCH", `/team/members/${ids.extra}`, { roleId: await roleId("accountant", ids.tiny) }, ids.tiny)).statusCode).toBe(200);
    const inv = await call("solo", "POST", "/team/invites", { invites: [{ email: "third@tiny.test", roleId: await roleId("agent", ids.tiny) }] }, ids.tiny);
    expect(inv.statusCode).toBe(402);
    expect(inv.json().message).toBe("Your plan has 2 seats and 2 are taken.");
    // Pausing frees the seat, re-activating takes it back (and is allowed again).
    expect((await call("solo", "PATCH", `/team/members/${ids.extra}`, { status: "paused" }, ids.tiny)).statusCode).toBe(200);
    expect((await call("solo", "PATCH", `/team/members/${ids.extra}`, { status: "active" }, ids.tiny)).statusCode).toBe(200);
  });
});

describe("the staff context and support sessions", () => {
  const reason = "Ticket 4411: the owner can't see rooms";
  // A service with a stub repository: a refused write never reaches it.
  class Probe extends BaseService<never, object, object> {}
  const probe = new Probe({
    app: "expenses", resource: "expense", repo: {} as never,
    permissions: { read: "expenses.expense.read", create: "expenses.expense.create", update: "expenses.expense.update", delete: "expenses.expense.delete" },
    schemas: { create: z.object({}), update: z.object({}) }, audit: { entity: "expense", label: () => "x" }, bus: {} as never,
  });
  const info = () => ({ db: app.db!, headers: {}, ip: "127.0.0.1", requestId: "test", log: app.log });

  it("builds a StaffContext from the platform role, and refuses people who are not staff", async () => {
    const staff = await staffCtx("support");
    expect(staff.staff.role).toBe("support");
    expect(staff.permissions.can("tenants.view")).toBe(true);
    expect(staff.permissions.can("platform.business.impersonate")).toBe(true);
    expect(staff.permissions.can("plans.manage")).toBe(false);
    await expect(staffCtx("owner")).rejects.toMatchObject({ statusCode: 403, message: "This is for Sheetal staff only." });
  });

  it("a read-only impersonation context refuses every write (the BE-1 rule), and reads still work", async () => {
    const ctx = await buildImpersonationContext({ ...info(), staff: await staffCtx("support"), tenantId: ids.hotel!, reason }, deps);
    expect(ctx.impersonation).toMatchObject({ staffId: ids.support, reason, readOnly: true });
    expect(ctx.impersonation!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(ctx.impersonation!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 1000);
    expect(ctx.actor).toMatchObject({ kind: "staff", staffId: ids.support, role: "support" });
    expect(ctx.business).toMatchObject({ id: ids.hotel, name: "Ridge Hotel" });
    expect(ctx.branches.allowed).toBe("all");
    await expect(probe.create(ctx, {})).rejects.toMatchObject({ statusCode: 403, message: "This is a read-only support session. Changes are not allowed." });
    await expect(probe.update(ctx, "x", {})).rejects.toMatchObject({ statusCode: 403, message: "This is a read-only support session. Changes are not allowed." });
    await expect(probe.remove(ctx, "x")).rejects.toMatchObject({ statusCode: 403 });
    // Even with the owner's powers, the deny list holds.
    expect(ctx.permissions.can("expenses.expense.read")).toBe(true);
    for (const p of ["workspace.role.update", "workspace.team.invite", "workspace.billing.manage", "workspace.settings.update", "team.manage"]) expect(ctx.permissions.can(p), p).toBe(false);
  });

  it("write mode needs the super admin, a reason of 10 to 300 characters, and a business that isn't suspended", async () => {
    const support = await staffCtx("support");
    await expect(buildImpersonationContext({ ...info(), staff: support, tenantId: ids.hotel!, reason, write: true }, deps)).rejects.toMatchObject({ statusCode: 403 });
    await expect(buildImpersonationContext({ ...info(), staff: await staffCtx("finance"), tenantId: ids.hotel!, reason }, deps)).rejects.toMatchObject({ statusCode: 403 });
    await expect(buildImpersonationContext({ ...info(), staff: support, tenantId: ids.hotel!, reason: "too short" }, deps)).rejects.toMatchObject({ statusCode: 400 });
    await expect(buildImpersonationContext({ ...info(), staff: support, tenantId: ids.hotel!, reason: "x".repeat(301) }, deps)).rejects.toMatchObject({ statusCode: 400 });
    await expect(buildImpersonationContext({ ...info(), staff: support, tenantId: "nope", reason }, deps)).rejects.toMatchObject({ statusCode: 404 });
    const root = await staffCtx("root");
    const write = await buildImpersonationContext({ ...info(), staff: root, tenantId: ids.hotel!, reason, write: true, minutes: 99 }, deps);
    expect(write.impersonation).toMatchObject({ readOnly: false });
    expect(write.impersonation!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 60_000 + 1000);   // never more than 30 minutes
    // The read-only gate is not what stops it: this write fails later, on the stub repository, not with the support-session message.
    await expect(probe.create(write, {})).rejects.not.toMatchObject({ message: "This is a read-only support session. Changes are not allowed." });
    await app.db!.tenant.update({ where: { id: ids.tiny }, data: { status: "suspended" } });
    await expect(buildImpersonationContext({ ...info(), staff: root, tenantId: ids.tiny!, reason, write: true }, deps)).rejects.toMatchObject({ statusCode: 403 });
    expect((await buildImpersonationContext({ ...info(), staff: root, tenantId: ids.tiny!, reason }, deps)).impersonation!.readOnly).toBe(true);   // reading a suspended business is fine
    await app.db!.tenant.update({ where: { id: ids.tiny }, data: { status: "active" } });
  });
});

describe("resync-branch-links.mjs", () => {
  const script = fileURLToPath(new URL("../../../backend-core/scripts/resync-branch-links.mjs", import.meta.url));
  const run = (...args: string[]) => execFileSync("node", [script, ...args], { env: { ...process.env, DATABASE_URL: inject("databaseUrl") }, encoding: "utf8" });

  it("brings the links back in line with names edited by the old code, and is safe to run twice", async () => {
    const db = app.db!;
    await expectInStep();
    // The old code only wrote names: the desk was moved to Chitwan, a new person to Pokhara, and the front-desk limited person back to all.
    const deskM = await memberOf("desk");
    await db.membership.update({ where: { id: deskM.id }, data: { scopes: ["Chitwan"] } });
    const newbieM = await memberOf("newbie");
    await db.membership.update({ where: { id: newbieM.id }, data: { scopes: "all" } });

    const dry = run("--dry-run");
    expect(dry).toContain("DRY RUN");
    expect((await memberOf("desk")).branches.map((b) => b.branchId)).toEqual([ids.pokhara]);   // nothing changed

    const out = run();
    expect(out).toContain("DONE");
    const desk = await memberOf("desk");
    expect(desk).toMatchObject({ allBranches: false });
    expect(desk.branches.map((b) => b.branchId)).toEqual([ids.chitwan]);       // the branch taken away is gone, the new one is there
    const newbie = await memberOf("newbie");
    expect(newbie.allBranches).toBe(true);
    expect(newbie.branches).toEqual([]);
    expect(await memberOf("nobody")).toMatchObject({ allBranches: false });     // nobody is widened
    expect((await memberOf("nobody")).branches).toEqual([]);
    expect(await memberOf("owner")).toMatchObject({ allBranches: true });

    expect(run()).toContain("whose branch access changed: 0");                 // a second run changes nothing
  });
});
