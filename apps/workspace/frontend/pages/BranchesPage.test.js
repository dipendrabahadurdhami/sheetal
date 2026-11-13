// Tests for the Branches page on the kit: it uses the kit and the SDK (never the panel store, the old UI file or the panel's live/api files),
// sends the version with an edit and with closing or reopening (a stale page gets 409 and reloads), and the old name is a shim.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { branchFields } from "./BranchesPage.jsx";

const src = readFileSync(new URL("./BranchesPage.jsx", import.meta.url), "utf8");
const old = readFileSync(new URL("../../../../business/frontend/src/pages/Branches.jsx", import.meta.url), "utf8");

describe("Branches page on the kit", () => {
  it("imports the kit and the SDK only", () => {
    expect(src).toContain('from "@sheetal/ui/primitives"');
    expect(src).toContain('from "@sheetal/sdk/hooks"');
    expect(src).not.toContain("@sheetal/shared/core/ui");
    expect(src).not.toContain("@sheetal/shared/core/store");
    expect(src).not.toMatch(/from "\.\.\/(\.\.\/)?(api|live)"/);
  });
  it("sends the version with an edit and with closing or reopening", () => {
    expect(src).toMatch(/PATCH", `\/branches\/\$\{b\.id\}`, \{ \.\.\.branchFields\(b\), version: b\.version \}/);
    expect(src).toMatch(/status: open \? "open" : "closed", version: b\.version/);
  });
  it("sends empty text as null and trims the name", () => {
    expect(branchFields({ name: " Pokhara ", address: "", phone: "01", manager: "", receipt: "" })).toEqual({ name: "Pokhara", address: null, phone: "01", manager: null, receipt: null });
  });
  it("is what LiveBranches renders", () => {
    expect(old).toContain('import { BranchesPage } from "@sheetal/app-workspace/frontend";');
    expect(old).toMatch(/<BranchesPage tenant=\{tenant\} onChanged=\{branchesRefresh\}/);
  });
});
