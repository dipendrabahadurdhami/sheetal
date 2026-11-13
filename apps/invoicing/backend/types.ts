// The Invoicing rows: a customer invoice or credit note (BizInvoice) with its receipts (BizReceipt), with the kernel columns.
// Where it fits: the type parameters of the repository and the service. Amounts are whole rupees (Int), as before; a credit note is stored positive.
// Rules: types only (the Prisma types, so the money helpers of backend-core accept them unchanged).

import type { BizInvoice, BizReceipt } from "@prisma/client";
import type { BranchEntity } from "@sheetal/platform/core/repository";

export type InvoiceRow = BizInvoice & BranchEntity;
export type ReceiptRow = BizReceipt;
export type Full = InvoiceRow & { receipts: ReceiptRow[] };
