// What happens at a limit (MB section 6.3, the owner's answer to Q1): hard limits stop new use at 100%; soft limits (money-in activity
// such as POS bills and customer invoices) allow softOverPct more (default 20%), then stop; from 80% people see a warning.
// Where it fits: entitlements v3 requireLimit() (P3-BE-3) calls check() and throws limit_reached when it says refused.
// How it works: integer maths only. The soft ceiling is limit × (100 + pct) / 100 rounded down, so 100 bills at 20% allow 120 and 7 at 20%
// allow 8. A null limit is unlimited and never warns.
// Rules: pure. Limits stop NEW use only; nothing here is ever used to hide or delete a record (MB section 1, rule 2).

import type { CatalogLimit } from "./types.js";

export const WARN_AT_PCT = 80;
export const DEFAULT_SOFT_OVER_PCT = 20;

export interface LimitAnswer {
  /** Show the 80% banner. */
  warn: boolean;
  /** Over 100% (allowed only for soft limits, up to the soft ceiling). */
  over: boolean;
  /** Refuse the new item (limit_reached). */
  refused: boolean;
  /** The most that may exist after this action (the limit, or the soft ceiling); null = unlimited. */
  ceiling: number | null;
}

/** used = how many exist (or were used this month) now; adding = how many this action adds (default 1). */
export function checkLimit(limit: CatalogLimit | { value: number | null; behaviour?: CatalogLimit["behaviour"]; softOverPct?: number }, used: number, adding = 1): LimitAnswer {
  const value = limit.value;
  if (value == null) return { warn: false, over: false, refused: false, ceiling: null };
  const after = used + adding;
  const soft = limit.behaviour === "soft";
  const pct = soft ? Math.min(Math.max(limit.softOverPct ?? DEFAULT_SOFT_OVER_PCT, 0), 100) : 0;
  const ceiling = Math.floor((value * (100 + pct)) / 100);
  return {
    warn: after * 100 >= value * WARN_AT_PCT,
    over: after > value,
    refused: adding > 0 && after > ceiling,
    ceiling,
  };
}

/** Two limits for the same key combine to the larger; null (unlimited) wins (MB section 6.2: a grant or add-on never lowers anything). */
/** undefined = "no value for this key" (neither given), which is different from null (unlimited). */
export function largerLimit(a: number | null | undefined, b: number | null | undefined): number | null | undefined {
  if (a === null || b === null) return null;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/** Old data stored unlimited as -1. */
export const readLimit = (v: unknown): number | null | undefined =>
  v === null ? null : typeof v === "number" ? (v < 0 ? null : v) : undefined;
