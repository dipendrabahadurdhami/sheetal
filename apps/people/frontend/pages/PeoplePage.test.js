// Tests for the People screen on the kit: it uses the kit and the SDK (never the old hand-written loader or the old UI file), and sends `version` with every
// change the server versions (a fix, a leave-type edit, a decision), so a stale page gets 409 and reloads.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./PeoplePage.jsx", import.meta.url), "utf8");
const shim = readFileSync(new URL("../../../../business/frontend/src/pages/LivePeople.jsx", import.meta.url), "utf8");

describe("People screen on the kit", () => {
  it("imports the kit and the SDK only", () => {
    expect(src).toContain('from "@sheetal/ui/primitives"');
    expect(src).toContain('from "@sheetal/sdk/hooks"');
    expect(src).not.toContain("@sheetal/shared/core/ui");
    expect(src).not.toMatch(/from "\.\.\/api/);
    expect(src).not.toContain("document.createElement");   // the CSV comes from the kit
  });
  it("sends the version with a fix, a leave-type edit and a decision", () => {
    expect(src).toMatch(/\/people\/attendance\/\$\{f\.id\}`, \{[^}]*version: f\.version/);
    expect(src).toMatch(/\/people\/leave-types\/\$\{form\.id\}`, \{[^}]*version: form\.version/);
    expect(src).toMatch(/\/decide`, \{[^}]*version: l\.version/);
  });
  it("leaves a one-line shim at the old path", () => {
    expect(shim).toContain('export { PeoplePage as LivePeople } from "@sheetal/app-people/frontend";');
  });
});
