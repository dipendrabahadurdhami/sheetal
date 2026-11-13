// Projects and units: developer projects and units, progress updates, site visits and reservations.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): the server code is in backend/ (P2-W3; it also writes the payments on a reservation, see backend/repositories.ts).
// Rules: no functions or logic, only "import type" lines; every permission starts with "projects."; models match the "/// @app projects" tags in schema.prisma.

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "projects",
  kind: "app",
  name: { en: "Projects and units", ne: "परियोजना र युनिट" },
  tagline: { en: "Developer projects, units, site visits and reservations." },
  icon: "building-2",
  category: "property",
  businessTypes: ["developer"],
  // Phase 3 (P3-BE-1): first values only. The live values (prices, limits, trial) are the platform.catalog setting, edited in Admin -> Pricing;
  // prices are in platform/src/billing/catalog.seed.ts, not here.
  trialDays: 14,
  limits: [
    { key: "projects", label: { en: "Projects" }, unit: "count" },
    { key: "units", label: { en: "Units" }, unit: "count" },
  ],
  editions: [
    { id: "free", name: { en: "Free" }, free: true, limits: { projects: 1, units: 50 }, features: [], price: null },
    { id: "full", name: { en: "Full" }, free: false, limits: { projects: 10, units: 1000 }, features: [], price: null },
  ],
  permissions: [
    { id: "projects.project.read", label: { en: "See projects and units" }, scopes: ["branch", "all"], default: "branch", group: "Projects and units" },
    { id: "projects.project.create", label: { en: "Add projects and units" }, scopes: ["branch", "all"], default: "branch", group: "Projects and units" },
    { id: "projects.project.update", label: { en: "Change projects and units" }, scopes: ["branch", "all"], default: "branch", group: "Projects and units" },
    { id: "projects.project.delete", label: { en: "Delete projects and units" }, scopes: ["branch", "all"], default: "branch", group: "Projects and units" },
    { id: "projects.progress.create", label: { en: "Post construction updates" }, scopes: ["branch", "all"], default: "branch", group: "Progress" },
    { id: "projects.visit.read", label: { en: "See site visits" }, scopes: ["branch", "all"], default: "branch", group: "Site visits" },
    { id: "projects.visit.create", label: { en: "Add site visits" }, scopes: ["branch", "all"], default: "branch", group: "Site visits" },
    { id: "projects.visit.update", label: { en: "Change site visits" }, scopes: ["branch", "all"], default: "branch", group: "Site visits" },
    { id: "projects.visit.delete", label: { en: "Delete site visits" }, scopes: ["branch", "all"], default: "branch", group: "Site visits" },
    { id: "projects.reservation.read", label: { en: "See reservations" }, scopes: ["branch", "all"], default: "branch", group: "Reservations" },
    { id: "projects.reservation.create", label: { en: "Add reservations" }, scopes: ["branch", "all"], default: "branch", group: "Reservations" },
    { id: "projects.reservation.update", label: { en: "Change reservations" }, scopes: ["branch", "all"], default: "branch", group: "Reservations" },
    { id: "projects.reservation.delete", label: { en: "Delete reservations" }, scopes: ["branch", "all"], default: "branch", group: "Reservations" },
  ],
  roles: [
    {
      key: "sales_manager",
      types: ["developer"],
      add: [
        "projects.project.read:branch",
        "projects.project.create:branch",
        "projects.project.update:branch",
        "projects.project.delete:branch",
        "projects.visit.read:branch",
        "projects.visit.create:branch",
        "projects.visit.update:branch",
        "projects.visit.delete:branch",
        "projects.reservation.read:branch",
        "projects.reservation.create:branch",
        "projects.reservation.update:branch",
        "projects.reservation.delete:branch",
      ],
    },
    {
      key: "sales_exec",
      types: ["developer"],
      add: [
        "projects.visit.read:branch",
        "projects.visit.create:branch",
        "projects.visit.update:branch",
        "projects.visit.delete:branch",
        "projects.reservation.read:branch",
        "projects.reservation.create:branch",
        "projects.reservation.update:branch",
        "projects.reservation.delete:branch",
      ],
    },
    { key: "site_engineer", types: ["developer"], add: ["projects.progress.create:branch"] },
  ],
  approvals: [],
  menu: [],
  events: {
    publishes: [
      { name: "projects.unit.added", v: 1, label: "Units were added to a project", payload: { listingId: "id", count: "number" } },
      { name: "projects.unit.updated", v: 1, label: "A unit was changed", payload: { id: "id", status: "string" } },
      { name: "projects.unit.held", v: 1, label: "A unit was held", payload: { id: "id", days: "number" } },
      { name: "projects.reservation.created", v: 1, label: "A unit was reserved", payload: { id: "id", unitId: "id", price: "number" } },
      { name: "projects.reservation.paid", v: 1, label: "A payment or refund was recorded on a reservation", payload: { id: "id", amount: "number", paid: "number" } },
      { name: "projects.reservation.sold", v: 1, label: "A reservation was fully paid: the unit is sold", payload: { id: "id", amount: "number", paid: "number" } },
      { name: "projects.reservation.cancelled", v: 1, label: "A reservation was cancelled", payload: { id: "id", unitId: "id" } },
    ],
    consumes: [],
  },
  ai: [],
  dependencies: { requires: [], optional: ["collections", "listings"], reads: ["Listing", "Collection"] },
  models: ["Unit", "Reservation"],
  branchOwned: [],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
