// Tests of the pure parts of the tenancy context (no database): branch scope, permission set, entitlements, app access, staff context.
// Where it fits: platform/src/tenancy/context.ts (P1-BE-3). The database parts (a real request, dual write, seats, impersonation) are
// tested in business/backend/test/tenancy.test.ts.
// How it works: small hand-made branches and roles. The checks follow ACCESS.md sections 1, 3, 5, 7 and 13 and KERNEL.md section 5.
// Rules: never change an expected value to make a test pass; these are the rules the business API relies on.

import { describe, expect, it } from "vitest";
import {
  accessOfMember, buildEntitlements, buildPermissionSet, buildImpersonationPermissions, buildStaffContext, canUseApp, createBranchScope, requireAppAccess,
  IMPERSONATION_DENY,
} from "../src/tenancy/context.js";
import { PERMISSION_CATALOG } from "../src/tenancy/permissions.generated.js";
import { reconcileOldNames } from "../src/tenancy/branch-links.js";
import type { BranchInfo } from "../src/core/context.js";

const A: BranchInfo = { id: "b-head", name: "Head office", status: "open" };
const B: BranchInfo = { id: "b-pokhara", name: "Pokhara", status: "open" };
const C: BranchInfo = { id: "b-chitwan", name: "Chitwan", status: "closed" };
const ALL = [A, B, C];

describe("BranchScope", () => {
  it("gives an owner / all-branches person every branch and no filter", () => {
    const s = createBranchScope({ all: ALL, allowed: "all" });
    expect(s.allowed).toBe("all");
    expect(s.mine.map((b) => b.id)).toEqual(["b-head", "b-pokhara", "b-chitwan"]);
    expect(s.picked).toBeNull();
    expect(s.idsFor("branch")).toBeNull();   // the whole business, so a record with no branch is visible too
    expect(s.idsFor("own")).toBeNull();
    expect(s.idsFor("all")).toBeNull();
    expect(s.canSee("b-chitwan")).toBe(true);
    expect(s.canSee(null)).toBe(true);
  });

  it("limits a limited person to their branches, even with 'All branches' picked", () => {
    const s = createBranchScope({ all: ALL, allowed: ["b-pokhara"], wanted: "all" });
    expect(s.mine.map((b) => b.id)).toEqual(["b-pokhara"]);
    expect(s.picked).toBeNull();
    expect(s.idsFor("branch")).toEqual(["b-pokhara"]);
    expect(s.idsFor("all")).toBeNull();      // the permission was granted for the whole business (data scope "all")
    expect(s.canSee("b-pokhara")).toBe(true);
    expect(s.canSee("b-head")).toBe(false);
    expect(s.canSee(null)).toBe(true);       // records with no branch belong to everyone
    expect(s.canSee("a-branch-of-another-business")).toBe(false);
  });

  it("uses the branch picked in the top bar, and refuses one the person may not use", () => {
    expect(createBranchScope({ all: ALL, allowed: "all", wanted: "b-pokhara" }).idsFor("branch")).toEqual(["b-pokhara"]);
    expect(() => createBranchScope({ all: ALL, allowed: ["b-pokhara"], wanted: "b-head" })).toThrowError("You don't work at that branch.");
    expect(() => createBranchScope({ all: ALL, allowed: "all", wanted: "branch-of-another-business" })).toThrowError("You don't work at that branch.");
    try { createBranchScope({ all: ALL, allowed: ["b-pokhara"], wanted: "b-head" }); } catch (e) { expect(e).toMatchObject({ statusCode: 403 }); }
  });

  it("gives a person with zero branches no branch at all (never 'all')", () => {
    const s = createBranchScope({ all: ALL, allowed: [] });
    expect(s.mine).toEqual([]);
    expect(s.idsFor("branch")).toEqual([]);   // a filter that matches nothing
    expect(s.canSee("b-head")).toBe(false);
    expect(() => s.branchForNew()).toThrowError("You aren't given any open branch. Ask the owner to give you one on the Team page.");
  });

  it("picks the branch for new work like branchFor() did: asked, then picked, then the only open branch", () => {
    const owner = createBranchScope({ all: ALL, allowed: "all" });
    expect(() => owner.branchForNew()).toThrowError("Pick a branch first: at the top of the page, or in the form.");   // two open branches
    expect(owner.branchForNew("b-pokhara")).toBe("b-pokhara");
    expect(() => owner.branchForNew("b-chitwan")).toThrowError("That branch is closed.");
    expect(() => owner.branchForNew("nowhere")).toThrowError("You don't work at that branch.");
    expect(createBranchScope({ all: ALL, allowed: "all", wanted: "b-head" }).branchForNew()).toBe("b-head");
    expect(createBranchScope({ all: ALL, allowed: ["b-pokhara", "b-chitwan"] }).branchForNew()).toBe("b-pokhara");   // their only OPEN branch
    expect(createBranchScope({ all: ALL, allowed: ["b-pokhara"] }).branchForNew("b-pokhara")).toBe("b-pokhara");
    expect(() => createBranchScope({ all: ALL, allowed: ["b-pokhara"] }).branchForNew("b-head")).toThrowError("You don't work at that branch.");
  });

  it("reads a membership: owners always all; limited people by the link rows; the old names only as a fallback", () => {
    const agent = { perms: ["crm.lead.read:own"] };
    const owner = { perms: ["*"] };
    expect(accessOfMember({ scopes: ["Pokhara"], allBranches: false, branches: [], role: owner })).toEqual({ allowed: "all", names: "all" });
    expect(accessOfMember({ scopes: "all", allBranches: true, branches: [], role: agent })).toEqual({ allowed: "all", names: "all" });
    expect(accessOfMember({ scopes: ["Old name"], allBranches: false, branches: [{ branchId: "b-pokhara", branch: { name: "Pokhara" } }], role: agent }))
      .toEqual({ allowed: ["b-pokhara"], names: ["Pokhara"] });   // the links win over the old column
    expect(accessOfMember({ scopes: ["x"], allBranches: false, branches: [], role: agent })).toEqual({ allowed: [], names: [] });
    expect(accessOfMember({ scopes: ["Pokhara"], role: agent })).toEqual({ allowed: [], names: ["Pokhara"] });   // an object with only the old column
    expect(accessOfMember({ scopes: null, role: agent })).toEqual({ allowed: "all", names: "all" });
  });
});

