// Collections: collecting payments from buyers and tenants, and refunds.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models). Collections has no server code of its own: a
// payment on a reservation is written by the Projects app (apps/projects/backend) in the same transaction that marks a fully paid unit sold, and is shown on the
// Projects page; the permissions below decide who may collect and refund (P2-W3, docs/architecture/MODEL-OWNERS.md).
// Rules: no functions or logic, only "import type" lines; every permission starts with "collections."; models match the "/// @app collections" tags in schema.prisma.

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "collections",
  kind: "app",
  name: { en: "Collections", ne: "रकम संकलन" },
  tagline: { en: "Collect token money, instalments and fees from buyers and tenants." },
  icon: "wallet",
  category: "money",
  businessTypes: ["developer", "agency"],
  // Phase 3 (P3-BE-1): first values only. The live values (prices, limits, trial) are the platform.catalog setting, edited in Admin -> Pricing;
  // prices are in platform/src/billing/catalog.seed.ts, not here.
  trialDays: 14,
  limits: [
    { key: "bookings", label: { en: "Bookings" }, unit: "count" },
  ],
  editions: [
    { id: "free", name: { en: "Free" }, free: true, limits: { bookings: 10 }, features: [], price: null },
    { id: "full", name: { en: "Full" }, free: false, limits: { bookings: null }, features: ["collections.instalments"], price: null },
  ],
  permissions: [
    { id: "collections.payment.read", label: { en: "See collected payments" }, scopes: ["branch", "all"], default: "branch", group: "Collections" },
    { id: "collections.payment.create", label: { en: "Collect token, instalments and fees" }, scopes: ["branch", "all"], default: "branch", group: "Collections" },
    { id: "collections.payment.refund", label: { en: "Refund payments" }, scopes: ["branch", "all"], default: "branch", group: "Collections", approvable: true },
  ],
  roles: [
    { key: "sales_manager", types: ["developer"], add: ["collections.payment.read:branch", "collections.payment.create:branch"] },
    { key: "accountant", types: ["developer"], add: ["collections.payment.read:branch", "collections.payment.create:branch", "collections.payment.refund:branch"] },
    { key: "branch_manager", types: ["agency"], add: ["collections.payment.read:branch", "collections.payment.create:branch"] },
    { key: "accountant", types: ["agency"], add: ["collections.payment.read:branch", "collections.payment.create:branch"] },
  ],
  approvals: [
    {
      action: "collections.payment.refund",
      label: { en: "Refund a payment above a limit" },
      money: true,
      enabledByDefault: false,
      approverPermission: "collections.payment.refund",
    },
  ],
  menu: [],
  events: { publishes: [], consumes: [] },
  ai: [],
  dependencies: { requires: [], optional: [], reads: [] },
  models: ["Collection"],
  branchOwned: [],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
