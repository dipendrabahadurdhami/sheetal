// Tests for the ProjectsPage screen on the kit: kit and SDK only, and LiveOps.jsx re-exports it under its old name.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./ProjectsPage.jsx", import.meta.url), "utf8");
const ops = readFileSync(new URL("../../../../business/frontend/src/pages/LiveOps.jsx", import.meta.url), "utf8");

describe("ProjectsPage on the kit", () => {
  it("imports the kit and the SDK only", () => {
    expect(src).toContain('from "@sheetal/ui/primitives"');
    expect(src).toContain('from "@sheetal/sdk/hooks"');
    expect(src).not.toContain("@sheetal/shared/core/ui");
    expect(src).not.toMatch(/from "\.\.\/api/);
  });
  it("is re-exported by LiveOps.jsx under the old name", () => {
    expect(ops).toContain('export { ProjectsPage as LiveProjects } from "@sheetal/app-projects/frontend";');
    expect(ops).not.toContain("export function LiveProjects(");
  });
});
