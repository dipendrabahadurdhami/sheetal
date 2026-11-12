// Tests for "all of these names" written with + (stage 1.5): the server resolver, the staff roles and the permission set of a context. Pure: no database.
import { describe, expect, it } from "vitest";
import { hasPerm } from "../src/tenancy/perms.js";
import { buildPermissionSet } from "../src/tenancy/context.js";
import { LEGACY_PLATFORM_ALIASES, LEGACY_PLATFORM_ROLES } from "../src/tenancy/permissions.generated.js";
import { STAFF_GRANTS } from "../src/tenancy/staff-roles.js";

describe("permissions joined with +", () => {
  it("needs every name, with new names, old names and scopes", () => {
    expect(hasPerm(["a.b.read", "a.b.update:branch"], "a.b.read+a.b.update")).toBe(true);
    expect(hasPerm(["a.b.read"], "a.b.read+a.b.update")).toBe(false);
    expect(hasPerm(["*"], "a.b.read+a.b.update")).toBe(true);
    expect(hasPerm(["a.b.read"], "a.b.read+")).toBe(false);
    expect(hasPerm(["a.b.read"], "+")).toBe(false);
  });
  it("a staff role passes exactly the joined checks its OLD permissions stood for", () => {
    for (const [role, olds] of Object.entries(LEGACY_PLATFORM_ROLES)) {
      const now = STAFF_GRANTS.get(role)!;
      for (const [old, news] of Object.entries(LEGACY_PLATFORM_ALIASES)) {
        expect(hasPerm(now, news.join("+")), `${role}: ${old}`).toBe(olds.includes("*") || olds.includes(old));
      }
    }
    expect(hasPerm(STAFF_GRANTS.get("finance")!, "platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete")).toBe(true);
    expect(hasPerm(STAFF_GRANTS.get("support")!, "platform.plan.read+platform.plan.create+platform.plan.update+platform.plan.delete")).toBe(false);
    expect(STAFF_GRANTS.get("constructor")).toBeUndefined();
  });
  it("a permission set gives the narrowest scope of the joined names, or refuses", () => {
    const set = buildPermissionSet(["expenses.expense.read:all", "expenses.expense.create:branch"]);
    expect(set.can("expenses.expense.read+expenses.expense.create")).toBe(true);
    expect(set.scopeOf("expenses.expense.read+expenses.expense.create")).toBe("branch");
    expect(set.scopeOf("expenses.expense.read+expenses.expense.delete")).toBeNull();
    expect(() => set.require("expenses.expense.read+expenses.expense.delete")).toThrow();
    expect(buildPermissionSet(["*"]).scopeOf("expenses.expense.read+expenses.expense.delete")).toBe("all");
  });
});