describe("rows written only the old way (fail closed, Lead fix after the first CI run)", () => {
  const branches = [{ id: "b-head", name: "Head office" }, { id: "b-pokhara", name: "Pokhara" }];
  const role = { perms: ["expenses.expense.read:branch"] };

  it("reads a list of names with the flag left at 'all' as limited to those names, never every branch", () => {
    const m = reconcileOldNames({ scopes: ["pokhara"], allBranches: true, branches: [], role }, branches);
    expect(m.allBranches).toBe(false);
    expect(m.branches).toEqual([{ branchId: "b-pokhara", branch: { name: "Pokhara" } }]);
    expect(accessOfMember(m)).toEqual({ allowed: ["b-pokhara"], names: ["Pokhara"] });
  });

  it("gives a stale name no branch at all, and leaves owners, 'all' and rows written the new way unchanged", () => {
    expect(reconcileOldNames({ scopes: ["Mustang"], allBranches: true, branches: [], role }, branches)).toMatchObject({ allBranches: false, branches: [] });
    const owner = { scopes: ["Pokhara"], allBranches: true, branches: [], role: { perms: ["*"] } };
    expect(reconcileOldNames(owner, branches)).toBe(owner);
    const everyone = { scopes: "all", allBranches: true, branches: [], role };
    expect(reconcileOldNames(everyone, branches)).toBe(everyone);
    const newWay = { scopes: ["Pokhara"], allBranches: false, branches: [{ branchId: "b-pokhara", branch: { name: "Pokhara" } }], role };
    expect(reconcileOldNames(newWay, branches)).toBe(newWay);
  });

  it("a person promoted from limited to every branch is stored as 'all' (not a list), so they are never narrowed (QA confirm 1)", async () => {
    const { accessColumns, EVERY_BRANCH } = await import("../src/tenancy/branch-links.js");
    const stored = { ...accessColumns(EVERY_BRANCH, false), branches: [], role };
    expect(stored).toMatchObject({ scopes: "all", allBranches: true });
    expect(reconcileOldNames(stored, branches)).toBe(stored);
    expect(accessOfMember(stored)).toEqual({ allowed: "all", names: "all" });
  });

  it("flag 'all' with link rows present: the links win for anyone but an owner (QA confirm 2)", () => {
    const odd = { scopes: "all", allBranches: true, branches: [{ branchId: "b-pokhara", branch: { name: "Pokhara" } }], role };
    expect(reconcileOldNames(odd, branches)).toMatchObject({ allBranches: false, branches: odd.branches });
    expect(accessOfMember(odd)).toEqual({ allowed: ["b-pokhara"], names: ["Pokhara"] });
    const owner = { ...odd, role: { perms: ["*"] } };
    expect(accessOfMember(owner)).toEqual({ allowed: "all", names: "all" });
  });

  it("without the business's branches, accessOfMember still fails closed (no ids)", () => {
    expect(accessOfMember({ scopes: ["Pokhara"], allBranches: true, branches: [], role })).toEqual({ allowed: [], names: ["Pokhara"] });
    expect(accessOfMember({ scopes: "all", allBranches: true, branches: [], role })).toEqual({ allowed: "all", names: "all" });
  });
});

