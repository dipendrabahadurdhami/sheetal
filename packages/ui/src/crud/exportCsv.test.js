// Tests for the CSV cell guard: a text cell starting with = + - @ must not run as a formula in Excel.
import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./exportCsv.js";

describe("csvCell", () => {
  it.each(["=SUM(A1:A9)", "=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(1)", "=HYPERLINK(\"http://x\")", "\t=1", "\r=1"])("escapes %j with a leading quote", (v) => {
    const out = csvCell(v);
    expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("leaves real numbers alone, so negative amounts and +977 phones stay numbers", () => {
    expect(csvCell("-1500")).toBe("-1500");
    expect(csvCell(-1500)).toBe("-1500");
    expect(csvCell("+9779800000000")).toBe("+9779800000000");
  });
  it("leaves ordinary text alone", () => { expect(csvCell("Rent")).toBe("Rent"); expect(csvCell(null)).toBe(""); expect(csvCell(undefined)).toBe(""); });
  it("quotes commas, quotes and new lines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("guards first, then quotes, when both apply", () => {
    expect(csvCell("=A1,B1")).toBe(`"'=A1,B1"`);
  });
  it("guards every cell of a file", () => {
    expect(toCsv(["Vendor", "Note"], [["Ram", "=1+1"], ["@x", "ok"]])).toBe("Vendor,Note\r\nRam,'=1+1\r\n'@x,ok");
  });
});
