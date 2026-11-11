// Tests for the role screen maths (new permission names with scopes).
import { describe, expect, it } from "vitest";
import { capNote, catalogByApp, defaultScope, grantCount, grantsToMap, mapToPerms, sameMap, scopesOffered } from "./roleGrants.js";

const catalog = [
  { id: "workspace.team.read", app: "workspace", appName: "Workspace", label: "See the team", group: "Team", scopes: ["all"], default: "all", cap: null },
  { id: "expenses.expense.read", app: "expenses", appName: "Expenses", label: "See expenses", group: "Expenses", scopes: ["own", "branch", "all"], default: "branch", cap: "branch" },
  { id: "expenses.expense.create", app: "expenses", appName: "Expenses", label: "Add expenses", group: "Expenses", scopes: ["branch", "all"], default: "all", cap: "branch" },
  { id: "rentals.rental.read", app: "rentals", appName: "Rentals", label: "See rentals", group: "Rentals", scopes: ["branch", "all"], default: "branch", cap: null },
];
const byId = Object.fromEntries(catalog.map((e) => [e.id, e]));

describe("role grants", () => {
  it("never offers a scope wider than the app's cap (no 'all' for Expenses in Phase 1)", () => {
    expect(scopesOffered(byId["expenses.expense.read"])).toEqual(["own", "branch"]);
    expect(scopesOffered(byId["expenses.expense.create"])).toEqual(["branch"]);
    expect(scopesOffered(byId["rentals.rental.read"])).toEqual(["branch", "all"]);
  });

  it("gives a newly ticked permission the manifest default, narrowed to the cap", () => {
    expect(defaultScope(byId["expenses.expense.read"])).toBe("branch");
    expect(defaultScope(byId["expenses.expense.create"])).toBe("branch");   // default "all" is above the cap
    expect(defaultScope(byId["workspace.team.read"])).toBe("all");
  });

  it("reads grants, drops permissions of apps the business does not have, and narrows a too-wide scope", () => {
    const map = grantsToMap(["expenses.expense.read:own", "expenses.expense.create:all", "hotel.booking.read:all", "rentals.rental.read:all"], catalog);
    expect(map).toEqual({ "expenses.expense.read": "own", "expenses.expense.create": "branch", "rentals.rental.read": "all" });
  });

  it("writes grants back in catalog order with the scope written out", () => {
    const perms = mapToPerms({ "rentals.rental.read": "all", "workspace.team.read": "all", "expenses.expense.read": "" }, catalog);
    expect(perms).toEqual(["workspace.team.read:all", "rentals.rental.read:all"]);
  });

  it("a round trip changes nothing", () => {
    const grants = ["workspace.team.read:all", "expenses.expense.read:branch", "rentals.rental.read:branch"];
    expect(mapToPerms(grantsToMap(grants, catalog), catalog)).toEqual(grants);
  });

  it("shows the owner as everything, at the widest scope on offer", () => {
    const map = grantsToMap(["*"], catalog);
    expect(map["expenses.expense.read"]).toBe("branch");
    expect(map["rentals.rental.read"]).toBe("all");
    expect(grantCount(["*"], catalog)).toBe(4);
  });

  it("groups by app and explains the cap", () => {
    const apps = catalogByApp(catalog);
    expect(apps.map((a) => a.id)).toEqual(["workspace", "expenses", "rentals"]);
    expect(capNote(apps[1])).toMatch(/branch by branch for now/);
    expect(capNote(apps[0])).toBeNull();
  });

  it("compares two sets of grants", () => {
    expect(sameMap({ a: "all", b: "" }, { a: "all" })).toBe(true);
    expect(sameMap({ a: "all" }, { a: "branch" })).toBe(false);
  });
});
