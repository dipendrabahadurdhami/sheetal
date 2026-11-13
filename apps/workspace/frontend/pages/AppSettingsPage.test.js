// Tests for the per-app settings screen (P2-W6): kit and SDK only, every change goes to PUT /workspace/app-settings/:key, and the field text turns into
// the value the server's type expects.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromText, toText } from "./AppSettingsPage.jsx";

const src = readFileSync(new URL("./AppSettingsPage.jsx", import.meta.url), "utf8");

describe("App settings screen", () => {
  it("uses the kit and the SDK and saves on the server", () => {
    expect(src).toContain('from "@sheetal/ui/primitives"');
    expect(src).toContain('useApiGet("/workspace/app-settings")');
    expect(src).toMatch(/bizApi\("PUT", `\/workspace\/app-settings\/\$\{encodeURIComponent\(s\.key\)\}`, \{ value \}\)/);
    expect(src).not.toContain("@sheetal/shared/core/store");
  });
  it("turns field text into typed values", () => {
    expect(fromText("money", "25,000", true)).toBe(25000);
    expect(fromText("money", "", true)).toBeNull();
    expect(fromText("int", "", false)).toBe(0);
    expect(fromText("list", "a\n\n b ", false)).toEqual(["a", "b"]);
    expect(toText("list", ["a", "b"])).toBe("a\nb");
    expect(toText("money", null)).toBe("");
  });
});
