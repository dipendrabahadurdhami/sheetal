// Tests for the team on the kernel (P2-W6, Workspace part 2): what the move to apps/workspace/backend added. team.test.ts, tenancy.test.ts, branches.test.ts
// and demo.test.ts (the old tests) are NOT repeated here and pass unchanged.
// Where it fits: runs with the business API tests (needs the throwaway PostgreSQL started by platform/test/setup-db.ts): npm run test -w @sheetal/business-api
// Rules: covers every team change writing its audit line AND its event in one step (and neither on a refusal), isolation (another business's members,
// roles and invitations are "not found"), the permission refusals with a role saved in the new names only, the owner rules, a read-only support session
// and a write-mode support session (never invites, changes or removes people or roles). Team rows have no version column and no soft delete.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {} from "@sheetal/platform/test/setup-db";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@sheetal/platform/core/config";
import { makeTestContext } from "@sheetal/platform/core/testing/context";
import { buildImpersonationPermissions } from "@sheetal/platform/tenancy/context";
import { PLANS } from "@sheetal/backend-core/domain/plans";
import { createWorkspace } from "@sheetal/backend-core/modules/accounts/workspace";
import { createSession } from "@sheetal/backend-core/modules/auth/sessions";
import { TeamService } from "@sheetal/app-workspace/backend/team.service";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;
const tok: Record<string, string> = {};
const ids: Record<string, string> = {};
const call = (who: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: object, tenant?: string) =>
  app.inject({ method, url: `/v1${url}`, payload: body, headers: { authorization: `Bearer ${tok[who]}`, "x-tenant-id": tenant ?? ids.biz! } });
const events = (name: string, tenantId = ids.biz) => app.db!.eventOutbox.count({ where: { tenantId, name } });
const audits = (action: string, tenantId = ids.biz) => app.db!.auditLog.count({ where: { tenantId, action } });
const roleId = async (key: string, tenant = ids.biz) => (await app.db!.role.findFirstOrThrow({ where: { tenantId: tenant, key } })).id;
const lastLink = async (to: string) => (await app.db!.outboundEmail.findFirstOrThrow({ where: { to }, orderBy: { createdAt: "desc" } })).text.match(/token=([A-Za-z0-9_-]+)/)![1]!;

async function person(key: string) {
  const u = await app.db!.user.create({ data: { email: `${key}@kernel-team.test`, userName: `kt-${key}`, emailVerifiedAt: new Date() } });
  ids[key] = u.id;
  tok[key] = await createSession(app, u.id, { ip: "127.0.0.1", headers: {} } as never);
}
async function join(key: string, role: string, tenant = ids.biz!) {
  await call("owner", "POST", "/team/invites", { invites: [{ email: `${key}@kernel-team.test`, roleId: await roleId(role, tenant) }] }, tenant);
  expect((await call(key, "POST", "/invites/accept", { token: await lastLink(`${key}@kernel-team.test`) })).statusCode).toBe(200);
}

beforeAll(async () => {
  app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: inject("databaseUrl"), SITE_URL: "https://sheetal.test" }, "business"));
  const db = app.db!;
  await db.$executeRawUnsafe(`TRUNCATE users, tenants, plans, audit_logs, event_outbox, outbound_emails RESTART IDENTITY CASCADE`);
  for (const p of PLANS) await db.plan.create({ data: { id: p.id, type: p.type, name: p.name, price: p.price, limits: p.limits, features: p.features, sort: p.sort } });
  for (const k of ["owner", "other", "maya", "ram", "gita"]) await person(k);
  ids.biz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.owner!, name: "Everest Realty", type: "agency", planId: "agency-business" }))).id;
  ids.otherBiz = (await db.$transaction((tx) => createWorkspace(tx, { ownerId: ids.other!, name: "Other Realty", type: "agency", planId: "agency-business" }))).id;
});
afterAll(async () => { await app.close(); });

