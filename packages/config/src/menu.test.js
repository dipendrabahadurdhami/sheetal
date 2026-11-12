// Tests for the menu from manifests (step 11): the three apps on the kernel must show for exactly the same people as the old hand-written entries did.
// How it works: for every business type and every built-in role, the hand-written entry (its permissions written in the manifests' names) and the
// manifest entry must both be shown or both be hidden by filterNav().
import { describe, expect, it } from "vitest";
import { filterNav, roleTemplatesFor, BUSINESS_TYPES } from "../../../shared/src/core/rbac.js";
import { newNameFor } from "../../../scripts/perm-names.mjs";
import { manifestNavItem, manifestPaths } from "./menu.js";

// The entries as the shell wrote them by hand before step 11, with their permissions in the manifests' names (the names the old ones stood for; "+" = all).
const OLD = [
  { to: "/business/reviews", icon: "star", key: "nav.reviews", permAny: [newNameFor("reviews.reply", "business"), newNameFor("customers.view", "business")] },
  { to: "/business/rentals", icon: "key-round", key: "nav.rentals", permAny: [newNameFor("rentals.view", "business"), newNameFor("rentals.manage", "business")], types: ["agency"] },
  { to: "/business/expenses", paid: true, icon: "chart-pie", key: "nav.expenses", perm: newNameFor("expenses.view", "business") },
];
const shown = (item, role, type) => filterNav([{ items: [item] }], role, type).length === 1;

describe("menu from manifests", () => {
  it("declares the three kernel pages", () => {
    expect(manifestPaths().sort()).toEqual(["/business/expenses", "/business/rentals", "/business/reviews"]);
    expect(manifestNavItem("/business/nothing")).toBeNull();
  });

  it("keeps the same path, icon, words and business types as the old menu", () => {
    for (const old of OLD) {
      const now = manifestNavItem(old.to, old.paid ? { paid: true } : {});
      expect(now).toMatchObject({ to: old.to, icon: old.icon, key: old.key });
      expect(now.types).toEqual(old.types);
      expect(now.paid).toBe(old.paid);
    }
  });

  it("shows each entry to the same roles as the hand-written entry did, for every business type", () => {
    for (const type of Object.keys(BUSINESS_TYPES)) {
      const roles = [...roleTemplatesFor(type), { key: "owner", perms: ["*"] }, { key: "nobody", perms: [] }];
      for (const role of roles) {
        for (const old of OLD) {
          expect(shown(manifestNavItem(old.to), role, type), `${type} / ${role.key} / ${old.to}`).toBe(shown(old, role, type));
        }
      }
    }
  });

  it("is not shown to a role that still holds only an old name (the alias layer is gone)", () => {
    expect(shown(manifestNavItem("/business/expenses"), { perms: ["expenses.view"] }, "agency")).toBe(false);
    expect(shown(manifestNavItem("/business/expenses"), { perms: ["expenses.expense.read:branch"] }, "agency")).toBe(true);
  });
});
