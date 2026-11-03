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
const call = (who: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: object, tenant = ids.hotel) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant! } });
async function person(key: string, email: string) {
  const u = await app.db!.user.create({ data: { email, userName: key, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const names = async (who: string, tenant?: string) => (await call(who, "GET", "/branches", undefined, tenant)).json().data.branches.map((b: { name: string }) => b.name);

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, rooms, bookings, outbound_emails, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  await person("owner", "owner@peak.test");
  await person("desk", "desk@peak.test");
  ids.hotel = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Peak Hotels", type: "hotel", planId: "hotel-business" }))).id;
  ids.devco = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Peak Builders", type: "developer", planId: "developer-business" }))).id;
  ids.frontdesk = (await db.role.findFirstOrThrow({ where: { tenantId: ids.hotel, key: "frontdesk" } })).id;
  await db.membership.create({ data: { tenantId: ids.hotel, userId: ids.desk!, roleId: ids.frontdesk, status: "active" } });
});
afterAll(async () => { await app.close(); });

describe("branches", () => {
  it("starts every business with a head office", async () => {
    expect(await names("owner")).toEqual(["Head office"]);
    expect(await names("owner", ids.devco)).toEqual(["Head office"]);
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
    await call("owner", "POST", "/rooms", { type: "Deluxe", rate: 6000, nos: ["P1"], branch: "Pokhara" });
    await call("owner", "POST", "/rooms", { type: "Deluxe", rate: 6000, nos: ["C1"], branch: "Chitwan" });
    expect((await call("owner", "POST", "/rooms", { type: "Deluxe", rate: 6000, nos: ["X1"], branch: "Nowhere" })).statusCode).toBe(400);

    // The desk sees only Pokhara: its branches, rooms, and can't touch a Chitwan room.
    expect(await names("desk")).toEqual(["Pokhara"]);
    const ws = (await call("desk", "GET", "/workspaces")).json().data.workspaces[0];
    expect(ws.scopes).toEqual(["Pokhara"]);
    const rooms = (await call("desk", "GET", "/rooms")).json().data;
    expect(rooms.map((r: { no: string }) => r.no)).toEqual(["P1"]);
    const chitwan = (await call("owner", "GET", "/rooms")).json().data.find((r: { no: string }) => r.no === "C1").id;
    expect((await call("desk", "PATCH", `/rooms/${chitwan}`, { status: "dirty" })).statusCode).toBe(404);
    const bk = await call("owner", "POST", "/bookings", { type: "Deluxe", roomId: chitwan, guest: "Sita", from: day(0), to: day(1) });
    expect((await call("desk", "GET", `/bookings/${bk.json().data.id}`)).statusCode).toBe(404);
    expect((await call("desk", "GET", "/bookings")).json().data).toEqual([]);
    // Owners always see everything.
    expect((await call("owner", "GET", "/workspaces")).json().data.workspaces.find((w: { id: string }) => w.id === ids.hotel).scopes).toBe("all");
  });

  it("renames a branch everywhere it is used", async () => {
    const pokhara = (await call("owner", "GET", "/branches")).json().data.branches.find((b: { name: string }) => b.name === "Pokhara");
    expect(pokhara).toMatchObject({ rooms: 1, staff: 2 }); // the desk, plus the owner (all branches)
    expect((await call("owner", "PATCH", `/branches/${pokhara.id}`, { name: "Pokhara Lakeside" })).statusCode).toBe(200);
    expect(await names("desk")).toEqual(["Pokhara Lakeside"]);
    expect((await call("desk", "GET", "/rooms")).json().data[0].branch).toBe("Pokhara Lakeside");
  });

  it("keeps an open branch, and won't remove a branch with rooms or someone's only branch", async () => {
    const list = (await call("owner", "GET", "/branches")).json().data.branches;
    const id = (n: string) => list.find((b: { name: string }) => b.name === n).id;
    expect((await call("owner", "DELETE", `/branches/${id("Chitwan")}`)).statusCode).toBe(400); // has a room
    expect((await call("owner", "DELETE", `/branches/${id("Pokhara Lakeside")}`)).statusCode).toBe(400); // has a room
    await app.db!.room.deleteMany({ where: { tenantId: ids.hotel, branch: "Pokhara Lakeside" } });
    const del = await call("owner", "DELETE", `/branches/${id("Pokhara Lakeside")}`);
    expect(del.statusCode).toBe(400);
    expect(del.json().message).toContain("only works at Pokhara Lakeside"); // the desk's only branch
    expect((await call("owner", "PATCH", `/team/members/${ids.desk}`, { scopes: ["Head office", "Pokhara Lakeside"] })).statusCode).toBe(200);
    expect((await call("owner", "DELETE", `/branches/${id("Pokhara Lakeside")}`)).statusCode).toBe(200);
    expect(await names("desk")).toEqual(["Head office"]);
    // Close all but one: the last open one stays.
    expect((await call("owner", "PATCH", `/branches/${id("Chitwan")}`, { status: "closed" })).statusCode).toBe(200);
    expect((await call("owner", "PATCH", `/branches/${id("Head office")}`, { status: "closed" })).statusCode).toBe(400);
  });
});