describe("team changes on the kernel: audit line and event together", () => {
  it("an invitation, a resend, a cancel and an accepted invitation each write both", async () => {
    const r = await call("owner", "POST", "/team/invites", { invites: [{ email: "maya@kernel-team.test", roleId: await roleId("agent") }] });
    expect(r.json().message).toBe("Invitation sent to maya@kernel-team.test.");
    expect([await audits("team.invited"), await events("workspace.invite.sent")]).toEqual([1, 1]);
    const inv = await app.db!.invite.findFirstOrThrow({ where: { tenantId: ids.biz, email: "maya@kernel-team.test", status: "pending" } });
    expect(inv.invitedBy).toBe(ids.owner);
    expect((await call("owner", "POST", `/team/invites/${inv.id}/resend`)).statusCode).toBe(200);
    expect([await audits("team.invite_resent"), await events("workspace.invite.sent")]).toEqual([1, 2]);
    expect((await call("maya", "POST", "/invites/accept", { token: await lastLink("maya@kernel-team.test") })).json().message).toBe("Welcome to Everest Realty.");
    expect([await audits("team.joined"), await events("workspace.member.joined")]).toEqual([1, 1]);
    // A second invitation for someone, then cancelled.
    await call("owner", "POST", "/team/invites", { invites: [{ email: "ram@kernel-team.test", roleId: await roleId("agent") }] });
    const ram = await app.db!.invite.findFirstOrThrow({ where: { tenantId: ids.biz, email: "ram@kernel-team.test", status: "pending" } });
    expect((await call("owner", "POST", `/team/invites/${ram.id}/revoke`)).json().message).toBe("Invitation cancelled.");
    expect([await audits("team.invite_revoked"), await events("workspace.invite.revoked")]).toEqual([1, 1]);
    // Cancelling it again: not found, and nothing more is written.
    expect((await call("owner", "POST", `/team/invites/${ram.id}/revoke`)).statusCode).toBe(404);
    expect([await audits("team.invite_revoked"), await events("workspace.invite.revoked")]).toEqual([1, 1]);
  });

  it("a member change, roles, profile and branding each write both", async () => {
    expect((await call("owner", "PATCH", `/team/members/${ids.maya}`, { roleId: await roleId("branch_manager") })).statusCode).toBe(200);
    expect([await audits("team.updated"), await events("workspace.member.updated")]).toEqual([1, 1]);
    const made = await call("owner", "POST", "/team/roles", { name: "Photographer", perms: ["workspace.team.read"] });
    expect(made.statusCode).toBe(200);
    expect((await call("owner", "PATCH", `/team/roles/${made.json().data.id}`, { name: "Photos" })).json().message).toBe("Role saved.");
    expect((await call("owner", "DELETE", `/team/roles/${made.json().data.id}`)).json().message).toBe("Role deleted.");
    expect([await events("workspace.role.created"), await events("workspace.role.updated"), await events("workspace.role.deleted")]).toEqual([1, 1, 1]);
    expect([await audits("role.created"), await audits("role.updated"), await audits("role.deleted")]).toEqual([1, 1, 1]);
    expect((await call("owner", "PATCH", "/workspace/profile", { city: "Lalitpur" })).statusCode).toBe(200);
    expect([await audits("business.profile_updated"), await events("workspace.profile.saved")]).toEqual([1, 1]);
    expect((await call("owner", "PUT", "/workspace/branding", { colors: ["#9d1d21"] })).json().data.brandColors).toEqual(["#9D1D21"]);
    expect([await audits("settings.branding"), await events("workspace.branding.saved")]).toEqual([1, 1]);
  });

  it("a refused change writes neither", async () => {
    const before = [await app.db!.auditLog.count(), await app.db!.eventOutbox.count()];
    // The last owner can't step down, and the owner role can't be edited.
    expect((await call("owner", "PATCH", `/team/members/${ids.owner}`, { status: "paused" })).statusCode).toBe(400);
    expect((await call("owner", "PATCH", `/team/roles/${await roleId("owner")}`, { perms: [] })).statusCode).toBe(400);
    expect((await call("owner", "POST", "/team/roles", { name: "Bad", perms: ["no.such.permission"] })).statusCode).toBe(400);
    expect([await app.db!.auditLog.count(), await app.db!.eventOutbox.count()]).toEqual(before);
  });

  it("adding a business writes its line and event on the new business", async () => {
    const r = await call("ram", "POST", "/workspaces", { name: "Ram Homestay", type: "host" });
    expect(r.json().message).toBe("Ram Homestay is ready.");
    const id = r.json().data.id as string;
    expect([await audits("business.created", id), await events("workspace.business.created", id)]).toEqual([1, 1]);
  });
});

