// Tests for the Team and Roles pages on the kit: they use the kit and the SDK (never the old UI file, the panel's api/live files or the panel store),
// branch access goes to the server by branch ID, a member change that changes nothing sends nothing, and the old paths are shims.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { activityText, memberBody, toMember } from "./TeamPage.jsx";

const team = readFileSync(new URL("./TeamPage.jsx", import.meta.url), "utf8");
const roles = readFileSync(new URL("./RolesPage.jsx", import.meta.url), "utf8");
const rolesShim = readFileSync(new URL("../../../../business/frontend/src/pages/LiveRoles.jsx", import.meta.url), "utf8");
const pages = readFileSync(new URL("../../../../business/frontend/src/pages/BusinessPages.jsx", import.meta.url), "utf8");
const branches = [{ id: "b1", name: "Head office" }, { id: "b2", name: "Pokhara" }];

describe("Team page on the kit", () => {
  it("imports the kit and the SDK only", () => {
    for (const src of [team, roles]) {
      expect(src).toContain('from "@sheetal/ui/primitives"');
      expect(src).toContain("@sheetal/sdk/");
      expect(src).not.toContain("@sheetal/shared/core/ui");
      expect(src).not.toContain("@sheetal/shared/core/store");
      expect(src).not.toMatch(/from "\.\.\/(\.\.\/)?(api|live)"/);
    }
  });
  it("sends branch access by id, and paused for a suspended member", () => {
    expect(memberBody({ scopes: ["Pokhara"] }, branches)).toEqual({ roleId: undefined, branchIds: ["b2"], status: undefined });
    expect(memberBody({ status: "suspended" }, branches)).toMatchObject({ status: "paused" });
    expect(memberBody({ scopes: "all", roleId: "r1" }, branches)).toMatchObject({ roleId: "r1", branchIds: "all" });
  });
  it("sends nothing when only a screen-only field changes", () => {
    expect(memberBody({ twofa: true }, branches)).toBeUndefined();
  });
  it("maps the server's answer to the screen", () => {
    expect(toMember({ id: "m", name: "A", email: "a@x", roleId: "r", status: "paused", scopes: "all", branchIds: "all" }).status).toBe("suspended");
    expect(activityText({ what: "business.member_invited", target: "a@x" })).toBe("member invited a@x");
  });
  it("is used for real businesses; the old role file is a shim", () => {
    expect(pages).toMatch(/if \(isLive\(tenant\.id\)\) return <LiveTeam/);
    expect(pages).toContain('import { TeamPage } from "@sheetal/app-workspace/frontend";');
    expect(rolesShim).toContain("<RolesPage {...props} onChanged={liveRefresh} />");
  });
});
