// Money in paisa (1 rupee = 100 paisa): one class for every amount in the new code.
// Where it fits: services and repositories of the kernel (KERNEL.md section 4). The old whole-rupee helpers in
// backend-core/src/domain/money.ts (hotel bill, invoice maths) are a different thing and stay as they are.
// How it works: the amount is always a whole number of paisa (a safe integer). Anything that could leave a fraction of a
// paisa (percent, times, split, VAT) is calculated with BigInt on exact decimals, never with floating point, and rounded
// ONCE at the end: half away from zero (0.5 paisa -> 1, -0.5 paisa -> -1), the usual shop-counter rule.
// Rules: never do money maths with plain numbers in an app; use Money. A fraction of a paisa is refused, not rounded
// silently, when it comes in as input (Money.rupees("12.505") throws). Negative amounts are allowed (refunds).

import { badRequest } from "./errors.js";

export type RoundMode = "round" | "floor" | "ceil";

const bad = badRequest;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);

/** Divides and rounds. "round" = half away from zero, "floor" = towards minus infinity, "ceil" = towards plus infinity. */
function divide(num: bigint, den: bigint, mode: RoundMode): bigint {
  if (den < 0n) { num = -num; den = -den; }
  const q = num / den; // BigInt division truncates towards zero
  const r = num % den;
  if (r === 0n) return q;
  if (mode === "floor") return num < 0n ? q - 1n : q;
  if (mode === "ceil") return num < 0n ? q : q + 1n;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice < den) return q;
  return num < 0n ? q - 1n : q + 1n; // half or more: away from zero
}

/** A finite number as an exact decimal: 1.005 -> { int: 1005n, scale: 3 }. Exponent forms are written out first. */
function decimal(n: number): { int: bigint; scale: number } {
  if (typeof n !== "number" || !Number.isFinite(n)) throw bad("That isn't a valid number.");
  let s = String(n);
  if (/e/i.test(s)) s = n.toFixed(12).replace(/\.?0+$/, "");
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw bad("That isn't a valid number.");
  const frac = m[3] ?? "";
  return { int: BigInt(`${m[1]}${m[2]}${frac}`), scale: frac.length };
}

function toSafe(b: bigint): number {
  if (b > MAX || b < -MAX) throw bad("That amount is too large.");
  return Number(b);
}

export class Money {
  /** Always a safe integer. Negative for refunds. */
  readonly paisa: number;

  private constructor(paisa: number) {
    this.paisa = paisa === 0 ? 0 : paisa; // never -0
    Object.freeze(this);
  }

  // ── Making money ──

  /** From a whole number of paisa (a number or a Prisma BigInt). Refuses fractions, NaN, Infinity and unsafe sizes. */
  static paisa(n: number | bigint): Money {
    if (typeof n === "bigint") return new Money(toSafe(n));
    if (typeof n !== "number" || !Number.isSafeInteger(n)) throw bad("An amount must be a whole number of paisa.");
    return new Money(n);
  }
  static fromPaisa(n: number | bigint): Money { return Money.paisa(n); }

