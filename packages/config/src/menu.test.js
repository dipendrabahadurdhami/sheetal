// Tests for the menu from manifests (step 11): the three apps on the kernel must show for exactly the same people as the old hand-written entries did.
// How it works: for every business type and every role template (old permission names, as stored today) and the same role in NEW names, the old entry
// and the manifest entry must both be shown or both be hidden by filterNav().
import { describe, expect, it } from "vitest";
import { filterNav, roleTemplatesFor, BUSINESS_TYPES } from "../../../shared/src/core/rbac.js";
import { LEGACY_ALIASES } from "./permissions.generated.js";
import { manifestNavItem, manifestPaths } from "./menu.js";

const OLD = [
  { to: "/business/reviews", icon: "star", key: "nav.reviews", permAny: ["reviews.reply", "customers.view"] },
  { to: "/business/rentals", icon: "key-round", key: "nav.rentals", permAny: ["rentals.view", "rentals.manage"], types: ["agency"] },
  { to: "/business/expenses", paid: true, icon: "chart-pie", key: "nav.expenses", perm: "expenses.view" },
];
const shown = (item, role, type) => filterNav([{ items: [item] }], role, type).length === 1;
const inNewNames = (role) => ({ ...role, perms: role.perms.includes("*") ? ["*"] : [...new Set(role.perms.flatMap((p) => LEGACY_ALIASES[p] || []))] });

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

  it("shows each entry to the same roles as before, for every business type, with old and with new permission names", () => {
    for (const type of Object.keys(BUSINESS_TYPES)) {
      const roles = [...roleTemplatesFor(type), { key: "owner", perms: ["*"] }, { key: "nobody", perms: [] }];
      for (const role of roles) {
        for (const old of OLD) {
          const now = manifestNavItem(old.to);
          const want = shown(old, role, type);
          expect(shown(now, role, type), `${type} / ${role.key} / ${old.to} (old names)`).toBe(want);
          expect(shown(now, inNewNames(role), type), `${type} / ${role.key} / ${old.to} (new names)`).toBe(want);
        }
      }
    }
  });
});
