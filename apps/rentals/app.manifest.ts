// Rentals: leases, rent payments, repairs and owner statements.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, events, models). The code lives in apps/rentals/backend (moved in by P2-W1-S1).
// Rules: no functions or logic, only "import type" lines; every permission and event starts with "rentals."; models match the "/// @app rentals" tags in schema.prisma.

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "rentals",
  kind: "app",
  name: { en: "Rentals", ne: "भाडा व्यवस्थापन" },
  tagline: { en: "Leases, rent, repairs and owner statements." },
  icon: "key-round",
  category: "property",
  businessTypes: ["agency"],
  trialDays: null,
  limits: [],
  editions: [{ id: "free", name: { en: "Free" }, free: true, limits: {}, features: [], price: null }],
  permissions: [
    {
      id: "rentals.rental.read",
      label: { en: "See rentals, rent and owner statements", ne: "भाडा, भाडावाल र घरधनी विवरण हेर्ने" },
      scopes: ["branch", "all"],
      default: "branch",
      group: "Rentals",
    },
    { id: "rentals.rental.create", label: { en: "Add leases and record rent payments" }, scopes: ["branch", "all"], default: "branch", group: "Rentals" },
    { id: "rentals.rental.update", label: { en: "Change leases, repairs and statements" }, scopes: ["branch", "all"], default: "branch", group: "Rentals" },
    { id: "rentals.rental.delete", label: { en: "Delete rental records" }, scopes: ["branch", "all"], default: "branch", group: "Rentals" },
  ],
  roles: [
    {
      key: "branch_manager",
      types: ["agency"],
      add: ["rentals.rental.read:branch", "rentals.rental.create:branch", "rentals.rental.update:branch", "rentals.rental.delete:branch"],
    },
    {
      key: "accountant",
      types: ["agency"],
      add: ["rentals.rental.read:branch", "rentals.rental.create:branch", "rentals.rental.update:branch", "rentals.rental.delete:branch"],
    },
  ],
  approvals: [],
  menu: [{ id: "rentals", label: { en: "Rentals", ne: "भाडा" }, icon: "key-round", path: "/business/rentals", group: "work", order: 50, permission: "rentals.rental.read" }],
  events: {
    publishes: [
      { name: "rentals.owner.created", v: 1, label: "A property owner was added", payload: { ownerId: "id", branchId: "id" } },
      { name: "rentals.owner.updated", v: 1, label: "A property owner was changed", payload: { ownerId: "id", branchId: "id" } },
      { name: "rentals.owner.deleted", v: 1, label: "A property owner was removed", payload: { ownerId: "id", branchId: "id" } },
      { name: "rentals.unit.created", v: 1, label: "A rental unit was added", payload: { unitId: "id", ownerId: "id", branchId: "id", rentPaisa: "paisa" } },
      { name: "rentals.unit.updated", v: 1, label: "A rental unit was changed", payload: { unitId: "id", ownerId: "id", branchId: "id", rentPaisa: "paisa" } },
      { name: "rentals.unit.deleted", v: 1, label: "A rental unit was removed", payload: { unitId: "id", ownerId: "id", branchId: "id", rentPaisa: "paisa" } },
      {
        name: "rentals.lease.created",
        v: 1,
        label: "A lease started",
        payload: { leaseId: "id", unitId: "id", branchId: "id", rentPaisa: "paisa", depositPaisa: "paisa", startOn: "date", endOn: "date" },
      },
      { name: "rentals.lease.updated", v: 1, label: "A running lease was changed", payload: { leaseId: "id", branchId: "id", rentPaisa: "paisa", previousRentPaisa: "paisa", endOn: "date" } },
      { name: "rentals.lease.ended", v: 1, label: "A lease ended", payload: { leaseId: "id", unitId: "id", branchId: "id", endedOn: "date", depositReturnedPaisa: "paisa" } },
      { name: "rentals.lease.deposit_returned", v: 1, label: "A deposit was returned", payload: { leaseId: "id", branchId: "id", depositReturnedPaisa: "paisa", depositPaisa: "paisa" } },
      { name: "rentals.bill.created", v: 1, label: "A rent bill was made", payload: { billId: "id", leaseId: "id", month: "string", amountPaisa: "paisa", branchId: "id" } },
      { name: "rentals.bill.updated", v: 1, label: "A rent bill's amount was changed", payload: { billId: "id", leaseId: "id", branchId: "id", amountPaisa: "paisa", previousAmountPaisa: "paisa" } },
      { name: "rentals.bill.late_fee_added", v: 1, label: "A late fee was added to a bill", payload: { billId: "id", leaseId: "id", branchId: "id", lateFeePaisa: "paisa" } },
      { name: "rentals.bill.late_fee_waived", v: 1, label: "A late fee was waived", payload: { billId: "id", leaseId: "id", branchId: "id", lateFeePaisa: "paisa" } },
      { name: "rentals.payment.recorded", v: 1, label: "A rent payment was recorded", payload: { paymentId: "id", billId: "id", branchId: "id", amountPaisa: "paisa", method: "string" } },
      { name: "rentals.payment.removed", v: 1, label: "A rent payment was removed", payload: { paymentId: "id", billId: "id", branchId: "id", amountPaisa: "paisa", method: "string" } },
      { name: "rentals.payment.confirmed", v: 1, label: "An online rent payment was confirmed", payload: { paymentId: "id", billId: "id", branchId: "id", amountPaisa: "paisa", method: "string" } },
      { name: "rentals.payment.rejected", v: 1, label: "An online rent payment was rejected", payload: { paymentId: "id", billId: "id", branchId: "id", amountPaisa: "paisa" } },
      { name: "rentals.repair.created", v: 1, label: "A repair was logged", payload: { repairId: "id", unitId: "id", branchId: "id", costPaisa: "paisa", status: "string" } },
      { name: "rentals.repair.updated", v: 1, label: "A repair was changed", payload: { repairId: "id", unitId: "id", branchId: "id", costPaisa: "paisa", status: "string" } },
      {
        name: "rentals.statement.saved",
        v: 1,
        label: "An owner statement was saved",
        payload: { statementId: "id", ownerId: "id", branchId: "id", month: "string", collectedPaisa: "paisa", feePaisa: "paisa", repairsPaisa: "paisa", payablePaisa: "paisa" },
      },
      {
        name: "rentals.statement.deleted",
        v: 1,
        label: "An owner statement was removed",
        payload: { statementId: "id", ownerId: "id", branchId: "id", month: "string", collectedPaisa: "paisa", feePaisa: "paisa", repairsPaisa: "paisa", payablePaisa: "paisa" },
      },
    ],
    consumes: [],
  },
  ai: [],
  dependencies: { requires: [], optional: [], reads: ["Listing"] },
  models: ["RentOwner", "RentUnit", "RentLease", "RentBill", "RentPayment", "RentRepair", "OwnerStatement"],
  branchOwned: [
    { model: "RentOwner", label: { en: "property owner" } },
    { model: "RentUnit", label: { en: "rental unit" } },
    { model: "RentLease", label: { en: "lease" } },
    { model: "RentBill", label: { en: "rent bill" } },
    { model: "RentPayment", label: { en: "rent payment" } },
    { model: "RentRepair", label: { en: "repair" } },
    { model: "OwnerStatement", label: { en: "owner statement" } },
  ],
  settings: [],
  jobs: [{ id: "rentals.bills", every: "6h", label: "Make this month's rent bills and add late fees" }],
} satisfies AppManifest;

export default manifest;
