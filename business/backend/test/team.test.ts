import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
// Brings in the test database declaration (inject("databaseUrl")).
import type {} from "@sheetal/backend-core/test/setup-db";
import type { FastifyInstance } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "@sheetal/backend-core/config";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};

const call = (who: string | null, method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT", url: string, body?: object, tenant = ids.tenant) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { ...(who ? { authorization: `Bearer ${tok[who]}` } : {}), ...(tenant ? { "x-tenant-id": tenant } : {}) } });

async function person(key: string, email: string) {
  const u = await app.db!.user.create({ data: { email, userName: key, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
const lastLink = async (to: string) => {
  const m = await app.db!.outboundEmail.findFirstOrThrow({ where: { to }, orderBy: { createdAt: "desc" } });
  return m.text.match(/token=([A-Za-z0-9_-]+)/)![1]!;
};
const roleId = async (key: string, tenant = ids.tenant) => (await app.db!.role.findFirstOrThrow({ where: { tenantId: tenant, key } })).id;

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test", MEDIA_DIR: mkdtempSync(join(tmpdir(), "sheetal-brand-")) }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, outbound_emails, audit_logs RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const [k, e] of [["owner", "owner@everest.test"], ["sita", "sita@everest.test"], ["hari", "hari@everest.test"], ["solo", "solo@small.test"]]) await person(k!, e!);
  ids.tenant = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.small = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.solo!, name: "Small Agency", type: "agency" }))).id;
});
afterAll(async () => { await app.close(); });

describe("workspaces", () => {
  it("lists the person's businesses with plan and role", async () => {
    const d = (await call("owner", "GET", "/workspaces", undefined, "")).json().data;
    expect(d.user).toMatchObject({ email: "owner@everest.test" });
    expect(d.workspaces).toEqual([expect.objectContaining({ id: ids.tenant, name: "Everest Realty", plan: expect.objectContaining({ name: "Business" }), role: expect.objectContaining({ key: "owner", perms: ["*"] }) })]);
  });
});

describe("branding", () => {
  it("saves the logo and up to 4 colours for the whole business, for people who manage settings", async () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex").toString("base64");
    const r = await call("owner", "PUT", "/workspace/branding", { logo: png, colors: ["#0a7d3b", "#F2A900", "#0A7D3B"] });
    expect(r.json().data).toMatchObject({ logoUrl: expect.stringContaining("/brand/main/"), brandColors: ["#0A7D3B", "#F2A900"] });
    expect((await call("owner", "PUT", "/workspace/branding", { colors: ["red"] })).statusCode).toBe(422);
    expect((await call("owner", "PUT", "/workspace/branding", { colors: ["#111111", "#222222", "#333333", "#444444", "#555555"] })).statusCode).toBe(422);
    const ws = (await call("owner", "GET", "/workspaces", undefined, "")).json().data.workspaces[0];
    expect(ws).toMatchObject({ brandColors: ["#0A7D3B", "#F2A900"], logoUrl: expect.stringContaining("/brand/") });
    // Starter keeps Sheetal's look.
    expect((await call("solo", "PUT", "/workspace/branding", { colors: ["#123456"] }, ids.small)).statusCode).toBe(402);
  });
});

