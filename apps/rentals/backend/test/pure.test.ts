// Tests of Rentals that need no database: the rent rules, the input schemas, the Phase 1 scope cap, the event payloads, and the bill generator and statement maths run against a tiny in-memory stand-in for the database.
// Where it fits: npm run test -w @sheetal/app-rentals (also part of npm run check). The database tests of the app are business/backend/test/rentals-kernel.test.ts.
// How it works: plain Vitest; `fakeDb` answers only the few Prisma calls runRentBills and statementsFor make.
// Rules: every business rule that does not need a request has a test here: bill status, late fee, management fee, statement = collected - fee - repairs, one bill per lease and month, a late fee once.

import { describe, expect, it } from "vitest";
import type { Db } from "@sheetal/platform/db/client";
import { makeTestPermissions } from "@sheetal/platform/core/testing/context";
import { runRentBills } from "../bills.js";
import { RENT_EVENTS, billCreatedPayload, paisa, paymentPayload } from "../events.js";
import { BillAmountBody, LeaseBody, OwnerBody, PaymentBody, RejectBody, CreateOwnerSchema, bp, versionIn } from "../schemas.js";
import { cappedPermissions } from "../scope.js";
import { statementsFor } from "../statement.repository.js";
import { addDays, balanceOf, billNo, billStatus, dueDateOf, feeOf, lastDayOf, lateFeeOf, leaseCovers, leaseNo, repairNo } from "../rentals.js";
import type { PaymentRow } from "../types.js";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("codes and dates", () => {
  it("formats the codes", () => {
    expect(leaseNo(7)).toBe("LS-0007");
    expect(billNo(12)).toBe("RB-0012");
    expect(repairNo(3)).toBe("WO-0003");
  });
  it("finds the last day of a month, adds days, and clamps the due day to 1..28", () => {
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2024-02")).toBe("2024-02-29");
    expect(addDays("2026-01-30", 5)).toBe("2026-02-04");
    expect(dueDateOf("2026-11", 7)).toBe("2026-11-07");
    expect(dueDateOf("2026-11", 31)).toBe("2026-11-28");
    expect(dueDateOf("2026-11", 0)).toBe("2026-11-01");
  });
  it("knows whether a lease runs in a month", () => {
    const l = { startOn: d("2026-03-15"), endOn: d("2026-09-14") };
    expect(leaseCovers(l, "2026-03")).toBe(true);
    expect(leaseCovers(l, "2026-09")).toBe(true);
    expect(leaseCovers(l, "2026-02")).toBe(false);
    expect(leaseCovers(l, "2026-10")).toBe(false);
  });
});

describe("balance, status, late fee and management fee", () => {
  const bill = { amount: 20_000, lateFee: 0, paid: 0, dueOn: d("2026-11-07") };
  it("owes amount + late fee - paid, never below zero", () => {
    expect(balanceOf(bill)).toBe(20_000);
    expect(balanceOf({ ...bill, lateFee: 400, paid: 10_000 })).toBe(10_400);
    expect(balanceOf({ ...bill, paid: 25_000 })).toBe(0);
  });
  it("is due, partial, overdue or paid", () => {
    expect(billStatus(bill, "2026-11-07")).toBe("due");
    expect(billStatus({ ...bill, paid: 5_000 }, "2026-11-07")).toBe("partial");
    expect(billStatus(bill, "2026-11-08")).toBe("overdue");
    expect(billStatus({ ...bill, paid: 5_000 }, "2026-11-08")).toBe("overdue");
    expect(billStatus({ ...bill, paid: 20_000 }, "2026-12-30")).toBe("paid");
    expect(billStatus({ ...bill, lateFee: 400, paid: 20_000 }, "2026-12-30")).toBe("overdue");   // the late fee is owed too
  });
  it("takes a share of the unpaid rent as the late fee and of the rent collected as the fee, in hundredths of a percent", () => {
    expect(lateFeeOf(20_000, 200)).toBe(400);
    expect(lateFeeOf(-5, 200)).toBe(0);
    expect(feeOf(20_400, 800)).toBe(1_632);
    expect(feeOf(0, 800)).toBe(0);
  });
});