  /** From rupees: "1250.50" or 1250.5 -> 125050 paisa. At most 2 decimals; more is refused, never rounded. */
  static rupees(r: number | string): Money {
    if (typeof r !== "number" && typeof r !== "string") throw bad("That isn't a valid amount.");
    let s: string;
    if (typeof r === "number") {
      if (!Number.isFinite(r)) throw bad("That isn't a valid amount.");
      s = String(r);
      if (/e/i.test(s)) throw bad("That amount can't be written with whole paisa.");
    } else s = r.trim();
    const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) throw bad(/^-?\d+\.\d{3,}$/.test(s) ? "An amount can have at most 2 decimals (paisa)." : "That isn't a valid amount.");
    const paisa = BigInt(m[2]!) * 100n + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
    return new Money(toSafe(m[1] ? -paisa : paisa));
  }
  /** Same as rupees(); the name the task text and old-endpoint code use. */
  static fromRupees(r: number | string): Money { return Money.rupees(r); }

  static zero(): Money { return new Money(0); }

  // ── Maths (every result is a new Money) ──

  plus(o: Money): Money { return new Money(toSafe(BigInt(this.paisa) + BigInt(o.paisa))); }
  minus(o: Money): Money { return new Money(toSafe(BigInt(this.paisa) - BigInt(o.paisa))); }
  negate(): Money { return new Money(-this.paisa); }
  abs(): Money { return new Money(Math.abs(this.paisa)); }

  /** n may be fractional (1.5, 0.333): worked out exactly, then rounded once. */
  times(n: number, mode: RoundMode = "round"): Money {
    const d = decimal(n);
    return new Money(toSafe(divide(BigInt(this.paisa) * d.int, 10n ** BigInt(d.scale), mode)));
  }

  /** pct percent of this amount, e.g. percent(13) is the VAT to add on top. Default rounding is "round". */
  percent(pct: number, mode: RoundMode = "round"): Money {
    const d = decimal(pct);
    return new Money(toSafe(divide(BigInt(this.paisa) * d.int, 100n * 10n ** BigInt(d.scale), mode)));
  }

  /** Shares in the given proportions; they always add back to the original amount, so no paisa is lost or made.
   *  The paisa left over after the exact shares go to the biggest remainders first (ties: the earlier share). */
  split(ratios: readonly number[]): Money[] {
    if (!ratios.length) throw bad("Give at least one share.");
    const parts = ratios.map((r) => {
      if (typeof r !== "number" || !Number.isFinite(r) || r < 0) throw bad("Shares must be zero or more.");
      return decimal(r);
    });
    const scale = Math.max(...parts.map((p) => p.scale));
    const weights = parts.map((p) => p.int * 10n ** BigInt(scale - p.scale));
    const total = weights.reduce((a, b) => a + b, 0n);
    if (total === 0n) throw bad("Shares must add up to more than zero.");
    const amount = BigInt(Math.abs(this.paisa));
    const base = weights.map((w) => (amount * w) / total);
    const rest = weights.map((w) => (amount * w) % total);
    let left = Number(amount - base.reduce((a, b) => a + b, 0n)); // fewer than ratios.length
    const order = rest.map((r, i) => ({ r, i })).sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
    for (const { i } of order) {
      if (left <= 0) break;
      base[i] = base[i]! + 1n;
      left--;
    }
    const sign = this.paisa < 0 ? -1n : 1n;
    return base.map((b) => new Money(toSafe(b * sign)));
  }

  /** This amount already includes VAT (like domain/billing.ts splitVat): subtotal = total / (1 + rate), VAT = the rest.
   *  subtotal + vat = total always. Example: Rs. 113.00 at 13% -> subtotal 100.00, VAT 13.00. */
  splitVat(ratePct: number): { subtotal: Money; vat: Money; total: Money } {
    const d = decimal(ratePct);
    if (d.int < 0n) throw bad("A VAT rate can't be negative.");
    const unit = 100n * 10n ** BigInt(d.scale); // 100% in the rate's own scale
    const subtotal = divide(BigInt(this.paisa) * unit, unit + d.int, "round");
    const sub = new Money(toSafe(subtotal));
    return { subtotal: sub, vat: this.minus(sub), total: this };
  }

  // ── Comparing ──

  compare(o: Money): -1 | 0 | 1 { return this.paisa < o.paisa ? -1 : this.paisa > o.paisa ? 1 : 0; }
  equals(o: Money): boolean { return this.paisa === o.paisa; }
  isZero(): boolean { return this.paisa === 0; }
  isNegative(): boolean { return this.paisa < 0; }

  // ── Leaving Money ──

  /** For old endpoints that still send whole rupees. Throws if there are paisa left: nothing is rounded silently. */
  toRupeesWhole(): number {
    if (this.paisa % 100 !== 0) throw bad("This amount has paisa and can't be shown in whole rupees.");
    return this.paisa / 100;
  }
  /** For a Prisma BigInt column (<field>Paisa). */
  toBigInt(): bigint { return BigInt(this.paisa); }
  /** "1250.50", "-0.05". */
  toString(): string {
    const abs = Math.abs(this.paisa);
    return `${this.paisa < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  }
  /** New endpoints send { paisa: 125050 }. */
  toJSON(): { paisa: number } { return { paisa: this.paisa }; }
}
