// Agreements: making, sending and cancelling agreements.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models, events). The server code is in backend/ (P2-W1 stage 3).
// Rules: no functions or logic, only "import type" lines; every permission starts with "agreements."; models match the "/// @app agreements" tags in schema.prisma.

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "agreements",
  kind: "app",
  name: { en: "Agreements", ne: "सम्झौता" },
  tagline: { en: "Make, send and sign agreements." },
  icon: "file-signature",
  category: "property",
  businessTypes: "all",
  // Phase 3 (P3-BE-1): first values only. The live values (prices, limits, trial) are the platform.catalog setting, edited in Admin -> Pricing;
  // prices are in platform/src/billing/catalog.seed.ts, not here.
  trialDays: 14,
  limits: [
    { key: "agreements_per_month", label: { en: "Agreements a month" }, unit: "per_month" },
  ],
  editions: [
    { id: "free", name: { en: "Free" }, free: true, limits: { agreements_per_month: 2 }, features: [], price: null },
    { id: "full", name: { en: "Full" }, free: false, limits: { agreements_per_month: null }, features: ["agreements.esign"], price: null },
  ],
  permissions: [
    { id: "agreements.agreement.read", label: { en: "See agreements" }, scopes: ["branch", "all"], default: "branch", group: "Agreements" },
    { id: "agreements.agreement.create", label: { en: "Add agreements" }, scopes: ["branch", "all"], default: "branch", group: "Agreements" },
    { id: "agreements.agreement.update", label: { en: "Change agreements" }, scopes: ["branch", "all"], default: "branch", group: "Agreements" },
    { id: "agreements.agreement.delete", label: { en: "Delete agreements" }, scopes: ["branch", "all"], default: "branch", group: "Agreements" },
  ],
  roles: [
    {
      key: "sales_manager",
      types: ["developer"],
      add: ["agreements.agreement.read:branch", "agreements.agreement.create:branch", "agreements.agreement.update:branch", "agreements.agreement.delete:branch"],
    },
    {
      key: "branch_manager",
      types: ["agency"],
      add: ["agreements.agreement.read:branch", "agreements.agreement.create:branch", "agreements.agreement.update:branch", "agreements.agreement.delete:branch"],
    },
  ],
  approvals: [],
  menu: [],
  events: {
    publishes: [
      { name: "agreements.agreement.created", v: 1, label: "An agreement draft was made", payload: { id: "id", ref: "string" } },
      { name: "agreements.agreement.updated", v: 1, label: "A draft was changed", payload: { id: "id", ref: "string" } },
      { name: "agreements.agreement.sent", v: 1, label: "An agreement was sent for signing", payload: { id: "id", ref: "string" } },
      { name: "agreements.agreement.reminded", v: 1, label: "A signing link was sent again", payload: { id: "id", ref: "string" } },
      { name: "agreements.agreement.cancelled", v: 1, label: "An agreement was cancelled", payload: { id: "id", ref: "string" } },
      { name: "agreements.agreement.removed", v: 1, label: "A draft was removed", payload: { id: "id", ref: "string" } },
      { name: "agreements.agreement.signed", v: 1, label: "Someone signed an agreement on the website", payload: { id: "id", ref: "string" } },
      { name: "agreements.agreement.completed", v: 1, label: "Everyone has signed an agreement", payload: { id: "id", ref: "string" } },
    ],
    consumes: [],
  },
  ai: [],
  dependencies: { requires: [], optional: ["rentals", "crm", "listings"], reads: ["RentLease", "Lead", "Listing"] },
  models: ["Agreement", "AgreementSigner"],
  branchOwned: [{ model: "Agreement", label: { en: "agreement" } }],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
