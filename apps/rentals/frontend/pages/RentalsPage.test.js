// Tests for the Rentals screen on the kit: kit and SDK only, a change sends the row's version and a 409 reloads, and the old path is a one-line shim.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./RentalsPage.jsx", import.meta.url), "utf8");
const shim = readFileSync(new URL("../../../../business/frontend/src/pages/LiveRentals.jsx", import.meta.url), "utf8");

describe("Rentals screen on the kit", () => {
  it("imports the kit and the SDK only", () => {
    expect(src).toContain('from "@sheetal/ui/primitives"');
    expect(src).toContain('from "@sheetal/sdk/hooks"');
    expect(src).not.toContain("@sheetal/shared/core/ui");
    expect(src).not.toMatch(/from "\.\.\/api/);
    expect(src).not.toContain("document.createElement");
  });
  it("sends the version with a change and reloads on 409", () => {
    expect(src).toMatch(/method === "PUT"[^\n]*f\.version/);
    expect(src).toContain("e.status === 409");
  });
  it("leaves a one-line shim at the old path", () => {
    expect(shim).toContain('export { RentalsPage as LiveRentals } from "@sheetal/app-rentals/frontend";');
  });
});
