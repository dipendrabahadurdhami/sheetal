// The Agreement rows as the repository hands them out: the Prisma columns of Agreement (with the kernel columns) and its signers.
// Where it fits: the type parameter of AgreementRepository and AgreementService.
// How it works: types only. An agreement may have no branch (branchId null): it is then outside every branch filter, as before.
// Rules: the kernel columns version, updatedBy, deletedAt, deletedBy were added by migration 20261113100000_agreements_kernel_columns.

import type { Agreement, AgreementSigner } from "@prisma/client";
import type { BusinessEntity } from "@sheetal/platform/core/repository";

export type AgreementRow = Agreement & BusinessEntity;
export type SignerRow = AgreementSigner;
export type Full = AgreementRow & { signers: SignerRow[] };
