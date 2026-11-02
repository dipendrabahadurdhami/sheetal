import { describe, expect, it } from "vitest";
import { THEMES, normaliseTheme, themeAttr } from "./theme";

describe("themes", () => {
  it("has light, dark and red", () => { expect(THEMES.map((t) => t.id)).toEqual(["light", "dark", "red"]); });
  it("falls back to light", () => { expect(normaliseTheme("purple")).toBe("light"); expect(normaliseTheme(null)).toBe("light"); });
  it("applies red as dark red", () => { expect(themeAttr("red")).toBe("dark red"); expect(themeAttr("dark")).toBe("dark"); });
});
