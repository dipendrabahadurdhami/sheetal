// The proof behind stage 1.5 (new permission names everywhere): moving from the old names to the new ones changed nobody's access.
// How it works: the old world is kept as DATA only (LEGACY_TEMPLATES, LEGACY_PLATFORM_ROLES, LEGACY_ALIASES in the generated file; nothing reads them at
// run time). For every built-in role of every business type and every staff role, and for every old name: the role held the old name THEN exactly when
// the role's new grants pass the new form of that check NOW. The new form of a check is its new names joined with "+" (scripts/perm-names.mjs), which is
// what every call site was rewritten to.
import { describe, expect, it } from "vitest";
import { can, roleTemplatesFor, BUSINESS_TYPES, PLATFORM_ROLE_TEMPLATES } from "../../../shared/src/core/rbac.js";
import { LEGACY_ALIASES, LEGACY_BUSINESS_GROUPS, LEGACY_PLATFORM_ALIASES, LEGACY_PLATFORM_ROLES, LEGACY_TEMPLATES } from "./permissions.generated.js";
import { newNameFor } from "../../../scripts/perm-names.mjs";

/** What a built-in role held in the old names (the rule the old code used: a role without a list held everything of its type except two names). */
function oldPerms(type, key) {
  const row = LEGACY_TEMPLATES[type].find(([k]) => k === key);
  if (!row) return null;
  if (row[1]) return row[1];
  const all = LEGACY_BUSINESS_GROUPS.filter((g) => g.types === "all" || g.types.includes(type)).flatMap((g) => g.perms);
  return all.filter((p) => p !== "roles.manage" && p !== "billing.manage");
}
const held = (perms, old) => perms.includes("*") || perms.includes(old);

describe("new permission names give the same answers as the old ones did", () => {
  it("joins names with + as 'all of them', and understands only the manifests' names", () => {
    const role = { perms: ["a.b.read", "a.b.update:branch"] };
    expect(can(role, "a.b.read+a.b.update")).toBe(true);
    expect(can(role, "a.b.read+a.b.delete")).toBe(false);
    expect(can(role, "a.b.read+")).toBe(false);
    expect(can({ perms: ["*"] }, "a.b.read+a.b.delete")).toBe(true);
    expect(can(null, "a.b.read+a.b.update")).toBe(false);
    // The alias layer is gone: an old name gives nothing, and a new-name role does not pass a check written in an old name.
    expect(can({ perms: ["leads.view"] }, "crm.lead.read")).toBe(false);
    expect(can({ perms: ["crm.lead.read:own"] }, "leads.view")).toBe(false);
  });

  it("every built-in business role passes exactly the checks its old permissions passed", () => {
    let roles = 0;
    for (const type of Object.keys(BUSINESS_TYPES)) {
      for (const role of roleTemplatesFor(type)) {
        const before = oldPerms(type, role.key);
        expect(before, `${type}/${role.key} existed before`).not.toBeNull();
        roles++;
        for (const old of Object.keys(LEGACY_ALIASES)) {
          expect(can(role, newNameFor(old, "business")), `${type}/${role.key}: ${old}`).toBe(held(before, old));
        }
      }
      expect(roleTemplatesFor(type).map((r) => r.key)).toEqual(LEGACY_TEMPLATES[type].map(([k]) => k));
    }
    expect(roles).toBeGreaterThan(15);
  });

  it("every staff role passes exactly the checks its old permissions passed", () => {
    expect(PLATFORM_ROLE_TEMPLATES.map((r) => r.key)).toEqual(Object.keys(LEGACY_PLATFORM_ROLES));
    for (const role of PLATFORM_ROLE_TEMPLATES) {
      for (const old of Object.keys(LEGACY_PLATFORM_ALIASES)) {
        expect(can(role, newNameFor(old, "platform")), `${role.key}: ${old}`).toBe(held(LEGACY_PLATFORM_ROLES[role.key], old));
      }
    }
  });

  it("no built-in role stores an old name", () => {
    const olds = new Set([...Object.keys(LEGACY_ALIASES), ...Object.keys(LEGACY_PLATFORM_ALIASES)]);
    const stored = [...Object.keys(BUSINESS_TYPES).flatMap((t) => roleTemplatesFor(t)), ...PLATFORM_ROLE_TEMPLATES].flatMap((r) => r.perms);
    expect(stored.filter((p) => olds.has(p.split(":")[0]))).toEqual([]);
    expect(stored.every((p) => p === "*" || /^[a-z_]+\.[a-z_]+\.[a-z_]+(:(own|branch|all))?$/.test(p))).toBe(true);
  });

  it("the replacement of a name is its new names in the manifest's order, and unknown names are left alone", () => {
    expect(newNameFor("billing.view", "platform")).toBe("platform.billing.read");
    expect(newNameFor("settings.platform", "platform")).toBe("platform.settings.read+platform.settings.update");
    expect(newNameFor("reviews.reply", "business")).toBe("reviews.review.read+reviews.review.reply");
    expect(newNameFor("roles.manage", "platform")).not.toBe(newNameFor("roles.manage", "business"));
    expect(newNameFor("not.a.permission", "business")).toBeNull();
    expect(newNameFor("platform.billing.read", "platform")).toBeNull();     // already a new name
  });
});