describe("invitations", () => {
  it("invites by email, and the invited person accepts with that email", async () => {
    const res = await call("owner", "POST", "/team/invites", { invites: [{ email: "Sita@Everest.test", roleId: await roleId("agent") }] });
    expect(res.statusCode).toBe(200);
    const token = await lastLink("sita@everest.test");
    expect((await call(null, "GET", `/invites/preview?token=${token}`)).json().data).toMatchObject({ business: "Everest Realty", role: "agent", email: "sita@everest.test" });
    expect((await call("hari", "POST", "/invites/accept", { token })).statusCode).toBe(403); // someone else's link
    expect((await call("sita", "POST", "/invites/accept", { token })).json().message).toBe("Welcome to Everest Realty.");
    expect((await call("sita", "POST", "/invites/accept", { token })).statusCode).toBe(410); // used once only
    const team = (await call("owner", "GET", "/team")).json().data;
    expect(team.members.map((m: { name: string }) => m.name)).toEqual(["owner", "sita"]);
    expect(team.seats).toMatchObject({ used: 2, limit: 10 });
    expect(team.activity.map((a: { what: string }) => a.what)).toContain("team.joined");
  });

  it("resends with a new link (the old one stops working) and cancels", async () => {
    await call("owner", "POST", "/team/invites", { invites: [{ email: "hari@everest.test", roleId: await roleId("accountant") }] });
    const first = await lastLink("hari@everest.test");
    const inv = (await call("owner", "GET", "/team")).json().data.invites[0];
    await call("owner", "POST", `/team/invites/${inv.id}/resend`);
    const second = await lastLink("hari@everest.test");
    expect(second).not.toBe(first);
    expect((await call(null, "GET", `/invites/preview?token=${first}`)).statusCode).toBe(410);
    await call("owner", "POST", `/team/invites/${inv.id}/revoke`);
    expect((await call("hari", "POST", "/invites/accept", { token: second })).statusCode).toBe(410);
  });

  it("only lets team managers invite, and keeps Starter to one person", async () => {
    expect((await call("sita", "POST", "/team/invites", { invites: [{ email: "x@y.test", roleId: await roleId("agent") }] })).statusCode).toBe(403);
    const res = await call("solo", "POST", "/team/invites", { invites: [{ email: "x@y.test", roleId: await roleId("agent", ids.small) }] }, ids.small);
    expect(res.statusCode).toBe(402);
    expect(res.json().message).toContain("just you");
  });

  it("won't invite someone already in the team, or give a role from another business", async () => {
    expect((await call("owner", "POST", "/team/invites", { invites: [{ email: "sita@everest.test", roleId: await roleId("agent") }] })).statusCode).toBe(409);
    expect((await call("owner", "POST", "/team/invites", { invites: [{ email: "new@x.test", roleId: await roleId("agent", ids.small) }] })).statusCode).toBe(400);
  });
});

describe("members", () => {
  it("changes a role and pauses someone", async () => {
    expect((await call("owner", "PATCH", `/team/members/${ids.sita}`, { roleId: await roleId("branch_manager"), status: "paused" })).statusCode).toBe(200);
    const m = (await call("owner", "GET", "/team")).json().data.members.find((x: { id: string }) => x.id === ids.sita);
    expect(m).toMatchObject({ status: "paused", roleId: await roleId("branch_manager") });
    await call("owner", "PATCH", `/team/members/${ids.sita}`, { status: "active" });
  });

  it("always keeps an active owner, and only owners make owners", async () => {
    expect((await call("owner", "PATCH", `/team/members/${ids.owner}`, { roleId: await roleId("agent") })).statusCode).toBe(400);
    expect((await call("owner", "DELETE", `/team/members/${ids.owner}`)).statusCode).toBe(400);
    expect((await call("sita", "PATCH", `/team/members/${ids.sita}`, { roleId: await roleId("owner") })).statusCode).toBe(403);
  });

  it("lets people leave, and managers remove people", async () => {
    expect((await call("sita", "DELETE", `/team/members/${ids.sita}`)).json().message).toBe("You left the business.");
    expect((await call("sita", "GET", "/team")).statusCode).toBe(403);
  });
});

describe("roles", () => {
  it("creates a role with this business's permissions only", async () => {
    expect((await call("owner", "POST", "/team/roles", { name: "Photographer", perms: ["listings.manage", "pos.restaurant"] })).statusCode).toBe(400);
    const res = await call("owner", "POST", "/team/roles", { name: "Photographer", perms: ["listings.manage"] });
    expect(res.statusCode).toBe(200);
    const roles = (await call("owner", "GET", "/team")).json().data.roles;
    expect(roles.find((r: { name: string }) => r.name === "Photographer")).toMatchObject({ perms: ["listings.manage"], system: false });
    ids.photoRole = res.json().data.id;
  });

  it("keeps the owner role fixed and built-in roles in place", async () => {
    expect((await call("owner", "PATCH", `/team/roles/${await roleId("owner")}`, { perms: [] })).statusCode).toBe(400);
    expect((await call("owner", "DELETE", `/team/roles/${await roleId("agent")}`)).statusCode).toBe(400);
    expect((await call("owner", "DELETE", `/team/roles/${ids.photoRole}`)).statusCode).toBe(200);
  });

  it("needs a plan with custom roles", async () => {
    expect((await call("solo", "POST", "/team/roles", { name: "Helper", perms: [] }, ids.small)).statusCode).toBe(402);
  });
});
