import { describe, expect, it } from "vitest";
import { planWord } from "./LiveBilling.jsx";

describe("billing page words", () => {
  it("names the plan of an old invoice and says apps for a Marketplace purchase", () => {
    expect(planWord("hotel-pro")).toBe("pro");
    expect(planWord(null)).toBe("apps");
    expect(planWord("")).toBe("apps");
  });
});
