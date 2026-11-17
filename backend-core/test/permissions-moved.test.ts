// The proof that the move to the new permission names (stage 1.5) changed nobody's access, against a frozen copy of the OLD code.
// Where it fits: backend-core/test. It replaces permissions-unchanged.test.ts, which pinned the old lists while the shims stood in for them (P1-BE-2).
// How it works: test/permissions-oracle.ts is the old backend permissions.ts and the old screens' rbac.js, frozen and never edited. For every built-in role
// of every business type and every staff role, and for EVERY old permission name: the old code's answer for the old role and old name must equal today's
// answer for today's role (the manifests' names) and the new form of that check (its new names joined with "+", the table every call site was rewritten
// with: scripts/perm-names.mjs). The server rule and the screens' rule are both checked.
// Rules: never edit the oracle to make this pass. A role that should gain or lose something is a deliberate change of an app manifest.
import { describe, expect, it } from "vitest";
import * as api from "../src/domain/permissions.js";
// @ts-expect-error -- the screens' files are plain JavaScript without types
import * as ui from "../../shared/src/core/rbac.js";
// @ts-expect-error -- plain JavaScript without types
import { newNameFor } from "../../scripts/perm-names.mjs";
import { oldApi, oldUi } from "./permissions-oracle.js";

const TYPES = ["hotel", "host", "developer", "agency", "sponsor"] as const;
const next = (old: string, kind: "business" | "platform"): string | null => newNameFor(old, kind);
const businessNames = [...new Set(oldApi.BUSINESS_PERMS.flatMap((g: { perms: string[] }) => g.perms))] as string[];
const staffNames = [...new Set(oldApi.PLATFORM_PERMS.flatMap((g: { perms: string[] }) => g.perms))] as string[];

describe("the new names give every built-in role exactly what the old names gave", () => {
  it("every old name has a new form", () => {
    for (const old of businessNames) expect(next(old, "business"), old).toBeTruthy();
    for (const old of staffNames) expect(next(old, "platform"), old).toBeTruthy();
  });

  it("business roles: same keys in the same order, and the same answer for every old name (server and screens)", () => {
    for (const type of TYPES) {
      const before = oldApi.roleTemplatesFor(type);
      // Standard roles added on purpose (18 Nov 2026) have no old twin: only the roles that existed before are compared.
      const ADDED = ["manager", "customer_care", "viewer", "it_support"];
      const wasThere = (r: { key: string }) => before.some((o: { key: string }) => o.key === r.key) || !ADDED.includes(r.key);
      const now = api.roleTemplatesFor(type).filter(wasThere);
      const nowUi = ui.roleTemplatesFor(type).filter(wasThere);
      expect(now.map((r) => r.key), type).toEqual(before.map((r: { key: string }) => r.key));
      expect(nowUi.map((r: { key: string }) => r.key), type).toEqual(now.map((r) => r.key));
      before.forEach((old: { key: string; perms: string[] }, i: number) => {
        expect(nowUi[i].perms, `${type}/${old.key} screens = server`).toEqual(now[i]!.perms);
        for (const name of businessNames) {
          const want = oldApi.hasPerm(old.perms, name);
          expect(api.hasPerm(now[i]!.perms, next(name, "business")!), `${type}/${old.key}: ${name} (server)`).toBe(want);
          expect(ui.can(nowUi[i], next(name, "business")), `${type}/${old.key}: ${name} (screens)`).toBe(want);
        }
      });
    }
  });

  it("staff roles: same keys in the same order, and the same answer for every old name", () => {
    const ADDED_STAFF = ["it_admin", "moderator"]; // added on purpose (18 Nov 2026), no old twin
    expect(Object.keys(api.PLATFORM_ROLES).filter((k) => !ADDED_STAFF.includes(k))).toEqual(Object.keys(oldApi.PLATFORM_ROLES));
    expect(ui.PLATFORM_ROLE_TEMPLATES.map((r: { key: string }) => r.key).filter((k: string) => !ADDED_STAFF.includes(k))).toEqual(Object.keys(oldApi.PLATFORM_ROLES));
    for (const [key, oldPerms] of Object.entries(oldApi.PLATFORM_ROLES) as [string, string[]][]) {
      for (const name of staffNames) {
        const want = oldApi.hasPerm(oldPerms, name);
        expect(api.hasPerm(api.PLATFORM_ROLES[key]!, next(name, "platform")!), `${key}: ${name} (server)`).toBe(want);
        expect(ui.can(ui.PLATFORM_ROLE_TEMPLATES.find((r: { key: string }) => r.key === key), next(name, "platform")), `${key}: ${name} (screens)`).toBe(want);
      }
    }
  });

  it("the old names themselves are no longer understood, anywhere", () => {
    for (const type of TYPES) {
      for (const role of api.roleTemplatesFor(type)) {
        if (role.perms.includes("*")) continue;
        for (const name of businessNames) expect(api.hasPerm(role.perms, name), `${type}/${role.key}: ${name}`).toBe(false);
      }
    }
    expect(api.hasPerm(["leads.view", "expenses.manage"], "crm.lead.read")).toBe(false);
    expect(api.hasPerm(["crm.lead.read:own"], "leads.view")).toBe(false);
    expect(ui.can({ perms: ["leads.view"] }, "crm.lead.read")).toBe(false);
    expect(api.PLATFORM_ROLES.constructor).toBeUndefined();          // a role named "constructor" matches nothing
  });

  it("business types and the offered permissions come from the manifests", () => {
    expect([...api.BUSINESS_TYPES]).toEqual([...oldApi.BUSINESS_TYPES]);
    expect(Object.keys(ui.BUSINESS_TYPES)).toEqual([...oldApi.BUSINESS_TYPES]);
    for (const type of TYPES) {
      const offered = api.businessPermsFor([type]);
      expect(offered.length).toBeGreaterThan(10);
      expect(offered.every((p) => /^[a-z_]+\.[a-z_]+\.[a-z_]+$/.test(p) && !p.startsWith("platform.")), type).toBe(true);
      // Every grant of a built-in role is something this type of business is offered.
      for (const role of api.roleTemplatesFor(type)) for (const g of role.perms) if (g !== "*") expect(offered, `${type}/${role.key}: ${g}`).toContain(g.split(":")[0]);
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
