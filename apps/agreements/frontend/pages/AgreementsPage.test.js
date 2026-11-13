// Tests for the Agreements screen on the kit: it uses the kit and the SDK only, and the old path is a one-line shim.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./AgreementsPage.jsx", import.meta.url), "utf8");
const shim = readFileSync(new URL("../../../../business/frontend/src/pages/LiveAgreements.jsx", import.meta.url), "utf8");

describe("Agreements screen on the kit", () => {
  it("imports the kit and the SDK only", () => {
    expect(src).toContain('from "@sheetal/ui/primitives"');
    expect(src).toContain('from "@sheetal/sdk/client"');
    expect(src).not.toContain("@sheetal/shared/core/ui");
    expect(src).not.toMatch(/from "\.\.\/api/);
  });
  it("leaves a one-line shim at the old path", () => {
    expect(shim).toContain('export { AgreementsPage as LiveAgreements } from "@sheetal/app-agreements/frontend";');
  });
});
