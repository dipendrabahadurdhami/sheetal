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
/** A request as `who`, in a business (default the hotel), looking at a branch (an id, "all", or none). */
const call = (who: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: object, tenant = ids.hotel, branch?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant!, ...(branch ? { "x-branch": branch } : {}) } });
async function person(key: string, email: string) {
  const u = await app.db!.user.create({ data: { email, userName: key, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const branches = async (who: string, tenant?: string) => (await call(who, "GET", "/branches", undefined, tenant)).json().data.branches as { id: string; name: string }[];
const names = async (who: string, tenant?: string) => (await branches(who, tenant)).map((b) => b.name);
const idOf = async (name: string, tenant?: string) => (await branches("owner", tenant)).find((b) => b.name === name)!.id;
const draft = (title: string, branchId?: string) => ({ kind: "sell", submit: false, summary: { title }, ...(branchId ? { branchId } : {}) });
const titles = async (who: string, tenant: string | undefined, branch?: string) => (await call(who, "GET", "/listings", undefined, tenant, branch)).json().data.map((l: { title: string }) => l.title).sort();

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, listings, leads, rooms, bookings, menu_items, shifts, pos_bills, outbound_emails, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("owner", "owner@peak.test");
  await person("desk", "desk@peak.test");
  await person("agent", "agent@peak.test");
  ids.hotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Peak Hotels", type: "hotel", planId: "hotel-business" }))).id;
  ids.realty = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Peak Realty", type: "agency", planId: "agency-business" }))).id;
  const frontdesk = (await db.role.findFirstOrThrow({ where: { tenantId: ids.hotel, key: "frontdesk" } })).id;
  await db.membership.create({ data: { tenantId: ids.hotel, userId: ids.desk!, roleId: frontdesk, status: "active" } });
  const agentRole = (await db.role.findFirstOrThrow({ where: { tenantId: ids.realty, key: "agent" } })).id;
  await db.membership.create({ data: { tenantId: ids.realty, userId: ids.agent!, roleId: agentRole, status: "active" } });
});
afterAll(async () => { await app.close(); });

describe("branches", () => {
  it("starts every business with a head office", async () => {
    expect(await names("owner")).toEqual(["Head office"]);
    expect(await names("owner", ids.realty)).toEqual(["Head office"]);
  });

  it("lets only settings people add branches, with unique names", async () => {
    expect((await call("desk", "POST", "/branches", { name: "Pokhara" })).statusCode).toBe(403);
    expect((await call("owner", "POST", "/branches", { name: "Pokhara", address: "Lakeside" })).statusCode).toBe(200);
    expect((await call("owner", "POST", "/branches", { name: "pokhara" })).statusCode).toBe(409);
    expect((await call("owner", "POST", "/branches", { name: "Chitwan" })).statusCode).toBe(200);
    expect(await names("owner")).toEqual(["Head office", "Pokhara", "Chitwan"]);
  });

  it("limits a person to their branches, on the server", async () => {
    expect((await call("owner", "PATCH", `/team/members/${ids.desk}`, { scopes: ["Mustang"] })).statusCode).toBe(400); // not a branch
    expect((await call("owner", "PATCH", `/team/members/${ids.desk}`, { scopes: ["Pokhara"] })).statusCode).toBe(200);
    const [pokhara, chitwan] = [await idOf("Pokhara"), await idOf("Chitwan")];
    await call("owner", "POST", "/rooms", { type: "Deluxe", rate: 6000, nos: ["P1"], branchId: pokhara });
    await call("owner", "POST", "/rooms", { type: "Deluxe", rate: 6000, nos: ["C1"], branchId: chitwan });
    expect((await call("owner", "POST", "/rooms", { type: "Deluxe", rate: 6000, nos: ["X1"], branchId: "nowhere" })).statusCode).toBe(403);
    expect((await call("desk", "POST", "/branches", { name: "Desk's own" })).statusCode).toBe(403);

    // The desk sees only Pokhara: its branch, its rooms, and can't touch a Chitwan room or booking.
    expect(await names("desk")).toEqual(["Pokhara"]);
    expect((await call("desk", "GET", "/workspaces")).json().data.workspaces[0].scopes).toEqual(["Pokhara"]);
    expect((await call("desk", "GET", "/rooms")).json().data.map((r: { no: string; branch: string }) => [r.no, r.branch])).toEqual([["P1", "Pokhara"]]);
    expect((await call("desk", "GET", "/rooms", undefined, ids.hotel, chitwan)).statusCode).toBe(403); // asking for another branch
    const c1 = (await call("owner", "GET", "/rooms")).json().data.find((r: { no: string }) => r.no === "C1").id;
    expect((await call("desk", "PATCH", `/rooms/${c1}`, { status: "dirty" })).statusCode).toBe(404);
    const bk = await call("owner", "POST", "/bookings", { type: "Deluxe", roomId: c1, guest: "Sita", from: day(0), to: day(1) });
    expect(bk.json().data.branch).toBe("Chitwan");
    expect((await call("desk", "GET", `/bookings/${bk.json().data.id}`)).statusCode).toBe(404);
    expect((await call("desk", "GET", "/bookings")).json().data).toEqual([]);
    // Owners always see everything.
    expect((await call("owner", "GET", "/workspaces")).json().data.workspaces.find((w: { id: string }) => w.id === ids.hotel).scopes).toBe("all");
  });

  it("books each branch's rooms on their own", async () => {
    const [pokhara, chitwan] = [await idOf("Pokhara"), await idOf("Chitwan")];
    // Chitwan's only Deluxe is taken tonight; Pokhara's is still free.
    expect((await call("owner", "POST", "/bookings", { type: "Deluxe", guest: "Ram", from: day(0), to: day(1), branchId: chitwan })).statusCode).toBe(409);
    const p = await call("desk", "POST", "/bookings", { type: "Deluxe", guest: "Hari", from: day(0), to: day(1) }); // the desk's only branch
    expect(p.json().data.branch).toBe("Pokhara");
    expect((await call("owner", "GET", `/availability?from=${day(0)}&to=${day(1)}`, undefined, ids.hotel, pokhara)).json().data).toEqual([expect.objectContaining({ type: "Deluxe", rooms: 1, free: 0 })]);
  });

  it("keeps a till and its bills per branch", async () => {
    const [pokhara, chitwan] = [await idOf("Pokhara"), await idOf("Chitwan")];
    await call("owner", "POST", "/menu", { items: [{ name: "Tea", price: 100 }] }); // shared by every branch
    expect((await call("desk", "POST", "/menu", { items: [{ name: "Desk tea", price: 50 }] })).statusCode).toBe(403); // the desk can't change the menu
    await call("owner", "POST", "/menu", { items: [{ name: "Chitwan thali", price: 500 }], branchId: chitwan });
    expect((await call("owner", "GET", "/menu", undefined, ids.hotel, pokhara)).json().data.map((i: { name: string }) => i.name)).toEqual(["Tea"]);
    expect((await call("owner", "POST", "/shifts/open", { float: 1000 }, ids.hotel, pokhara)).statusCode).toBe(200);
    expect((await call("owner", "POST", "/shifts/open", { float: 500 }, ids.hotel, chitwan)).statusCode).toBe(200); // its own till
    expect((await call("owner", "POST", "/shifts/open", { float: 500 })).statusCode).toBe(400); // "all branches": pick one first
    const tea = (await call("desk", "GET", "/menu")).json().data[0].id;
    expect((await call("desk", "POST", "/pos/bills", { outlet: "Restaurant", method: "cash", lines: [{ itemId: tea, name: "Tea", qty: 2, price: 1 }] })).json().data).toMatchObject({ branchId: pokhara, subtotal: 200 });
    expect((await call("owner", "GET", "/pos/bills", undefined, ids.hotel, chitwan)).json().data).toEqual([]);
    expect((await call("owner", "GET", "/pos/bills", undefined, ids.hotel, pokhara)).json().data).toHaveLength(1);
  });

  it("renames a branch everywhere it is used", async () => {
    const pokhara = (await call("owner", "GET", "/branches")).json().data.branches.find((b: { name: string }) => b.name === "Pokhara");
    expect(pokhara).toMatchObject({ rooms: 1, staff: 2 }); // the desk, plus the owner (all branches)
    expect((await call("owner", "PATCH", `/branches/${pokhara.id}`, { name: "Pokhara Lakeside" })).statusCode).toBe(200);
    expect(await names("desk")).toEqual(["Pokhara Lakeside"]);
    expect((await call("desk", "GET", "/rooms")).json().data[0].branch).toBe("Pokhara Lakeside");
  });

  it("keeps an open branch, and won't remove a branch with work in it or someone's only branch", async () => {
    expect((await call("owner", "DELETE", `/branches/${await idOf("Chitwan")}`)).json().message).toContain("1 room");
    expect((await call("owner", "POST", "/branches", { name: "Empty" })).statusCode).toBe(200);
    expect((await call("owner", "PATCH", `/team/members/${ids.desk}`, { scopes: ["Empty"] })).statusCode).toBe(200);
    const del = await call("owner", "DELETE", `/branches/${await idOf("Empty")}`);
    expect(del.json().message).toContain("only works at Empty");
    expect((await call("owner", "PATCH", `/team/members/${ids.desk}`, { scopes: ["Pokhara Lakeside", "Empty"] })).statusCode).toBe(200);
    expect((await call("owner", "DELETE", `/branches/${await idOf("Empty")}`)).statusCode).toBe(200);
    expect(await names("desk")).toEqual(["Pokhara Lakeside"]);
    expect((await call("owner", "PATCH", `/branches/${await idOf("Chitwan")}`, { status: "closed" })).statusCode).toBe(200);
    expect((await call("owner", "PATCH", `/branches/${await idOf("Pokhara Lakeside")}`, { status: "closed" })).statusCode).toBe(200);
    expect((await call("owner", "PATCH", `/branches/${await idOf("Head office")}`, { status: "closed" })).statusCode).toBe(400); // the last open one
  });

  it("won't remove a branch with an open request to sell on other sites; a paused one doesn't block", async () => {
    expect((await call("owner", "POST", "/branches", { name: "Sites" })).statusCode).toBe(200);
    const branchId = await idOf("Sites");
    const r = await app.db!.otaRequest.create({ data: { tenantId: ids.hotel!, branchId, channel: "booking", status: "requested" } });
    const del = await call("owner", "DELETE", `/branches/${branchId}`);
    expect(del.statusCode).toBe(400);
    expect(del.json().message).toContain("1 other-site request");
    await app.db!.otaRequest.update({ where: { id: r.id }, data: { status: "paused" } });
    expect((await call("owner", "DELETE", `/branches/${branchId}`)).statusCode).toBe(200);
  });
});

describe("listings and leads per branch", () => {
  it("puts a new listing in the branch open in the panel, or the one picked", async () => {
    expect((await call("owner", "POST", "/branches", { name: "Baneshwor" }, ids.realty)).statusCode).toBe(200);
    const [head, baneshwor] = [await idOf("Head office", ids.realty), await idOf("Baneshwor", ids.realty)];
    expect((await call("owner", "POST", "/listings", draft("Head office flat"), ids.realty, head)).json().data.branch).toBe("Head office");
    expect((await call("owner", "POST", "/listings", draft("Baneshwor house"), ids.realty, baneshwor)).json().data.branch).toBe("Baneshwor");
    expect((await call("owner", "POST", "/listings", draft("Picked land", baneshwor), ids.realty, "all")).json().data.branch).toBe("Baneshwor");
    // A brand-new branch starts empty; each branch sees its own; all branches sees all.
    expect(await titles("owner", ids.realty, baneshwor)).toEqual(["Baneshwor house", "Picked land"]);
    expect(await titles("owner", ids.realty, head)).toEqual(["Head office flat"]);
    expect(await titles("owner", ids.realty, "all")).toHaveLength(3);
  });

  it("shows staff only their branches' listings, even with all branches picked", async () => {
    const baneshwor = await idOf("Baneshwor", ids.realty);
    expect((await call("owner", "PATCH", `/team/members/${ids.agent}`, { scopes: ["Baneshwor"] }, ids.realty)).statusCode).toBe(200);
    expect(await titles("agent", ids.realty)).toEqual(["Baneshwor house", "Picked land"]);
    expect(await titles("agent", ids.realty, "all")).toEqual(["Baneshwor house", "Picked land"]);
    expect((await call("agent", "GET", "/listings/PR-0001", undefined, ids.realty)).statusCode).toBe(404); // head office's
    expect((await call("agent", "POST", "/listings", draft("Sneaky", await idOf("Head office", ids.realty)), ids.realty)).statusCode).toBe(403);
    expect((await call("agent", "POST", "/listings", draft("Agent flat"), ids.realty)).json().data.branchId).toBe(baneshwor); // their only branch
  });

  it("moves a listing to another branch with its leads", async () => {
    const head = await idOf("Head office", ids.realty);
    const l = await app.db!.listing.findFirstOrThrow({ where: { code: "PR-0001" } });
    await app.db!.lead.create({ data: { tenantId: ids.realty, branchId: head, listingId: l.id, kind: "contact_agent", name: "Gita" } });
    expect((await call("agent", "GET", "/leads", undefined, ids.realty)).json().data).toEqual([]); // head office's lead
    const values = (await call("owner", "GET", "/listings/PR-0001", undefined, ids.realty)).json().data.values;
    await call("owner", "PATCH", "/listings/PR-0001", { kind: "sell", submit: false, values, summary: { title: "Head office flat" }, branchId: await idOf("Baneshwor", ids.realty) }, ids.realty);
    expect((await call("agent", "GET", "/leads", undefined, ids.realty)).json().data.map((x: { name: string; branch: string }) => [x.name, x.branch])).toEqual([["Gita", "Baneshwor"]]);
  });

  it("only hands a lead to someone who works at its branch", async () => {
    await call("owner", "PATCH", `/team/members/${ids.agent}`, { scopes: ["Head office"] }, ids.realty);
    const lead = (await call("owner", "GET", "/leads", undefined, ids.realty)).json().data[0];
    const r = await call("owner", "PATCH", `/leads/${lead.id}`, { assignee: ids.agent }, ids.realty);
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toContain("don't work at Baneshwor");
  });
});

describe("across businesses", () => {
  it("gives each person their own role in each business, and nothing in others", async () => {
    // The desk is front desk at the hotel and nobody at the realty.
    expect((await call("desk", "GET", "/listings", undefined, ids.realty)).statusCode).toBe(403);
    expect((await call("desk", "GET", "/branches", undefined, ids.realty)).statusCode).toBe(403);
    // A branch id from another business is refused.
    expect((await call("owner", "GET", "/rooms", undefined, ids.hotel, await idOf("Baneshwor", ids.realty))).statusCode).toBe(403);
    // The owner owns both; the agent's role applies only at the realty.
    const ws = (await call("owner", "GET", "/workspaces")).json().data.workspaces;
    expect(ws.map((w: { name: string; role: { key: string } }) => [w.name, w.role.key]).sort()).toEqual([["Peak Hotels", "owner"], ["Peak Realty", "owner"]]);
    expect((await call("agent", "GET", "/workspaces")).json().data.workspaces.map((w: { name: string; role: { key: string } }) => [w.name, w.role.key])).toEqual([["Peak Realty", "agent"]]);
    expect((await call("agent", "GET", "/rooms", undefined, ids.hotel)).statusCode).toBe(403);
  });
});

describe("reviews", () => {
  it("lists the business's reviews by branch, replies in public and tells the reviewer", async () => {
    const db = app.db!;
    const buyer = await db.user.create({ data: { email: "buyer@peak.test", userName: "Sita" } });
    const listings = await db.listing.findMany({ where: { tenantId: ids.realty }, select: { id: true, title: true, branchId: true } });
    const baneshwor = listings.find((l) => l.title === "Baneshwor house")!;
    const flat = listings.find((l) => l.title === "Head office flat")!;
    await db.review.createMany({ data: [
      { userId: buyer.id, tenantId: ids.realty!, rating: 5, comment: "Very helpful agency" },
      { userId: buyer.id, listingId: baneshwor.id, rating: 2, comment: "Photos were old" },
      { userId: (await db.user.create({ data: { email: "x@peak.test", userName: "Hari" } })).id, listingId: flat.id, rating: 4, comment: "Nice flat" },
    ] });
    const all = (await call("owner", "GET", "/reviews", undefined, ids.realty, "all")).json();
    expect(all.meta).toMatchObject({ count: 3, unanswered: 3, average: 3.7, canReply: true });
    // One branch: the business's own review plus that branch's listings (both reviewed listings are at Baneshwor now).
    const head = (await call("owner", "GET", "/reviews", undefined, ids.realty, await idOf("Head office", ids.realty))).json().data;
    expect(head.map((r: { comment: string }) => r.comment)).toEqual(["Very helpful agency"]);
    const one = (await call("owner", "GET", "/reviews", undefined, ids.realty, await idOf("Baneshwor", ids.realty))).json().data;
    expect(one).toHaveLength(3);
    expect((await call("owner", "GET", "/reviews?show=low", undefined, ids.realty, "all")).json().data.map((r: { rating: number }) => r.rating)).toEqual([2]);

    const low = one.find((r: { rating: number }) => r.rating === 2);
    const rep = await call("owner", "POST", `/reviews/${low.id}/reply`, { text: "Sorry, Sita. New photos are up." }, ids.realty, "all");
    expect(rep.statusCode).toBe(200);
    expect(await db.review.findUniqueOrThrow({ where: { id: low.id } })).toMatchObject({ reply: "Sorry, Sita. New photos are up.", repliedBy: ids.owner });
    expect(await db.notification.findFirst({ where: { userId: buyer.id, type: "review_reply" } })).toMatchObject({ title: "Peak Realty replied to your review", tenantId: null });
    expect((await call("owner", "GET", "/reviews?show=unanswered", undefined, ids.realty, "all")).json().meta.unanswered).toBe(2);
    // Taking the reply down.
    await call("owner", "POST", `/reviews/${low.id}/reply`, { text: "" }, ids.realty, "all");
    expect((await db.review.findUniqueOrThrow({ where: { id: low.id } })).reply).toBeNull();
    // Someone else's business's review is out of reach; the hotel desk has no access here.
    expect((await call("owner", "POST", `/reviews/${low.id}/reply`, { text: "x" }, ids.hotel)).statusCode).toBe(404);
    expect((await call("desk", "GET", "/reviews", undefined, ids.realty)).statusCode).toBe(403);
  });
});
