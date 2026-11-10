// Collections: collecting payments from buyers and tenants, and refunds.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): the routes stay in their old modules until the app moves onto the kernel.
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
  trialDays: null,
  limits: [],
  editions: [{ id: "free", name: { en: "Free" }, free: true, limits: {}, features: [], price: null }],
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