describe("what the screens send", () => {
  it("turns a fee in percent into hundredths of a percent", () => {
    expect(bp(8)).toBe(800);
    expect(bp(7.5)).toBe(750);
    expect(CreateOwnerSchema.parse({ name: " Ram ", feePct: 7.5 })).toMatchObject({ name: "Ram", feeBp: 750, phone: null, bank: null });
    expect(OwnerBody.parse({ name: "Ram" }).feePct).toBe(8);
  });
  it("refuses bad input with the old messages", () => {
    const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;
    expect(msg(OwnerBody.safeParse({ name: "" }))).toBe("Write the owner's name.");
    expect(msg(LeaseBody.safeParse({ unitId: "u", start: "soon", end: "2026-12-31", renter: "A", rent: 1 }))).toBe("Use a date like 2026-11-04.");
    expect(msg(LeaseBody.safeParse({ unitId: "u", start: "2026-02-30", end: "2026-12-31", renter: "A", rent: 1 }))).toBe("That date doesn't exist.");
    expect(msg(LeaseBody.safeParse({ unitId: "u", start: "2026-01-01", end: "2026-12-31", renter: "A", rent: 1, dueDay: 31 }))).toBe("Choose a day from 1 to 28.");
    expect(msg(LeaseBody.safeParse({ unitId: "u", start: "2026-01-01", end: "2026-12-31", renter: "A", rent: 0 }))).toBe("Write the monthly rent.");
    expect(msg(PaymentBody.safeParse({ amount: 0, paidOn: "2026-01-01" }))).toBe("The amount must be more than zero.");
    expect(msg(PaymentBody.safeParse({ amount: 10.5, paidOn: "2026-01-01" }))).toBe("Use whole rupees.");
    expect(msg(BillAmountBody.safeParse({ amount: -1 }))).toBeTruthy();
    expect(msg(RejectBody.safeParse({ note: "no" }))).toBe("Say why, so the tenant knows.");
    expect(PaymentBody.parse({ amount: 5, paidOn: "2026-01-01" }).method).toBe("cash");
  });
  it("reads an optional version: a whole number from 1, otherwise refused", () => {
    expect(versionIn({})).toBeUndefined();
    expect(versionIn(undefined)).toBeUndefined();
    expect(versionIn({ version: 3 })).toBe(3);
    expect(versionIn({ version: "4" })).toBe(4);
    expect(() => versionIn({ version: 0 })).toThrow();
    expect(() => versionIn({ version: 1.5 })).toThrow();
    expect(() => versionIn({ version: "x" })).toThrow();
  });
});

describe("the Phase 1 scope cap", () => {
  const perms = makeTestPermissions({ "rentals.rental.read": "all", "rentals.rental.update": "branch" });
  const capped = cappedPermissions(perms);
  it("never gives a wider scope than branch", () => {
    expect(capped.require("rentals.rental.read")).toBe("branch");
    expect(capped.scopeOf("rentals.rental.read")).toBe("branch");
    expect(capped.scopeOf("rentals.rental.delete")).toBeNull();
    expect(cappedPermissions(makeTestPermissions("*")).require("rentals.rental.create")).toBe("branch");
  });
  it("refuses with the old words", () => {
    expect(() => capped.require("rentals.rental.delete")).toThrow("Your role can't change rentals.");
    expect(() => cappedPermissions(makeTestPermissions({})).require("rentals.rental.read")).toThrow("Your role can't see rentals.");
    expect(capped.can("rentals.rental.update")).toBe(true);
    expect(capped.can("rentals.rental.delete")).toBe(false);
  });
});

describe("events", () => {
  it("send paisa, never rupees", () => {
    expect(paisa(20_000)).toBe(2_000_000);
    expect(billCreatedPayload({ id: "b1", leaseId: "l1", month: "2026-11", amount: 20_000, branchId: "br" })).toEqual({ billId: "b1", leaseId: "l1", month: "2026-11", amountPaisa: 2_000_000, branchId: "br" });
    expect(paymentPayload({ id: "p1", billId: "b1", branchId: "br", amount: 150, method: "cash" } as PaymentRow)).toEqual({ paymentId: "p1", billId: "b1", branchId: "br", amountPaisa: 15_000, method: "cash" });
  });
  it("are named rentals.<resource>.<verb>", () => {
    for (const name of Object.values(RENT_EVENTS)) expect(name).toMatch(/^rentals\.[a-z]+\.[a-z_]+$/);
    expect(new Set(Object.values(RENT_EVENTS)).size).toBe(Object.values(RENT_EVENTS).length);
  });
});

// ───── A tiny stand-in for the database: only the calls the generator and the statement maths make ─────

interface FakeLease { id: string; tenantId: string; branchId: string; rent: number; dueDay: number; lateFeeBp: number; lateAfterDays: number }
interface FakeBill { id: string; tenantId: string; branchId: string; leaseId: string; month: string; dueOn: Date; amount: number; lateFee: number; lateWaived: boolean; paid: number }

