// The safety net of stage 1.5 (new permission names everywhere): switching a check from an old name to its new names must not change who passes.
// How it works: an old name stands for one or more new names (LEGACY_ALIASES for businesses, LEGACY_PLATFORM_ALIASES for Sheetal staff). A call site is
// rewritten from "old" to its new names joined with "+" (all of them are needed). For every role template of every business type and every staff role, and
// for every old name, the old check and the new check must give the same answer: with the role stored in old names (today) and in new names (after the
// role rewrite). The table of call-site replacements (scripts/perm-names.mjs) is built from the same maps, and is checked here too.
import { describe, expect, it } from "vitest";
import { can, roleTemplatesFor, BUSINESS_TYPES, PLATFORM_ROLE_TEMPLATES } from "../../../shared/src/core/rbac.js";
import { LEGACY_ALIASES, LEGACY_PLATFORM_ALIASES } from "./permissions.generated.js";
import { newNameFor } from "../../../scripts/perm-names.mjs";

const inNew = (role, map) => ({ ...role, perms: role.perms.includes("*") ? ["*"] : [...new Set(role.perms.flatMap((p) => map[p] || [p]))] });
const businessRoles = Object.keys(BUSINESS_TYPES).flatMap((type) => roleTemplatesFor(type).map((r) => ({ ...r, key: `${type}/${r.key}` })));

describe("new permission names give the same answers", () => {
  it("joins names with + as 'all of them'", () => {
    const role = { perms: ["a.b.read", "a.b.update:branch"] };
    expect(can(role, "a.b.read+a.b.update")).toBe(true);
    expect(can(role, "a.b.read+a.b.delete")).toBe(false);
    expect(can(role, "a.b.read+")).toBe(false);
    expect(can({ perms: ["*"] }, "a.b.read+a.b.delete")).toBe(true);
    expect(can(null, "a.b.read+a.b.update")).toBe(false);
  });

  it("every business role template answers every check the same way, before and after the role rewrite", () => {
    expect(businessRoles.length).toBeGreaterThan(15);
    for (const role of [...businessRoles, { key: "owner", perms: ["*"] }, { key: "nobody", perms: [] }]) {
      for (const old of Object.keys(LEGACY_ALIASES)) {
        const want = can(role, old);
        const next = newNameFor(old, "business");
        expect(can(role, next), `${role.key}: ${old} -> ${next} (role in old names)`).toBe(want);
        expect(can(inNew(role, LEGACY_ALIASES), next), `${role.key}: ${old} -> ${next} (role in new names)`).toBe(want);
      }
    }
  });

  it("every staff role answers every check the same way, before and after", () => {
    for (const role of [...PLATFORM_ROLE_TEMPLATES, { key: "nobody", perms: [] }]) {
      for (const old of Object.keys(LEGACY_PLATFORM_ALIASES)) {
        const want = can(role, old);
        const next = newNameFor(old, "platform");
        expect(can(role, next), `${role.key}: ${old} -> ${next} (old names)`).toBe(want);
        expect(can(inNew(role, LEGACY_PLATFORM_ALIASES), next), `${role.key}: ${old} -> ${next} (new names)`).toBe(want);
      }
    }
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
