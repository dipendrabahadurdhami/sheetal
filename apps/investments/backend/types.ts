// The Investments rows: Commitment (an investor's pledge) and InvestmentUpdate, with the kernel columns. Money is whole rupees (BigInt), as before.
import type { BusinessEntity } from "@sheetal/platform/core/repository";

export interface CommitmentRow extends BusinessEntity {
  listingId: number; name: string; email: string | null; phone: string | null; amount: bigint; status: string; paidAt: Date | null; ref: string | null;
}
export interface UpdateRow extends BusinessEntity { listingId: number; title: string; body: string; byUserId: string | null }
