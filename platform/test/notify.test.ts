// Tests of the notifications code that moved to platform/src/notify (P1-BE-4), on a stand-in database: no PostgreSQL needed.
// Where it fits: backend-core/src/lib/notify.ts re-exports these functions, so the many callers are unchanged; this file keeps the
// behaviour pinned: who gets a note, how long a note may be, which staff roles are told, and that teamWith() still fails closed for a
// membership written only the old way (P1-BE-3).
// Run with: npm run test -w @sheetal/platform
import { describe, expect, it, vi } from "vitest";
import { leadPeople, notify, notifyStaff, teamWith } from "../src/notify/index.js";

describe("notify", () => {
  it("writes one row per distinct person, drops empty ids, and cuts long text", async () => {
    const createMany = vi.fn(async () => ({ count: 2 }));
    const db = { notification: { createMany } } as never;
    await notify(db, ["u1", null, "u2", "u1", undefined], { type: "lead", title: "T".repeat(300), message: "M".repeat(2000), link: "/leads", tenantId: "biz" });
    const data = (createMany.mock.calls[0] as unknown as [{ data: Record<string, unknown>[] }])[0].data;
    expect(data.map((d) => d.userId)).toEqual(["u1", "u2"]);
    expect(data[0]).toMatchObject({ tenantId: "biz", type: "lead", link: "/leads" });
    expect((data[0]!.title as string).length).toBe(200);
    expect((data[0]!.message as string).length).toBe(1000);
  });
  it("writes nothing for nobody, and a note without a business has tenantId null and an empty message", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const db = { notification: { createMany } } as never;
    await notify(db, [null, undefined], { type: "x", title: "t" });
    expect(createMany).not.toHaveBeenCalled();
    await notify(db, ["u1"], { type: "x", title: "t" });
    expect((createMany.mock.calls[0] as unknown as [{ data: Record<string, unknown>[] }])[0].data[0]).toMatchObject({ tenantId: null, message: "" });
  });
});

describe("notifyStaff", () => {
  it("tells staff whose platform role covers the permission (super admins always), with no business", async () => {
    const findMany = vi.fn(async () => [{ id: "s1" }, { id: "s2" }]);
    const createMany = vi.fn(async () => ({ count: 2 }));
    const db = { user: { findMany }, notification: { createMany } } as never;
    await notifyStaff(db, "platform.verification.review", { type: "kyc", title: "Check a document", link: "/admin/kyc" });
    const roles = ((findMany.mock.calls[0] as unknown as [{ where: { platformRole: { in: string[] } } }])[0].where.platformRole.in).sort();
    expect(roles).toEqual(["operations", "super_admin"]);        // finance, support and the content editor do not handle KYC
    expect((createMany.mock.calls[0] as unknown as [{ data: Record<string, unknown>[] }])[0].data.map((d) => d.tenantId)).toEqual([null, null]);
  });
  it("a permission only the super admin has goes to the super admin alone", async () => {
    const findMany = vi.fn(async () => []);
    await notifyStaff({ user: { findMany }, notification: { createMany: vi.fn() } } as never, "some.permission.nobody.has", { type: "x", title: "t" });
    expect((findMany.mock.calls[0] as unknown as [{ where: { platformRole: { in: string[] } } }])[0].where.platformRole.in).toEqual(["super_admin"]);
  });
});

describe("teamWith", () => {
  const branches = [{ id: "b1", name: "Pokhara" }, { id: "b2", name: "Chitwan" }];
  const dbWith = (rows: object[]) => ({ membership: { findMany: async () => rows }, branch: { findMany: async () => branches } }) as never;
  const m = (userId: string, perms: string[], over: object = {}) => ({ userId, scopes: "all", allBranches: true, branches: [], role: { perms }, ...over });

  it("finds owners and people whose role has one of the permissions, at the branch by id", async () => {
    const db = dbWith([
      m("owner", ["*"]),
      m("desk-pokhara", ["crm.lead.read"], { allBranches: false, branches: [{ branchId: "b1" }], scopes: ["Pokhara"] }),
      m("desk-chitwan", ["crm.lead.read"], { allBranches: false, branches: [{ branchId: "b2" }], scopes: ["Chitwan"] }),
      m("cook", ["pos.view"]),
      m("manager", ["crm.message.reply"]),
    ]);
    expect((await leadPeople(db, "biz", "b1")).sort()).toEqual(["desk-pokhara", "manager", "owner"]);
    expect((await teamWith(db, "biz", ["pos.view"])).sort()).toEqual(["cook", "owner"]);   // no branch given: everyone with the permission
  });

  it("a membership written only the old way (names, flag left at all) is never 'every branch' (fail closed)", async () => {
    const db = dbWith([m("old-style", ["crm.lead.read"], { scopes: ["Pokhara"], allBranches: true, branches: [] })]);
    expect(await teamWith(db, "biz", ["crm.lead.read"], "b1")).toEqual(["old-style"]);     // its names match Pokhara
    expect(await teamWith(db, "biz", ["crm.lead.read"], "b2")).toEqual([]);                 // and not Chitwan
  });

  it("a limited person with no branch rows is told about nothing at a branch", async () => {
    const db = dbWith([m("nowhere", ["crm.lead.read"], { allBranches: false, branches: [], scopes: [] })]);
    expect(await teamWith(db, "biz", ["crm.lead.read"], "b1")).toEqual([]);
  });
});
