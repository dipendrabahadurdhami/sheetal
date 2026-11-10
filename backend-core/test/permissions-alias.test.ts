// Test: the alias layer (ACCESS.md section 6.3, point 1): old names and new names are accepted both ways.
// Where it fits: backend-core/test. Checks the server resolver (platform/src/tenancy/aliases.ts, used by permissions.ts hasPerm) and the
// screens' copy of the same rule (shared/src/core/rbac.js `can`) on the same cases.
// How it works: for every old name, its new names are looked up in the alias map; holding the old name must give every new name, holding
// all the new names must give the old name, and holding all but one must not. Then the two implementations are run against many role shapes.
// Rules: the map is read from the generated file, which comes from the manifests and legacy-v1.ts; this test never edits it.
// Run with: npm run test -w @sheetal/backend-core
import { describe, expect, it } from "vitest";
import { hasPerm, LEGACY_ALIASES, LEGACY_PLATFORM_ALIASES } from "../src/domain/permissions.js";
import { newNamesOf, oldNamesOf } from "@sheetal/platform/tenancy/aliases";
import { PERMISSION_CATALOG } from "@sheetal/platform/tenancy/permissions.generated";
// @ts-expect-error -- the screens' files are plain JavaScript without types
import { can } from "../../shared/src/core/rbac.js";
import { oldApi } from "./permissions-oracle.js";

const declared = new Set(PERMISSION_CATALOG.map((p) => p.id));
const maps: [string, Record<string, string[]>][] = [["business", LEGACY_ALIASES], ["staff", LEGACY_PLATFORM_ALIASES]];
const screens = (perms: string[], perm: string) => can({ perms }, perm);

describe("the alias map", () => {
  it("has an entry for every old permission name, and nothing else", () => {
    const oldBusiness = oldApi.BUSINESS_PERMS.flatMap((g) => g.perms).sort();
    const oldStaff = oldApi.PLATFORM_PERMS.flatMap((g) => g.perms).sort();
    expect(Object.keys(LEGACY_ALIASES).sort()).toEqual(oldBusiness);
    expect(Object.keys(LEGACY_PLATFORM_ALIASES).sort()).toEqual(oldStaff);
  });
  it("points every old name at declared new names, with no repeats", () => {
    for (const [label, map] of maps) {
      for (const [old, news] of Object.entries(map)) {
        expect(news.length, `${label} ${old}`).toBeGreaterThan(0);
        expect(new Set(news).size, `${label} ${old}`).toBe(news.length);
        for (const n of news) expect(declared.has(n), `${old} -> ${n}`).toBe(true);
        for (const n of news) expect(n.split("."), n).toHaveLength(3);
      }
    }
  });
  it("maps the one-to-one old names to exactly one new name (the rest are 'manage'-style names that stand for several)", () => {
    const single = Object.entries(LEGACY_ALIASES).filter(([, n]) => n.length === 1).map(([o]) => o);
    expect(single).toEqual(expect.arrayContaining(["overview.view", "bookings.view", "pos.void", "leads.view", "billing.manage", "team.view"]));
    expect(LEGACY_ALIASES["expenses.view"]).toHaveLength(3);
    expect(LEGACY_ALIASES["expenses.manage"]).toHaveLength(10);
    expect(LEGACY_ALIASES["customers.view"]).toEqual(["crm.customer.read", "reviews.review.read"]);
  });
  it("leaves no business permission without an old name (every new name traces back)", () => {
    const targets = new Set(Object.values(LEGACY_ALIASES).flat());
    for (const p of PERMISSION_CATALOG.filter((c) => c.app !== "platform")) expect(targets.has(p.id), p.id).toBe(true);
  });
  it("the only staff permissions without an old name are the new ones from ACCESS.md 6.2", () => {
    const targets = new Set(Object.values(LEGACY_PLATFORM_ALIASES).flat());
    const fresh = PERMISSION_CATALOG.filter((c) => c.app === "platform" && !targets.has(c.id)).map((c) => c.id).sort();
    expect(fresh).toEqual(["platform.business.impersonate_write", "platform.integration.manage", "platform.integration.read", "platform.pricing.manage", "platform.revenue.read", "platform.revenue_share.manage", "platform.settings.security"]);
  });
});

