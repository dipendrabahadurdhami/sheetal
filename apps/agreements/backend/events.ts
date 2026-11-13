// The events Agreements publishes, as listed in app.manifest.ts (events.publishes).
// Where it fits: AgreementService publishes them inside the transaction of the change (the event outbox).
// How it works: payloads carry ids and the status only; names, emails and texts stay out (the audit log has the reference and title).
// Rules: change a payload only by adding a version in the manifest first.

export const AGREEMENT_EVENTS = {
  created: "agreements.agreement.created",
  updated: "agreements.agreement.updated",
  sent: "agreements.agreement.sent",
  reminded: "agreements.agreement.reminded",
  cancelled: "agreements.agreement.cancelled",
  removed: "agreements.agreement.removed",
} as const;
