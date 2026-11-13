// The events People publishes: names and payloads, as listed in app.manifest.ts (events.publishes).
// Where it fits: PeopleService publishes them inside the transaction of the change (the event outbox), so a rolled-back change has no event.
// How it works: small payloads with ids and the facts a listener needs; no names, no reasons, no places (those stay in the audit log).
// Rules: change a payload only by adding a version in the manifest first.

export const PEOPLE_EVENTS = {
  checkedIn: "people.attendance.checked_in",
  checkedOut: "people.attendance.checked_out",
  corrected: "people.attendance.corrected",
  leaveRequested: "people.leave.requested",
  leaveDecided: "people.leave.decided",
  leaveCancelled: "people.leave.cancelled",
} as const;

/** The approvable action (manifest approvals[]): approving leave. An approval action is named by its permission (check-manifests rule 2), and approving
 *  leave is the only People action that names it. Its rule is OFF by default, so leave is decided at once as before. */
export const LEAVE_APPROVE = "people.person.update";
