import { describe, expect, it } from "vitest";
import { canAsk, otaName, otaSplit } from "./ota";

describe("selling on other sites", () => {
  it("splits a booking into site fee, Sheetal fee and payout", () => {
    const s = otaSplit({}, "booking", 10000);
    expect(s.site + s.fee + s.net).toBe(10000);
    expect(s.commission).toBe(15);
  });
  it("names sites", () => { expect(otaName("airbnb")).toBe("Airbnb"); });
  it("only lets a business ask when not already in progress", () => { expect(canAsk(undefined)).toBe(true); expect(canAsk("live")).toBe(false); expect(canAsk("paused")).toBe(true); });
});
