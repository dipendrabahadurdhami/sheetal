// Tests for branch access by id on the team screen.
import { describe, expect, it } from "vitest";
import { branchBody, namesToIds, worksAt } from "./branchAccess.js";

const branches = [{ id: "b1", name: "Head office" }, { id: "b2", name: "Thamel" }];

describe("branch access by id", () => {
  it("turns names into ids", () => {
    expect(namesToIds("all", branches)).toBe("all");
    expect(namesToIds(["Thamel"], branches)).toEqual(["b2"]);
    expect(namesToIds(undefined, branches)).toBeUndefined();
    expect(namesToIds(["Gone"], branches)).toBeNull();
  });
  it("sends ids, and falls back to names only when a name is unknown", () => {
    expect(branchBody(["Head office", "Thamel"], branches)).toEqual({ branchIds: ["b1", "b2"] });
    expect(branchBody("all", branches)).toEqual({ branchIds: "all" });
    expect(branchBody(["Gone"], branches)).toEqual({ scopes: ["Gone"] });
    expect(branchBody(undefined, branches)).toEqual({});
  });
  it("filters members by the picked branch id, so a renamed branch keeps its people", () => {
    const m = { branchIds: ["b2"], scopes: ["Old name of Thamel"] };
    expect(worksAt(m, "b2", "Thamel")).toBe(true);
    expect(worksAt(m, "b1", "Head office")).toBe(false);
    expect(worksAt(m, "all", "all")).toBe(true);
    expect(worksAt({ branchIds: "all" }, "b1", "Head office")).toBe(true);
    expect(worksAt({ scopes: ["Thamel"] }, "b9", "Thamel")).toBe(true);   // sample data has names only
  });
});
