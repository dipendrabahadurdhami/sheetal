// Investments: investment opportunities, investors and updates.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): the server code is in backend/ (P2-W3).
// Rules: no functions or logic, only "import type" lines; every permission starts with "investments."; models match the "/// @app investments" tags in schema.prisma.

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "investments",
  kind: "app",
  name: { en: "Investments", ne: "लगानी" },
  tagline: { en: "Investment opportunities, investors and their updates." },
  icon: "trending-up",
  category: "money",
  businessTypes: ["sponsor"],
  trialDays: null,
  limits: [],
  editions: [{ id: "free", name: { en: "Free" }, free: true, limits: {}, features: [], price: null }],
  permissions: [
    { id: "investments.offering.read", label: { en: "See investment opportunities" }, scopes: ["branch", "all"], default: "branch", group: "Opportunities" },
    { id: "investments.offering.create", label: { en: "Add investment opportunities" }, scopes: ["branch", "all"], default: "branch", group: "Opportunities" },
    { id: "investments.offering.update", label: { en: "Change investment opportunities" }, scopes: ["branch", "all"], default: "branch", group: "Opportunities" },
    { id: "investments.offering.delete", label: { en: "Delete investment opportunities" }, scopes: ["branch", "all"], default: "branch", group: "Opportunities" },
    { id: "investments.investor.read", label: { en: "See investors" }, scopes: ["branch", "all"], default: "branch", group: "Investors" },
    { id: "investments.update.create", label: { en: "Post investor updates" }, scopes: ["branch", "all"], default: "branch", group: "Investors" },
  ],
  roles: [{ key: "investor_relations", types: ["sponsor"], add: ["investments.investor.read:branch", "investments.update.create:branch"] }],
  approvals: [],
  menu: [],
  events: {
    publishes: [
      { name: "investments.commitment.pledged", v: 1, label: "An investor pledged", payload: { id: "id", listingId: "id", amount: "number" } },
      { name: "investments.commitment.paid", v: 1, label: "A pledge was marked paid", payload: { id: "id", listingId: "id", amount: "number" } },
      { name: "investments.commitment.refunded", v: 1, label: "A pledge was marked refunded", payload: { id: "id", listingId: "id", amount: "number" } },
      { name: "investments.update.posted", v: 1, label: "An update was posted to investors", payload: { id: "id", listingId: "id" } },
    ],
    consumes: [],
  },
  ai: [],
  dependencies: { requires: [], optional: ["listings"], reads: ["Listing"] },
  models: ["Commitment", "InvestmentUpdate"],
  branchOwned: [],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
