import { describe, expect, it } from "vitest";
import { contrastWithWhite, inkFor, btnInkFor } from "./contrast";

describe("brand colour contrast", () => {
  it("keeps dark brand colours as they are", () => {
    expect(inkFor("#9D1D21")).toBe("#9D1D21");
    expect(btnInkFor("#9D1D21")).toBe("#FFFFFF");
  });
  it("darkens light brand colours for text", () => {
    expect(contrastWithWhite("#FFD54F")).toBeLessThan(3);
    expect(inkFor("#FFD54F")).toContain("color-mix");
    expect(btnInkFor("#FFD54F")).toBe("#1F1F21");
  });
  it("ignores values that are not #rrggbb", () => {
    expect(inkFor("red")).toBe("red");
  });
});
