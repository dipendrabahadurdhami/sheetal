// Agreements: making, sending and cancelling agreements.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): the routes stay in their old modules until the app moves onto the kernel.
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
  trialDays: null,
  limits: [],
  editions: [{ id: "free", name: { en: "Free" }, free: true, limits: {}, features: [], price: null }],
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
  events: { publishes: [], consumes: [] },
  ai: [],
  dependencies: { requires: [], optional: [], reads: [] },
  models: ["Agreement", "AgreementSigner"],
  branchOwned: [{ model: "Agreement", label: { en: "agreement" } }],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