function fakeDb(leases: FakeLease[], bills: FakeBill[] = []) {
  let n = 0;
  const db = {
    rentLease: { findMany: async () => leases.map(({ id, tenantId, branchId, rent, dueDay }) => ({ id, tenantId, branchId, rent, dueDay })) },
    rentBill: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        let count = 0;
        for (const r of data) {
          if (bills.some((b) => b.leaseId === r.leaseId && b.month === r.month)) continue;
          bills.push({ id: `bill${++n}`, lateFee: 0, lateWaived: false, paid: 0, ...r } as FakeBill);
          count++;
        }
        return { count };
      },
      findFirst: async ({ where }: { where: { leaseId: string; month: string } }) => bills.find((b) => b.leaseId === where.leaseId && b.month === where.month) ?? null,
      findMany: async ({ where }: { where: { dueOn: { lt: Date } } }) =>
        bills.filter((b) => b.lateFee === 0 && !b.lateWaived && b.dueOn < where.dueOn.lt).map((b) => ({ ...b, lease: leases.find((l) => l.id === b.leaseId)! })),
      updateMany: async ({ where, data }: { where: { id: string; paid: number }; data: { lateFee: number } }) => {
        const b = bills.find((x) => x.id === where.id && x.lateFee === 0 && !x.lateWaived && x.paid === where.paid);
        if (!b) return { count: 0 };
        b.lateFee = data.lateFee;
        return { count: 1 };
      },
    },
  };
  return { db: db as unknown as Db, bills };
}
const LEASE: FakeLease = { id: "l1", tenantId: "t1", branchId: "br", rent: 20_000, dueDay: 7, lateFeeBp: 200, lateAfterDays: 5 };

describe("runRentBills", () => {
  it("makes one bill per running lease and month, due on the lease's day, and none twice", async () => {
    const { db, bills } = fakeDb([LEASE, { ...LEASE, id: "l2", dueDay: 15, rent: 9_000 }]);
    expect(await runRentBills(db, { today: "2026-11-03" })).toEqual({ bills: 2, lateFees: 0 });
    expect(bills.map((b) => [b.leaseId, b.month, b.dueOn.toISOString().slice(0, 10), b.amount])).toEqual([["l1", "2026-11", "2026-11-07", 20_000], ["l2", "2026-11", "2026-11-15", 9_000]]);
    expect(await runRentBills(db, { today: "2026-11-04" })).toEqual({ bills: 0, lateFees: 0 });
    expect(bills).toHaveLength(2);
  });
  it("adds a late fee once, only after the grace days, only on what is unpaid", async () => {
    const { db, bills } = fakeDb([LEASE]);
    expect(await runRentBills(db, { today: "2025-03-10" })).toEqual({ bills: 1, lateFees: 0 });   // 3 days after the due day: still within the 5 grace days
    expect(await runRentBills(db, { today: "2025-03-20" })).toEqual({ bills: 0, lateFees: 1 });
    expect(bills[0]!.lateFee).toBe(400);
    expect(await runRentBills(db, { today: "2025-03-25" })).toEqual({ bills: 0, lateFees: 0 });   // not added again
    bills[0]!.paid = 20_400;
  });
  it("adds no late fee to a paid bill, a waived one, or a lease without a late-fee rate", async () => {
    const { db, bills } = fakeDb([LEASE, { ...LEASE, id: "l2", lateFeeBp: 0 }]);
    await runRentBills(db, { today: "2025-03-10" });
    bills.find((b) => b.leaseId === "l1")!.paid = 20_000;
    expect(await runRentBills(db, { today: "2025-03-30" })).toEqual({ bills: 0, lateFees: 0 });
    const { db: db2, bills: bills2 } = fakeDb([LEASE]);
    await runRentBills(db2, { today: "2025-03-10" });
    bills2[0]!.lateWaived = true;
    expect(await runRentBills(db2, { today: "2025-03-30" })).toEqual({ bills: 0, lateFees: 0 });
  });
  it("takes the late fee on the unpaid part of a part-paid bill", async () => {
    const { db, bills } = fakeDb([LEASE]);
    await runRentBills(db, { today: "2025-03-10" });
    bills[0]!.paid = 10_000;
    await runRentBills(db, { today: "2025-03-20" });
    expect(bills[0]!.lateFee).toBe(200);   // 2% of the 10,000 still unpaid
  });
});

describe("statementsFor", () => {
  const owner = { id: "o1", feeBp: 800 };
  const stub = (payments: number[], repairs: number[]) => ({
    rentPayment: { findMany: async () => payments.map((amount) => ({ amount, bill: { lease: { unit: { ownerId: "o1" } } } })) },
    rentRepair: { findMany: async () => repairs.map((cost) => ({ cost, unit: { ownerId: "o1" } })) },
  }) as unknown as Db;
  it("is rent collected - management fee - repairs, and the fee is 8% of what was collected", async () => {
    const m = await statementsFor(stub([10_000, 10_400], [3_000]), { tenantId: "t1", month: "2025-03", owners: [owner] });
    expect(m.get("o1")).toEqual({ ownerId: "o1", collected: 20_400, fee: 1_632, repairs: 3_000, payable: 15_768 });
  });
  it("gives an owner with nothing a row of zeros", async () => {
    expect((await statementsFor(stub([], []), { tenantId: "t1", month: "2025-03", owners: [owner] })).get("o1")).toEqual({ ownerId: "o1", collected: 0, fee: 0, repairs: 0, payable: 0 });
  });
});