describe("PermissionSet", () => {
  it("gives '*' everything at scope all", () => {
    const p = buildPermissionSet(["*"]);
    expect(p.can("expenses.expense.create")).toBe(true);
    expect(p.can("anything.at.all")).toBe(true);
    expect(p.scopeOf("expenses.expense.create")).toBe("all");
  });

  it("reads scope suffixes", () => {
    const p = buildPermissionSet(["expenses.expense.read:branch", "workspace.team.read:all", "crm.lead.read:own"]);
    expect(p.scopeOf("expenses.expense.read")).toBe("branch");
    expect(p.scopeOf("workspace.team.read")).toBe("all");
    expect(p.scopeOf("crm.lead.read")).toBe("own");
    expect(p.scopeOf("expenses.expense.create")).toBeNull();
    expect(p.can("expenses.expense.read")).toBe(true);
    expect(p.can("expenses.expense.create")).toBe(false);
  });

  it("takes the manifest default when there is no suffix", () => {
    const p = buildPermissionSet(["expenses.expense.read", "workspace.team.read"]);
    expect(p.scopeOf("expenses.expense.read")).toBe("branch");
    expect(p.scopeOf("workspace.team.read")).toBe("all");
  });

  it("does not understand the OLD names any more (stage 1.5): not as a grant, not as a check", () => {
    const p = buildPermissionSet(["expenses.manage", "team.manage", "leads.view"]);
    expect(p.can("expenses.expense.create")).toBe(false);          // an old name in a role gives nothing
    expect(p.scopeOf("crm.lead.read")).toBeNull();
    const fresh = buildPermissionSet(["expenses.expense.read:branch", "expenses.recurring.read:branch", "expenses.profit.read:branch"]);
    expect(fresh.can("expenses.view")).toBe(false);                // an old name in a check asks for nothing a role can hold
    expect(fresh.scopeOf("expenses.view")).toBeNull();
    expect(fresh.can("expenses.expense.read+expenses.recurring.read+expenses.profit.read")).toBe(true);   // what "expenses.view" stood for
    expect(fresh.scopeOf("expenses.expense.read+expenses.recurring.read+expenses.profit.read")).toBe("branch");
  });

  it("require() returns the scope or refuses with 403 and the message given", () => {
    const p = buildPermissionSet(["expenses.expense.read:branch"]);
    expect(p.require("expenses.expense.read")).toBe("branch");
    expect(() => p.require("expenses.expense.create")).toThrowError("You don't have permission to do that.");
    expect(() => p.require("expenses.expense.create", "Not yours.")).toThrowError("Not yours.");
    try { p.require("expenses.expense.create"); } catch (e) { expect(e).toMatchObject({ statusCode: 403, code: "forbidden" }); }
    expect(p.canAny(["expenses.expense.create", "expenses.expense.read"])).toBe(true);
    expect(p.canAny(["expenses.expense.create"])).toBe(false);
  });

  it("never lets a support session do what the deny list forbids, even with the owner's '*'", () => {
    const p = buildImpersonationPermissions();
    expect(p.can("expenses.expense.read")).toBe(true);
    for (const denied of ["workspace.role.create", "workspace.team.invite", "workspace.team.remove", "workspace.billing.manage", "workspace.settings.update",
      "workspace.role.create+workspace.role.update", "workspace.team.read+workspace.team.invite", "expenses.expense.read+workspace.billing.manage"]) {
      expect(p.can(denied), denied).toBe(false);
      expect(p.scopeOf(denied), denied).toBeNull();
      expect(() => p.require(denied), denied).toThrowError();
    }
    expect(p.can("workspace.team.read")).toBe(true);   // only seeing the team is fine
  });

  it("denies EVERY permission each deny-list entry covers, alone and joined with another name (QA, P1-BE-3 fix 3)", () => {
    const p = buildImpersonationPermissions();
    const covered = (id: string) => IMPERSONATION_DENY.some((d) => (d.endsWith(".*") ? id.startsWith(d.slice(0, -1)) : id === d));
    for (const entry of IMPERSONATION_DENY) {
      const ids = PERMISSION_CATALOG.map((x) => x.id).filter((id) => (entry.endsWith(".*") ? id.startsWith(entry.slice(0, -1)) : id === entry));
      expect(ids.length, `deny entry ${entry} matches a real permission`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(p.can(id), id).toBe(false);
        expect(p.can(`expenses.expense.read+${id}`), `${id} joined with another name`).toBe(false);
      }
    }
    // Everything not on the list stays allowed for the session (it is the owner's view), so the list is the only thing that narrows it.
    for (const { id } of PERMISSION_CATALOG.filter((x) => x.app !== "platform" && !covered(x.id))) expect(p.can(id), id).toBe(true);
  });
});

