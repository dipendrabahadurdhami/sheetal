// Tests for Stars: rounding to whole stars and the spoken labels.
import { describe, expect, it, vi } from "vitest";

vi.mock("@sheetal/shared/core/icons", () => ({ Icon: () => null }));

import { pickLabel, starsLabel, starsOn } from "./Stars.jsx";

describe("Stars", () => {
  it("rounds to the nearest whole star: 3.4 → 3, 3.5 → 4, 4.6 → 5", () => {
    expect([3.4, 3.5, 4.6].map(starsOn)).toEqual([3, 4, 5]);
  });
  it("keeps the count between 0 and 5, and ignores odd values", () => {
    expect([0, -2, 7, null, undefined, "x", NaN].map(starsOn)).toEqual([0, 0, 5, 0, 0, 0, 0]);
    expect(starsOn("4")).toBe(4);
  });
  it("the spoken label keeps the real rating", () => {
    expect(starsLabel(3.5)).toBe("3.5 out of 5 stars");
    expect(starsLabel(5)).toBe("5 out of 5 stars");
  });
  it("pickable stars are named 1 star, 2 stars … 5 stars", () => {
    expect([1, 2, 5].map(pickLabel)).toEqual(["1 star", "2 stars", "5 stars"]);
  });
});
