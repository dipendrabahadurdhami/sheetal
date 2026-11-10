// Test: the permission shims export exactly what the old files exported (P1-BE-2, "behaviour unchanged").
// Where it fits: backend-core/test, next to domain.test.ts. The oracle is permissions-oracle.ts, a frozen copy of the old
// backend-core/src/domain/permissions.ts and shared/src/core/rbac.js.
// How it works: every exported name still exists, every exported value deep-equals the old one, and every function gives the
// old answer for all the inputs the app can produce (every business type, every role, every old permission name).
// Rules: do not edit the oracle or relax a comparison to make this pass; a real change to a permission is a separate task.
// Run with: npm run test -w @sheetal/backend-core
import { describe, expect, it } from "vitest";
import * as api from "../src/domain/permissions.js";
// @ts-expect-error -- the screens' files are plain JavaScript without types
import * as ui from "../../shared/src/core/rbac.js";
import { oldApi, oldUi } from "./permissions-oracle.js";

const TYPES = ["hotel", "host", "developer", "agency", "sponsor"] as const;
const subsets = <T,>(xs: readonly T[]): T[][] => xs.reduce<T[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);

describe("backend permissions.ts is unchanged", () => {
  it("still exports every old name", () => {
    for (const name of Object.keys(oldApi)) expect(Object.keys(api), name).toContain(name);
  });
  it("business types, groups and staff roles are equal to the old values", () => {
    expect([...api.BUSINESS_TYPES]).toEqual([...oldApi.BUSINESS_TYPES]);
    expect(api.BUSINESS_PERMS).toEqual(oldApi.BUSINESS_PERMS);
    expect(api.PLATFORM_PERMS).toEqual(oldApi.PLATFORM_PERMS);
    expect(api.PLATFORM_ROLES).toEqual(oldApi.PLATFORM_ROLES);
    expect(Object.keys(api.PLATFORM_ROLES)).toEqual(Object.keys(oldApi.PLATFORM_ROLES));   // same order
  });
  it("every role template of every business type is equal, in the same order", () => {
    for (const type of TYPES) {
      const got = api.roleTemplatesFor(type);
      expect(got, type).toEqual(oldApi.roleTemplatesFor(type));
      expect(got.map((r) => r.key)).toEqual(oldApi.roleTemplatesFor(type).map((r) => r.key));
    }
  });
  it("businessPermsFor gives the old list for every combination of types", () => {
    for (const set of subsets(TYPES)) expect(api.businessPermsFor(set), set.join()).toEqual(oldApi.businessPermsFor(set));
  });
  it("hasPerm answers as before for every role and every old permission name", () => {
    const universe = [...new Set([...oldApi.BUSINESS_PERMS, ...oldApi.PLATFORM_PERMS].flatMap((g) => g.perms)), "nope.nothing", ""];
    const roles = [
      ...TYPES.flatMap((t) => oldApi.roleTemplatesFor(t).map((r) => r.perms)),
      ...Object.values(oldApi.PLATFORM_ROLES), [], ["*"],
    ];
    for (const perms of roles) for (const p of universe) expect(api.hasPerm(perms, p), `${perms.slice(0, 3)} / ${p}`).toBe(oldApi.hasPerm(perms, p));
  });
});

describe("screens rbac.js is unchanged", () => {
  it("still exports every old name", () => {
    for (const name of Object.keys(oldUi)) expect(Object.keys(ui), name).toContain(name);
  });
  it("business types (with icons) and groups are equal", () => {
    expect(ui.BUSINESS_TYPES).toEqual(oldUi.BUSINESS_TYPES);
    expect(ui.BUSINESS_PERMS).toEqual(oldUi.BUSINESS_PERMS);
    expect(ui.PLATFORM_PERMS).toEqual(oldUi.PLATFORM_PERMS);
  });
  it("role templates for every business type are equal (system, name and perms)", () => {
    for (const type of TYPES) expect(ui.roleTemplatesFor(type), type).toEqual(oldUi.roleTemplatesFor(type));
    expect(ui.PLATFORM_ROLE_TEMPLATES).toEqual(oldUi.PLATFORM_ROLE_TEMPLATES);
  });
  it("permsForType and permsForTypes are equal for every combination", () => {
    for (const t of TYPES) expect(ui.permsForType(t)).toEqual(oldUi.permsForType(t));
    for (const set of subsets(TYPES)) expect(ui.permsForTypes(set), set.join()).toEqual(oldUi.permsForTypes(set));
  });
  it("can, canAny and permCount answer as before for every role", () => {
    const universe = [...new Set([...oldUi.BUSINESS_PERMS, ...oldUi.PLATFORM_PERMS].flatMap((g: { perms: string[] }) => g.perms)), "nope.nothing"];
    const roles = [
      ...TYPES.flatMap((t) => oldUi.roleTemplatesFor(t)), ...oldUi.PLATFORM_ROLE_TEMPLATES,
      { key: "custom", system: false, name: "Custom", perms: ["expenses.view", "reviews.reply"] }, { key: "none", system: false, name: "None", perms: [] },
    ];
    for (const role of roles) {
      for (const p of universe) expect(ui.can(role, p), `${role.key} / ${p}`).toBe(oldUi.can(role, p));
      expect(ui.canAny(role, universe.slice(0, 4))).toBe(oldUi.canAny(role, universe.slice(0, 4)));
      expect(ui.canAny(role, [])).toBe(oldUi.canAny(role, []));
      expect(ui.permCount(role, ui.BUSINESS_PERMS)).toBe(oldUi.permCount(role, oldUi.BUSINESS_PERMS));
      expect(ui.permCount(role, ui.PLATFORM_PERMS)).toBe(oldUi.permCount(role, oldUi.PLATFORM_PERMS));
    }
    expect(ui.can(null, "overview.view")).toBe(oldUi.can(null, "overview.view"));
    expect(ui.can(undefined, "overview.view")).toBe(oldUi.can(undefined, "overview.view"));
  });
  it("roleName, roleDesc and filterNav answer as before", () => {
    const t = (k: string) => `T(${k})`;
    for (const type of TYPES) {
      for (const role of oldUi.roleTemplatesFor(type)) {
        expect(ui.roleName(role, t)).toBe(oldUi.roleName(role, t));
        expect(ui.roleDesc(role, t)).toBe(oldUi.roleDesc(role, t));
      }
    }
    expect(ui.roleName(null, t)).toBe(oldUi.roleName(null, t));
    expect(ui.roleName({ system: false, name: "Mine" }, t)).toBe("Mine");
    const nav = [
      { id: "a", items: [{ id: "1", perm: "expenses.view" }, { id: "2", permAny: ["reviews.reply", "customers.view"] }, { id: "3", types: ["hotel"], perm: "overview.view" }] },
      { id: "b", items: [{ id: "4", perm: "billing.manage" }] },
    ];
    for (const type of [...TYPES, ["hotel", "agency"]]) {
      for (const role of oldUi.roleTemplatesFor(Array.isArray(type) ? "hotel" : type)) expect(ui.filterNav(nav, role, type), `${role.key}/${type}`).toEqual(oldUi.filterNav(nav, role, type));
    }
  });
});

describe("the server and screen copies agree", () => {
  it("both generated files hold the same data", async () => {
    // @ts-expect-error -- plain JavaScript without types
    const js = await import("../../packages/config/src/permissions.generated.js");
    const ts = await import("@sheetal/platform/tenancy/permissions.generated");
    for (const name of Object.keys(ts)) expect(js[name], name).toEqual((ts as Record<string, unknown>)[name]);
    expect(Object.keys(js).sort()).toEqual(Object.keys(ts).sort());
  });
});
