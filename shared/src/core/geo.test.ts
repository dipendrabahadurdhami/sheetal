import { describe, expect, it } from "vitest";
import { approx, metresBetween, validLatLng, directionsUrl } from "./geo";

describe("approx", () => {
  const home = [27.7457, 85.3297];

  it("moves the point 150–350 m away, never onto the property", () => {
    for (const seed of ["SP1001", "SP1002", "L-2003", 42, "x"]) {
      const d = metresBetween(home, approx(home[0], home[1], seed));
      expect(d).toBeGreaterThan(130); // 4-decimal rounding can shave ~10 m
      expect(d).toBeLessThan(370);
    }
  });

  it("gives the same point for the same listing every time", () => {
    expect(approx(home[0], home[1], "SP1001")).toEqual(approx(home[0], home[1], "SP1001"));
  });

  it("gives different listings different points", () => {
    expect(approx(home[0], home[1], "SP1001")).not.toEqual(approx(home[0], home[1], "SP1002"));
  });
});

describe("validLatLng", () => {
  it("accepts numbers and numeric strings, rejects empty or out of range", () => {
    expect(validLatLng("27.7", "85.3")).toEqual([27.7, 85.3]);
    expect(validLatLng(null, 85)).toBeNull();
    expect(validLatLng(95, 85)).toBeNull();
  });
});

it("builds a Google Maps directions link", () => {
  expect(directionsUrl(28.21, 83.95)).toBe("https://www.google.com/maps/dir/?api=1&destination=28.21,83.95");
});