describe("isolation: another business's team is not found", () => {
  it("can't change, remove, resend or cancel across businesses", async () => {
    await call("other", "POST", "/team/invites", { invites: [{ email: "gita@kernel-team.test", roleId: await roleId("agent", ids.otherBiz) }] }, ids.otherBiz);
    const theirs = await app.db!.invite.findFirstOrThrow({ where: { tenantId: ids.otherBiz, status: "pending" } });
    expect((await call("owner", "POST", `/team/invites/${theirs.id}/resend`)).statusCode).toBe(404);
    expect((await call("owner", "POST", `/team/invites/${theirs.id}/revoke`)).statusCode).toBe(404);
    expect((await call("owner", "PATCH", `/team/members/${ids.other}`, { status: "paused" })).statusCode).toBe(404);
    expect((await call("owner", "DELETE", `/team/members/${ids.other}`)).statusCode).toBe(404);
    expect((await call("owner", "PATCH", `/team/roles/${await roleId("agent", ids.otherBiz)}`, { name: "Mine" })).statusCode).toBe(404);
    expect((await call("owner", "DELETE", `/team/roles/${await roleId("agent", ids.otherBiz)}`)).statusCode).toBe(404);
    // Nor send someone to my business with the other business's role, nor read the other business's team without being in it.
    expect((await call("owner", "POST", "/team/invites", { invites: [{ email: "x@kernel-team.test", roleId: await roleId("agent", ids.otherBiz) }] })).statusCode).toBe(400);
    expect((await call("owner", "GET", "/team", undefined, ids.otherBiz)).statusCode).toBe(403);
    // The other business's people and invitations never show on my Team page.
    const page = (await call("owner", "GET", "/team")).json().data;
    expect(page.members.map((m: { id: string }) => m.id)).not.toContain(ids.other);
    expect(page.invites.map((i: { email: string }) => i.email)).not.toContain("gita@kernel-team.test");
    expect(await app.db!.invite.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({ status: "pending" });
  });
});

describe("permissions, with roles saved in the new names only", () => {
  it("a role with only 'see the team' sees the team, but neither roles nor the business settings", async () => {
    const seer = await call("owner", "POST", "/team/roles", { name: "Team viewer", perms: ["workspace.team.read"] });
    await join("gita", "agent");
    expect((await call("owner", "PATCH", `/team/members/${ids.gita}`, { roleId: seer.json().data.id })).statusCode).toBe(200);
    expect((await call("gita", "GET", "/team")).statusCode).toBe(200);
    expect((await call("gita", "POST", "/team/roles", { name: "Mine", perms: [] })).statusCode).toBe(403);
    expect((await call("gita", "PATCH", "/workspace/profile", { city: "Bhaktapur" })).statusCode).toBe(403);
    expect((await call("gita", "PUT", "/workspace/branding", { colors: ["#111111"] })).statusCode).toBe(403);
    expect((await call("gita", "POST", "/workspace/cover", { on: true })).statusCode).toBe(403);   // owners only
  });

  it("a plain agent can't invite, change or remove people, or touch roles; anyone can leave", async () => {
    await join("ram", "agent");
    expect((await call("ram", "POST", "/team/invites", { invites: [{ email: "y@kernel-team.test", roleId: await roleId("agent") }] })).statusCode).toBe(403);
    expect((await call("ram", "PATCH", `/team/members/${ids.maya}`, { status: "paused" })).statusCode).toBe(403);
    expect((await call("ram", "DELETE", `/team/members/${ids.maya}`)).statusCode).toBe(403);
    expect((await call("ram", "DELETE", `/team/roles/${await roleId("agent")}`)).statusCode).toBe(403);
    expect((await call("ram", "GET", "/team")).json().data.invites).toEqual([]);   // pending invitations are for people who manage the team
    expect((await call("ram", "DELETE", `/team/members/${ids.ram}`)).json().message).toBe("You left the business.");
    const left = await app.db!.eventOutbox.findFirstOrThrow({ where: { tenantId: ids.biz, name: "workspace.member.removed" }, orderBy: { createdAt: "desc" } });
    expect(left.payload).toMatchObject({ userId: ids.ram, left: true });
  });

  it("a manager who isn't an owner can't make, change or remove an owner", async () => {
    expect((await call("maya", "PATCH", `/team/members/${ids.gita}`, { roleId: await roleId("owner") })).statusCode).toBe(403);
    expect((await call("maya", "PATCH", `/team/members/${ids.owner}`, { status: "paused" })).statusCode).toBe(403);
    expect((await call("maya", "DELETE", `/team/members/${ids.owner}`)).statusCode).toBe(403);
  });
});

describe("Sheetal support sessions", () => {
  const svc = () => new TeamService({ bus: app.events!.bus, db: app.db!, siteUrl: "https://sheetal.test", mediaDir: "/tmp", mediaBase: "/media", mail: async () => undefined });
  const staff = (readOnly: boolean) => ({
    ...makeTestContext({ db: app.db!, businessId: ids.biz!, branches: [], userId: "support-1", isOwner: false }),
    actor: { kind: "staff" as const, staffId: "support-1", name: "Support", role: "support" },
    member: { userId: "support-1", membershipId: "", roleId: "", roleKey: "support", isOwner: false },
    permissions: buildImpersonationPermissions(),
    impersonation: { staffId: "support-1", reason: "customer asked for help", expiresAt: new Date(Date.now() + 15 * 60_000), readOnly },
  });
  const counts = async () => [await app.db!.auditLog.count(), await app.db!.eventOutbox.count(), await app.db!.invite.count(), await app.db!.role.count(), await app.db!.membership.count()];

  it("read-only: can read the Team page, and is refused on every change before anything else", async () => {
    const REFUSED = { statusCode: 403, message: "This is a read-only support session. Changes are not allowed." };
    const s = svc(), ctx = staff(true), before = await counts();
    await expect(s.teamPage(ctx)).resolves.toMatchObject({ invites: [] });
    for (const [what, run] of [
      ["invite", () => s.invite(ctx, { invites: [{ email: "z@kernel-team.test", roleId: "x" }] })],
      ["resend", () => s.resendInvite(ctx, "x")], ["revoke", () => s.revokeInvite(ctx, "x")],
      ["change member", () => s.editMember(ctx, ids.maya!, { status: "paused" })], ["remove member", () => s.removeMember(ctx, ids.maya!)],
      ["add role", () => s.addRole(ctx, { name: "Helpers", perms: [] })], ["change role", () => s.editRole(ctx, "x", { name: "y" })], ["delete role", () => s.deleteRole(ctx, "x")],
      ["profile", () => s.saveProfile(ctx, { city: "Pokhara" })], ["branding", () => s.saveBranding(ctx, { colors: ["#111111"] })], ["cover", () => s.cover(ctx, null, { on: true })],
    ] as const) await expect(run(), what).rejects.toMatchObject(REFUSED);
    expect(await counts()).toEqual(before);
  });

  it("write mode: still never invites, changes or removes people or roles", async () => {
    const s = svc(), ctx = staff(false), before = await counts();
    for (const [what, run] of [
      ["invite", () => s.invite(ctx, { invites: [{ email: "z@kernel-team.test", roleId: "x" }] })],
      ["change member", () => s.editMember(ctx, ids.maya!, { status: "paused" })], ["remove member", () => s.removeMember(ctx, ids.maya!)],
      ["add role", () => s.addRole(ctx, { name: "Helpers", perms: [] })], ["delete role", () => s.deleteRole(ctx, "x")],
    ] as const) await expect(run(), what).rejects.toMatchObject({ statusCode: 403 });
    expect(await counts()).toEqual(before);
  });
});
