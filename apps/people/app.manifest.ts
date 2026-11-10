// People: people, attendance and leave.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): the routes stay in their old modules until the app moves onto the kernel.
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
  trialDays: null,
  limits: [],
  editions: [{ id: "free", name: { en: "Free" }, free: true, limits: {}, features: [], price: null }],
  permissions: [
    { id: "people.person.read", label: { en: "See people, attendance and leave" }, scopes: ["branch", "all"], default: "branch", group: "People" },
    { id: "people.person.create", label: { en: "Add people, attendance and leave" }, scopes: ["branch", "all"], default: "branch", group: "People" },
    { id: "people.person.update", label: { en: "Change people, attendance and leave" }, scopes: ["branch", "all"], default: "branch", group: "People" },
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
  approvals: [],
  menu: [],
  events: { publishes: [], consumes: [] },
  ai: [],
  dependencies: { requires: [], optional: [], reads: [] },
  models: ["Attendance", "LeaveType", "LeaveRequest"],
  branchOwned: [{ model: "Attendance", label: { en: "attendance record" } }, { model: "LeaveRequest", label: { en: "leave request" } }],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
