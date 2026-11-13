// Tests for the POS and Stock screens on the kit: kit and SDK only, a Stock item change sends its version and a 409 reloads, and the old names still work.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const pos = read("./PosPage.jsx"), stock = read("./StockPage.jsx");
const ops = read("../../../../business/frontend/src/pages/LiveOps.jsx"), shim = read("../../../../business/frontend/src/pages/LiveStock.jsx");
const imports = (s) => s.split("\n").filter((l) => l.startsWith("import ")).join("\n");

describe("POS and Stock screens on the kit", () => {
  it("import the kit and the SDK only", () => {
    for (const s of [pos, stock]) {
      expect(s).toContain('from "@sheetal/ui/primitives"');
      expect(s).toContain('from "@sheetal/sdk/hooks"');
      expect(imports(s)).not.toMatch(/@sheetal\/shared\/core\/ui|from "\.\.\//);
    }
  });
  it("send the version with a stock item change and reload on 409", () => {
    expect(stock).toContain("{ ...body, version: ed.version }");
    expect(stock).toContain("{ active, version: x.version }");
    expect(stock).toContain("e.status === 409");
  });
  it("keep the old names", () => {
    expect(ops).toContain('export { PosPage as LivePOS } from "@sheetal/app-pos/frontend";');
    expect(ops).not.toContain("export function LivePOS(");
    expect(shim).toContain('export { StockPage as LiveStock } from "@sheetal/app-pos/frontend";');
  });
});
