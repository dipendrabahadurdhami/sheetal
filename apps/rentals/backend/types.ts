// The table rows of Rentals as the repositories hand them out, and the shapes they are saved in.
// Where it fits: the type parameters of the repositories and services; the fields are the Prisma columns (backend-core/prisma/schema.prisma, models RentOwner,
// RentUnit, RentLease, RentBill, RentPayment, RentRepair and OwnerStatement), including the kernel columns the Lead adds in P2-W1-S1 (version, updatedBy, deletedAt, deletedBy).
// How it works: every row extends BranchEntity (id, version, createdBy/updatedBy, deletedAt/deletedBy, tenantId, branchId). Money is whole rupees (Int) because these
// tables have no paisa columns yet; events carry paisa (events.ts converts).
// Rules: types only; no code. NewRow / Change are "the row without what the repository owns", for create and update.

import type { BranchEntity } from "@sheetal/platform/core/repository";

export interface OwnerRow extends BranchEntity { name: string; phone: string | null; email: string | null; feeBp: number; bank: string | null; note: string | null }
export interface UnitRow extends BranchEntity { ownerId: string; property: string; name: string; kind: string; rent: number; status: string; listingId: number | null }
export interface LeaseRow extends BranchEntity {
  seq: number; unitId: string; renter: string; phone: string | null; email: string | null; startOn: Date; endOn: Date; rent: number; deposit: number; dueDay: number;
  lateFeeBp: number; lateAfterDays: number; status: string; endedOn: Date | null; depositStatus: string; depositReturned: number | null; depositNote: string | null; userId: string | null;
}
export interface BillRow extends BranchEntity { seq: number; leaseId: string; month: string; dueOn: Date; amount: number; lateFee: number; lateWaived: boolean; paid: number }
export interface PaymentRow extends BranchEntity {
  billId: string; amount: number; method: string; paidOn: Date; ref: string | null; note: string | null; status: string; source: string; collectedBy: string;
  proofFile: string | null; userId: string | null; reviewedBy: string | null; reviewedAt: Date | null; reviewNote: string | null;
}
export interface RepairRow extends BranchEntity { seq: number; unitId: string; title: string; priority: string; vendor: string | null; cost: number; status: string; doneOn: Date | null }
export interface StatementRow extends BranchEntity { ownerId: string; month: string; collected: number; fee: number; repairs: number; payable: number }

type Owned = "id" | "seq" | "version" | "createdAt" | "updatedAt" | "createdBy" | "updatedBy" | "deletedAt" | "deletedBy" | "tenantId" | "branchId";
/** A new row: every column the caller gives, without what the repository owns. `Opt` names the columns the table fills in by default. */
export type NewRow<R, Opt extends keyof R = never> = Omit<R, Owned | Opt> & Partial<Pick<R, Opt>> & { branchId?: string | null };
/** A change: any of those columns. */
export type Change<R> = Partial<Omit<R, Owned>>;
