// People: people, attendance and leave.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models, events, approvals). The server code is in backend/ (P2-W1 stage 2).
// Rules: no functions or logic, only "import type" lines; every permission starts with "people."; models match the "/// @app people" tags in schema.prisma.

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "people",
  kind: "app",
  name: { en: "People", ne: "जनशक्ति" },
  tagline: { en: "Your people, attendance and leave." },
  icon: "users-round",
  category: "people",
  businessTypes: "all",
  // Phase 3 (P3-BE-1): first values only. The live values (prices, limits, trial) are the platform.catalog setting, edited in Admin -> Pricing;
  // prices are in platform/src/billing/catalog.seed.ts, not here.
  trialDays: 14,
  limits: [
    { key: "staff_records", label: { en: "Staff records" }, unit: "count" },
  ],
  editions: [
    { id: "free", name: { en: "Free" }, free: true, limits: { staff_records: 5 }, features: [], price: null },
    { id: "full", name: { en: "Full" }, free: false, limits: { staff_records: 50 }, features: ["people.attendance", "people.leave"], price: null },
  ],
  permissions: [
    { id: "people.person.read", label: { en: "See people, attendance and leave" }, scopes: ["branch", "all"], default: "branch", group: "People" },
    { id: "people.person.create", label: { en: "Add people, attendance and leave" }, scopes: ["branch", "all"], default: "branch", group: "People" },
    { id: "people.person.update", label: { en: "Change people, attendance and leave" }, scopes: ["branch", "all"], default: "branch", group: "People", approvable: true },
    { id: "people.person.delete", label: { en: "Delete people, attendance and leave" }, scopes: ["branch", "all"], default: "branch", group: "People" },
  ],
  roles: [
    {
      key: "sales_manager",
      types: ["developer"],
      add: ["people.person.read:branch", "people.person.create:branch", "people.person.update:branch", "people.person.delete:branch"],
    },
    {
      key: "branch_manager",
      types: ["agency"],
      add: ["people.person.read:branch", "people.person.create:branch", "people.person.update:branch", "people.person.delete:branch"],
    },
  ],
  approvals: [
    {
      action: "people.person.update",
      label: { en: "Approve leave (a second manager checks)" },
      money: false,
      enabledByDefault: false,
      approverPermission: "people.person.update",
    },
  ],
  menu: [],
  events: {
    publishes: [
      { name: "people.attendance.checked_in", v: 1, label: "A person checked in", payload: { id: "id", userId: "id", day: "date", late: "boolean" } },
      { name: "people.attendance.checked_out", v: 1, label: "A person checked out", payload: { id: "id", userId: "id", day: "date" } },
      { name: "people.attendance.corrected", v: 1, label: "A manager added or fixed a record", payload: { id: "id", userId: "id", day: "date", added: "boolean" } },
      { name: "people.leave.requested", v: 1, label: "Leave was requested", payload: { id: "id", userId: "id", typeId: "id", from: "date", to: "date", days: "number" } },
      { name: "people.leave.decided", v: 1, label: "Leave was approved or rejected", payload: { id: "id", userId: "id", status: "string" } },
      { name: "people.leave.cancelled", v: 1, label: "Leave was cancelled", payload: { id: "id", userId: "id" } },
    ],
    consumes: [],
  },
  ai: [],
  dependencies: { requires: [], optional: [], reads: [] },
  models: ["Attendance", "LeaveType", "LeaveRequest"],
  branchOwned: [{ model: "Attendance", label: { en: "attendance record" } }, { model: "LeaveRequest", label: { en: "leave request" } }],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
