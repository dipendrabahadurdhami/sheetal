// Tests for Money (platform/src/core/money.ts): exact paisa maths, rounding, splitting and VAT.
// Run with: npm run test -w @sheetal/platform
import { describe, expect, it } from "vitest";
import { AppError } from "../src/core/errors.js";
import { Money } from "../src/core/money.js";

describe("Money: making and reading", () => {
  it("reads rupees and paisa the same way", () => {
    expect(Money.rupees("1250.50").paisa).toBe(125050);
    expect(Money.rupees(1250.5).paisa).toBe(125050);
    expect(Money.rupees("7").paisa).toBe(700);
    expect(Money.rupees("-0.05").paisa).toBe(-5);
    expect(Money.fromRupees("2.5").equals(Money.paisa(250))).toBe(true);
  });
  it("refuses a third decimal, junk and non-numbers instead of rounding", () => {
    for (const bad of ["1.005", "abc", "", "1,000", "1e3", NaN, Infinity, 1e21]) expect(() => Money.rupees(bad as never)).toThrow(AppError);
    expect(() => Money.rupees({} as never)).toThrow(AppError);
  });
  it("refuses fractional or unsafe paisa", () => {
    expect(() => Money.paisa(1.5)).toThrow(AppError);
    expect(() => Money.paisa(Number.MAX_SAFE_INTEGER + 1)).toThrow(AppError);
    expect(() => Money.paisa(2n ** 70n)).toThrow(AppError);
  });
  it("round-trips a Prisma BigInt", () => {
    const m = Money.paisa(123456789n);
    expect(m.toBigInt()).toBe(123456789n);
    expect(Money.fromPaisa(m.toBigInt()).equals(m)).toBe(true);
  });
  it("writes whole rupees only when there are no paisa", () => {
    expect(Money.rupees("1500").toRupeesWhole()).toBe(1500);
    expect(() => Money.rupees("1500.50").toRupeesWhole()).toThrow(AppError);
  });
  it("prints and serialises predictably", () => {
    expect(Money.paisa(125050).toString()).toBe("1250.50");
    expect(Money.paisa(-5).toString()).toBe("-0.05");
    expect(JSON.parse(JSON.stringify({ a: Money.paisa(5) }))).toEqual({ a: { paisa: 5 } });
    expect(Object.isFrozen(Money.zero())).toBe(true);
  });
});

describe("Money: maths", () => {
  it("adds, subtracts, negates and compares", () => {
    const a = Money.rupees("10.10"), b = Money.rupees("0.20");
    expect(a.plus(b).toString()).toBe("10.30");
    expect(a.minus(b).toString()).toBe("9.90");
    expect(a.negate().isNegative()).toBe(true);
    expect(a.negate().abs().equals(a)).toBe(true);
    expect(a.compare(b)).toBe(1); expect(b.compare(a)).toBe(-1); expect(a.compare(a)).toBe(0);
    expect(Money.zero().isZero()).toBe(true);
  });
  it("rounds half away from zero, once, at the end", () => {
    expect(Money.paisa(3).times(0.5).paisa).toBe(2);     // 1.5 -> 2
    expect(Money.paisa(-3).times(0.5).paisa).toBe(-2);   // -1.5 -> -2
    expect(Money.paisa(2).times(0.5).paisa).toBe(1);
    expect(Money.paisa(1005).percent(10).paisa).toBe(101); // 100.5 -> 101
    expect(Money.paisa(-1005).percent(10).paisa).toBe(-101);
    expect(Money.paisa(10).times(0.1).paisa).toBe(1);    // no 0.1 float drift
    expect(Money.paisa(100).times(1.1).paisa).toBe(110);
  });
  it("supports floor and ceil", () => {
    expect(Money.paisa(3).times(0.5, "floor").paisa).toBe(1);
    expect(Money.paisa(3).times(0.5, "ceil").paisa).toBe(2);
    expect(Money.paisa(-3).times(0.5, "floor").paisa).toBe(-2);
    expect(Money.paisa(-3).times(0.5, "ceil").paisa).toBe(-1);
  });
  it("percent works out VAT on top", () => {
    expect(Money.rupees("100").percent(13).toString()).toBe("13.00");
  });
});

describe("Money: split", () => {
  it("never loses or makes a paisa", () => {
    const parts = Money.paisa(100).split([1, 1, 1]);
    expect(parts.map((p) => p.paisa)).toEqual([34, 33, 33]);
    expect(parts.reduce((a, p) => a.plus(p), Money.zero()).paisa).toBe(100);
  });
  it("follows the ratios and handles decimals and zero shares", () => {
    expect(Money.paisa(1000).split([0.5, 0.25, 0.25]).map((p) => p.paisa)).toEqual([500, 250, 250]);
    expect(Money.paisa(10).split([0, 1]).map((p) => p.paisa)).toEqual([0, 10]);
  });
  it("splits a negative amount with the same shares, negated", () => {
    expect(Money.paisa(-100).split([1, 1, 1]).map((p) => p.paisa)).toEqual([-34, -33, -33]);
  });
  it("refuses empty, negative or all-zero shares", () => {
    expect(() => Money.paisa(10).split([])).toThrow(AppError);
    expect(() => Money.paisa(10).split([-1, 2])).toThrow(AppError);
    expect(() => Money.paisa(10).split([0, 0])).toThrow(AppError);
  });
});

describe("Money: VAT included in a total", () => {
  it("Rs 113.00 at 13% is 100.00 + 13.00", () => {
    const r = Money.rupees("113").splitVat(13);
    expect(r.subtotal.toString()).toBe("100.00");
    expect(r.vat.toString()).toBe("13.00");
    expect(r.total.toString()).toBe("113.00");
  });
  it("Rs 1,000 at 13% rounds the subtotal and the two parts still add up", () => {
    const r = Money.rupees("1000").splitVat(13);
    expect(r.subtotal.paisa).toBe(88496);
    expect(r.vat.paisa).toBe(11504);
    expect(r.subtotal.plus(r.vat).equals(r.total)).toBe(true);
  });
  it("refuses a negative rate", () => {
    expect(() => Money.rupees("10").splitVat(-1)).toThrow(AppError);
  });
});
