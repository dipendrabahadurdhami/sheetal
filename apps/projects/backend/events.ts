// The events Projects publishes, as listed in app.manifest.ts (events.publishes). Published inside the transaction of the change.
// Rules: ids and amounts only (whole rupees as numbers). Change a payload only by adding a version in the manifest first.

export const PROJECT_EVENTS = {
  unitsAdded: "projects.unit.added",
  unitChanged: "projects.unit.updated",
  unitHeld: "projects.unit.held",
  reserved: "projects.reservation.created",
  paid: "projects.reservation.paid",
  sold: "projects.reservation.sold",
  cancelled: "projects.reservation.cancelled",
} as const;
