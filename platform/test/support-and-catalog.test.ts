// Support token, scope cap, event-bus lookup and the role-catalog round trip (ACCESS.md sections 12 and 13). No database.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { busOf } from "../src/core/host.js";
import { capPermissions, phaseOneCap } from "../src/core/scope-cap.js";
import { makeTestPermissions } from "../src/core/testing/context.js";
import { readSupportToken, signSupportToken, isSupportToken } from "../src/auth/support-token.js";
import { minutesFor, SUPPORT_MAX_MINUTES } from "../src/support/sessions.js";
import { SUPPORT_ROLE_PERMS } from "../src/support/hooks.js";
import { deniedInSupport } from "../src/tenancy/context.js";
import { catalogForTypes, normalizeRolePerms, toGrants } from "../src/tenancy/catalog.js";
import { LEGACY_ALIASES } from "../src/tenancy/permissions.generated.js";

describe("support token", () => {
  const id = "cabc1234567890xyz";
  it("round trips and is recognised", () => {
    const t = signSupportToken("secret", id);
    expect(isSupportToken(t)).toBe(true);
    expect(readSupportToken("secret", t)).toBe(id);
  });
  it("a wrong key, a changed id or a changed signature is refused", () => {
    const t = signSupportToken("secret", id);
    expect(readSupportToken("other", t)).toBeNull();
    expect(readSupportToken("secret", t.replace(id, "cabc1234567890xyZ"))).toBeNull();
    expect(readSupportToken("secret", t.slice(0, -2) + "xx")).toBeNull();
    expect(readSupportToken("secret", "plain-session-token")).toBeNull();
  });
});

describe("minutesFor", () => {
  it("defaults to 15 and clamps to 1..30", () => {
    expect(minutesFor(undefined)).toBe(15);
    expect(minutesFor(0)).toBe(1);
    expect(minutesFor(999)).toBe(SUPPORT_MAX_MINUTES);
  });
});

describe("support role", () => {
  it("never holds a permission the deny list refuses", () => {
    expect(SUPPORT_ROLE_PERMS.length).toBeGreaterThan(0);
    for (const p of SUPPORT_ROLE_PERMS) expect(deniedInSupport(p.replace(/:all$/, ""))).toBe(false);
  });
});

describe("scope cap (one copy, in platform)", () => {
  it("Expenses and Reviews are capped at branch; other apps are not", () => {
    expect(phaseOneCap("expenses")).toBe("branch");
    expect(phaseOneCap("reviews")).toBe("branch");
    expect(phaseOneCap("crm")).toBeNull();
  });
  it("narrows scopes, keeps held/not-held, and uses the message for a missing permission", () => {
    const p = capPermissions(makeTestPermissions({ "expenses.expense.read": "all", "expenses.expense.create": "own" }), "branch", () => "No.");
    expect(p.scopeOf("expenses.expense.read")).toBe("branch");
    expect(p.scopeOf("expenses.expense.create")).toBe("own");
    expect(p.scopeOf("expenses.expense.delete")).toBeNull();
    expect(() => p.require("expenses.expense.delete")).toThrow("No.");
  });
});

describe("busOf", () => {
  it("names the event in the error when the bus is not started", async () => {
    const app = Fastify();
    expect(() => busOf(app, "ExpenseCreated").publish({} as never, "x", {}, 1)).toThrow(/ExpenseCreated/);
    await app.close();
  });
});

describe("role catalog round trip", () => {
  const catalog = catalogForTypes(["real_estate"]);
  const oldAllowed = new Set(Object.keys(LEGACY_ALIASES));
  it("an old name is kept as sent and shows up as new names in grants", () => {
    const old = Object.keys(LEGACY_ALIASES).find((k) => k.startsWith("expenses."));
    if (!old) return;
    const n = normalizeRolePerms([old], { catalog, oldAllowed });
    expect(n.perms).toEqual([old]);
    expect(toGrants([old]).length).toBeGreaterThan(0);
    expect(toGrants([old]).every((g) => /^[a-z_]+\.[a-z_]+\.[a-z_]+:(own|branch|all)$/.test(g))).toBe(true);
  });
  it("a new name gets an explicit scope and survives toGrants unchanged", () => {
    const n = normalizeRolePerms(["expenses.expense.read:branch"], { catalog, oldAllowed });
    expect(n.perms).toEqual(["expenses.expense.read:branch"]);
    expect(toGrants(n.perms)).toEqual(["expenses.expense.read:branch"]);
  });
  it("the Phase 1 cap refuses Expenses wider than a branch, a bad scope is refused, unknown names are listed", () => {
    expect(normalizeRolePerms(["expenses.expense.read:all"], { catalog, oldAllowed }).refused).toHaveLength(1);
    expect(normalizeRolePerms(["expenses.expense.read:galaxy"], { catalog, oldAllowed }).refused).toHaveLength(1);
    expect(normalizeRolePerms(["nope.nothing.here"], { catalog, oldAllowed }).unknown).toEqual(["nope.nothing.here"]);
  });
  it('"*" means everything', () => expect(toGrants(["*"])).toEqual(["*"]));
});