describe.each([["server hasPerm", hasPerm], ["screens can", screens]] as const)("%s accepts old and new names", (_label, check) => {
  it("old name -> all of its new names, both ways", () => {
    for (const [label, map] of maps) {
      for (const [old, news] of Object.entries(map)) {
        for (const n of news) expect(check([old], n), `${label}: holding ${old} should give ${n}`).toBe(true);
        expect(check(news, old), `${label}: holding ${news.join()} should give ${old}`).toBe(true);
        expect(check(news.map((n) => `${n}:branch`), old), `${label}: with scopes`).toBe(true);
        if (news.length > 1) for (const left of news) expect(check(news.filter((n) => n !== left), old), `${label}: ${old} without ${left}`).toBe(false);
        expect(check([], old)).toBe(false);
      }
    }
  });
  it("holding one old name never gives a new name it does not stand for", () => {
    for (const old of [...Object.keys(LEGACY_ALIASES), ...Object.keys(LEGACY_PLATFORM_ALIASES)]) {
      const stands = new Set(newNamesOf(old));
      for (const n of declared) if (!stands.has(n)) expect(check([old], n), `${old} must not give ${n}`).toBe(false);
    }
  });
  it("the examples from the task", () => {
    expect(check(["expenses.manage"], "expenses.expense.create")).toBe(true);
    expect(check(["expenses.view"], "expenses.expense.create")).toBe(false);
    expect(check(["expenses.view"], "expenses.profit.read")).toBe(true);
    expect(check(["expenses.expense.read", "expenses.recurring.read", "expenses.profit.read"], "expenses.view")).toBe(true);
    expect(check(["expenses.expense.read", "expenses.recurring.read"], "expenses.view")).toBe(false);
    expect(check(["customers.view"], "reviews.review.read")).toBe(true);
    expect(check(["reviews.reply"], "reviews.review.read")).toBe(true);
    expect(check(["reviews.reply"], "crm.customer.read")).toBe(false);
    expect(check(["reviews.review.read", "crm.customer.read"], "customers.view")).toBe(true);
  });
  it("'*' still means everything, for old and new names", () => {
    expect(check(["*"], "expenses.manage")).toBe(true);
    expect(check(["*"], "expenses.expense.create")).toBe(true);
    expect(check(["*"], "platform.settings.security")).toBe(true);
  });
  it("business and staff names do not leak into each other", () => {
    expect(check(["platform.role.manage"], "workspace.role.read")).toBe(false);
    expect(check(["workspace.role.read", "workspace.role.create", "workspace.role.update", "workspace.role.delete"], "platform.role.manage")).toBe(false);
    expect(check(["roles.manage"], "workspace.role.create")).toBe(true);
    expect(check(["roles.manage"], "platform.role.manage")).toBe(true);   // an old name stands for both of its meanings; the call site decides which one it asks about
    expect(check(["settings.platform"], "platform.settings.security")).toBe(false);
    expect(check(["platform.role.manage"], "roles.manage")).toBe(true);
  });
  it("unknown names are false, not an error", () => {
    expect(check(["expenses.manage"], "made.up.name")).toBe(false);
    expect(check([], "")).toBe(false);
  });
});

describe("the helper lists", () => {
  it("newNamesOf and oldNamesOf are each other's reverse", () => {
    for (const [old, news] of Object.entries(LEGACY_ALIASES)) {
      expect(newNamesOf(old)).toEqual(expect.arrayContaining(news));
      for (const n of news) expect(oldNamesOf(n)).toContain(old);
    }
    expect(newNamesOf("made.up")).toEqual([]);
    expect(oldNamesOf("made.up.name")).toEqual([]);
  });
});

describe("server and screens give the same answers", () => {
  it("on thousands of role shapes", () => {
    const olds = [...Object.keys(LEGACY_ALIASES), ...Object.keys(LEGACY_PLATFORM_ALIASES)];
    const news = [...declared];
    const pool = [...olds, ...news, "*"];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 400; i++) {
      const size = Math.floor(rnd() * 12);
      const perms = Array.from({ length: size }, () => pool[Math.floor(rnd() * pool.length)]!).map((p) => (rnd() < 0.3 && p !== "*" ? `${p}:branch` : p));
      for (const ask of [...olds.slice(0, 20), ...news.slice(0, 20), "x.y.z"]) expect(screens(perms, ask), `${perms.join()} / ${ask}`).toBe(hasPerm(perms, ask));
    }
  });
});
