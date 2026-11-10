// Rentals: leases, rent payments, repairs and owner statements.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): the routes stay in their old modules until the app moves onto the kernel.
// Rules: no functions or logic, only "import type" lines; every permission starts with "rentals."; models match the "/// @app rentals" tags in schema.prisma.

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
  menu: [],
  events: { publishes: [], consumes: [] },
  ai: [],
  dependencies: { requires: [], optional: [], reads: [] },
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
  jobs: [],
} satisfies AppManifest;

export default manifest;
