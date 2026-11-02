import { describe, expect, it } from "vitest";
import { fdate, initials, isEmail, limitText, rs, rsShort } from "./format";

describe("money", () => {
  it("formats rupees with Indian grouping", () => { expect(rs(1234567)).toBe("Rs. 12,34,567"); });
  it("rounds and handles empty values", () => { expect(rs(99.6)).toBe("Rs. 100"); expect(rs(undefined)).toBe("Rs. 0"); });
  it("shortens lakh and crore", () => { expect(rsShort(250000)).toBe("Rs. 2.5 Lakh"); expect(rsShort(32000000)).toBe("Rs. 3.2 Cr"); expect(rsShort(9000)).toBe("Rs. 9,000"); });
});

describe("text", () => {
  it("formats dates", () => { expect(fdate("2027-03-12")).toBe("12 Mar 2027"); expect(fdate(null)).toBe("—"); });
  it("makes initials", () => { expect(initials("Fewa View Villa")).toBe("FV"); });
  it("checks emails", () => { expect(isEmail("sita@gmail.com")).toBe(true); expect(isEmail("sita@")).toBe(false); });
  it("shows unlimited plan limits", () => { expect(limitText(-1)).toBe("∞"); });
});