describe("Entitlements and app access", () => {
  const plan = (limits: object, features: object = {}) => ({ features, limits });
  const ent = (type: string, features: object = {}, limits: object = { seats: 3, listings: -1, rooms: 10 }, seatsUsed = 1) =>
    buildEntitlements({ type, plan: plan(limits, features), limits, seatsUsed });

  it("offers each business type the apps it had before, and nothing is switched off", () => {
    expect(ent("hotel").hasApp("pos")).toBe(true);
    expect(ent("hotel").hasApp("hotel")).toBe(true);
    expect(ent("agency").hasApp("pos")).toBe(false);
    expect(ent("agency").hasApp("listings")).toBe(true);
    expect(ent("developer").hasApp("projects")).toBe(true);
    expect(ent("sponsor").hasApp("investments")).toBe(true);
    for (const t of ["hotel", "host", "developer", "agency", "sponsor"]) {
      expect(ent(t).hasApp("workspace")).toBe(true);
      expect(ent(t).hasApp("expenses")).toBe(true);
      expect(ent(t).hasApp("reviews")).toBe(true);
      expect(ent(t).hasApp("platform")).toBe(false);   // staff only
    }
    expect(ent("nope").hasApp("no-such-app")).toBe(false);
  });

  it("gives every app to a plan with all_kinds (today's Pro rule)", () => {
    expect(ent("agency", { all_kinds: true }).hasApp("pos")).toBe(true);
    expect(ent("agency", { all_kinds: true }).hasApp("projects")).toBe(true);
  });

  it("maps -1 to unlimited and reads limits, features and seats", () => {
    const e = ent("agency", { custom_roles: true });
    expect(e.limit("listings", "listings")).toBeNull();
    expect(e.limit("hotel", "rooms")).toBe(10);
    expect(e.limit("hotel", "nothing")).toBeNull();
    expect(e.feature("custom_roles")).toBe(true);
    expect(e.feature("pos")).toBe(false);
    expect(e.seats()).toEqual({ used: 1, limit: 3 });
    expect(ent("agency", {}, { seats: -1 }).seats().limit).toBeNull();
    expect(ent("agency", {}, {}).seats().limit).toBe(1);   // the old default
    expect(e.edition("expenses")).toBe("default");
    expect(e.edition("pos")).toBeNull();
    expect(e.ai("expenses")).toBe("locked");
  });

  it("refuses an app the business doesn't have with 403 app_not_available, and a role that can't use it with 403 forbidden", () => {
    const agency = { entitlements: ent("agency"), permissions: buildPermissionSet(["*"]) };
    try { requireAppAccess(agency, "pos"); expect.unreachable(); } catch (e) {
      expect(e).toMatchObject({ statusCode: 403, code: "app_not_available", message: expect.stringMatching(/^Your business doesn't have .+\.$/) });
    }
    const hotelOwner = { entitlements: ent("hotel"), permissions: buildPermissionSet(["*"]) };
    expect(() => requireAppAccess(hotelOwner, "pos")).not.toThrow();
    const hotelCleaner = { entitlements: ent("hotel"), permissions: buildPermissionSet(["hotel.calendar.read:branch"]) };
    try { requireAppAccess(hotelCleaner, "pos"); expect.unreachable(); } catch (e) {
      expect(e).toMatchObject({ statusCode: 403, code: "forbidden" });
    }
    expect(canUseApp(hotelCleaner, "hotel")).toBe(true);       // holds hotel.calendar.read
    expect(canUseApp(hotelCleaner, "pos")).toBe(false);
    expect(canUseApp(hotelCleaner, "workspace")).toBe(true);   // always on for a member
  });
});

describe("StaffContext", () => {
  const info = { db: {} as never, headers: {}, ip: "127.0.0.1", requestId: "r1", log: {} as never };
  const staff = (platformRole: string | null) => buildStaffContext({ ...info, user: { id: "u1", userName: "Sita", platformRole } });

  it("takes the permissions of the platform role, in the manifest names", () => {
    const ops = staff("operations");
    expect(ops.staff).toEqual({ id: "u1", role: "operations" });
    expect(ops.actor).toEqual({ kind: "staff", staffId: "u1", name: "Sita", role: "operations" });
    expect(ops.permissions.can("tenants.view")).toBe(false);          // an old name is not understood
    expect(ops.permissions.can("platform.business.read")).toBe(true);
    expect(ops.permissions.can("platform.business.impersonate")).toBe(true);
    expect(ops.permissions.can("platform.business.impersonate_write")).toBe(false);
    expect(ops.permissions.can("platform.plan.update")).toBe(false);
    expect(staff("super_admin").permissions.can("platform.business.impersonate_write")).toBe(true);
    expect(staff("finance").permissions.can("platform.billing.refund")).toBe(true);
  });

  it("refuses anyone who is not Sheetal staff", () => {
    expect(() => staff(null)).toThrowError("This is for Sheetal staff only.");
    expect(() => staff("intern")).toThrowError("This is for Sheetal staff only.");
    // Names of things every object inherits must never count as a staff role (QA, P1-BE-3 fix 2).
    for (const trick of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
      expect(() => staff(trick), trick).toThrowError("This is for Sheetal staff only.");
    }
  });
});
