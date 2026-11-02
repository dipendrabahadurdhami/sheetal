import { describe, expect, it } from "vitest";
import { match } from "./router";

describe("route matching", () => {
  it("reads params", () => { expect(match("/admin/tenants/:id", "/admin/tenants/t1")).toEqual({ id: "t1" }); });
  it("ignores a trailing slash", () => { expect(match("/admin", "/admin/")).toEqual({}); });
  it("rejects other paths", () => { expect(match("/admin/tenants/:id", "/admin/plans")).toBeNull(); });
});
