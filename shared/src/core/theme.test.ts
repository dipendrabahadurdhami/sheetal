import { describe, expect, it } from "vitest";
import { THEMES, normaliseTheme, themeAttr, themeKeyFor } from "./theme";

describe("themes", () => {
  it("has light, dark and red", () => { expect(THEMES.map((t) => t.id)).toEqual(["light", "dark", "red"]); });
  it("falls back to light", () => { expect(normaliseTheme("purple")).toBe("light"); expect(normaliseTheme(null)).toBe("light"); });
  it("keeps a separate theme for the website, /business and /admin", () => {
    expect(themeKeyFor("/")).toBe("sheetal_theme");
    expect(themeKeyFor("/stays/S-1")).toBe("sheetal_theme");
    expect(themeKeyFor("/business")).toBe("sheetal_theme_business");
    expect(themeKeyFor("/business/listings")).toBe("sheetal_theme_business");
    expect(themeKeyFor("/admin/status")).toBe("sheetal_theme_admin");
    expect(themeKeyFor("/businesses")).toBe("sheetal_theme");
  });
  it("applies red as dark red", () => { expect(themeAttr("red")).toBe("dark red"); expect(themeAttr("dark")).toBe("dark"); });
});
