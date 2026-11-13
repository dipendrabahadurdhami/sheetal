// The events Invoicing publishes, as listed in app.manifest.ts (events.publishes). Published inside the transaction of the change.
// Rules: ids, numbers and amounts only (whole rupees); no customer names or PAN. Change a payload only by adding a version in the manifest first.

export const INVOICE_EVENTS = {
  drafted: "invoicing.invoice.drafted",
  sent: "invoicing.invoice.sent",
  paid: "invoicing.invoice.paid",
  cancelled: "invoicing.invoice.cancelled",
  credited: "invoicing.invoice.credited",
  deleted: "invoicing.invoice.deleted",
  imported: "invoicing.invoice.imported",
} as const;
