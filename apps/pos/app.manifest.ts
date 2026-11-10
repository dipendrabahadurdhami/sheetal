// Point of sale: front desk, restaurant and bar billing, discounts, voids and shifts.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): the routes stay in their old modules until the app moves onto the kernel.
// Rules: no functions or logic, only "import type" lines; every permission starts with "pos."; models match the "/// @app pos" tags in schema.prisma.

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "pos",
  kind: "app",
  name: { en: "Point of sale", ne: "बिक्री काउन्टर" },
  tagline: { en: "Front desk, restaurant and bar billing, extras and shifts." },
  icon: "shopping-cart",
  category: "hospitality",
  businessTypes: ["hotel", "host"],
  trialDays: null,
  limits: [],
  editions: [{ id: "free", name: { en: "Free" }, free: true, limits: {}, features: [], price: null }],
  permissions: [
    {
      id: "pos.frontdesk.use",
      label: { en: "Front desk: check-in, folio, collect", ne: "फ्रन्ट डेस्क: चेक-इन, बिल, असुली" },
      scopes: ["branch", "all"],
      default: "branch",
      group: "Point of sale",
    },
    {
      id: "pos.restaurant.use",
      label: { en: "Restaurant and bar orders", ne: "रेस्टुरेन्ट र बार अर्डर" },
      scopes: ["branch", "all"],
      default: "branch",
      group: "Point of sale",
    },
    { id: "pos.extra.create", label: { en: "Sell extras", ne: "अतिरिक्त सेवा बेच्ने" }, scopes: ["branch", "all"], default: "branch", group: "Point of sale" },
    { id: "pos.bill.discount", label: { en: "Give discounts", ne: "छुट दिने" }, scopes: ["branch", "all"], default: "branch", group: "Point of sale" },
    {
      id: "pos.bill.void",
      label: { en: "Void items and refund", ne: "सामान रद्द र फिर्ता" },
      scopes: ["branch", "all"],
      default: "branch",
      group: "Point of sale",
      approvable: true,
    },
    {
      id: "pos.shift.close",
      label: { en: "Open and close shifts", ne: "सिफ्ट खोल्ने र बन्द गर्ने" },
      scopes: ["branch", "all"],
      default: "branch",
      group: "Point of sale",
    },
  ],
  roles: [
    { key: "frontdesk", types: ["hotel"], add: ["pos.frontdesk.use:branch", "pos.extra.create:branch", "pos.shift.close:branch"] },
    { key: "cashier", types: ["hotel"], add: ["pos.restaurant.use:branch", "pos.extra.create:branch", "pos.shift.close:branch"] },
    { key: "cohost", types: ["host"], add: ["pos.extra.create:branch"] },
  ],
  approvals: [{ action: "pos.bill.void", label: { en: "Void a bill item above a limit" }, money: true, enabledByDefault: false, approverPermission: "pos.bill.void" }],
  menu: [],
  events: { publishes: [], consumes: [] },
  ai: [],
  dependencies: { requires: [], optional: [], reads: [] },
  models: ["MenuItem", "Shift", "PosBill", "StockItem", "StockMove", "StockRecipe"],
  branchOwned: [
    { model: "MenuItem", label: { en: "menu item" } },
    { model: "Shift", label: { en: "shift" } },
    { model: "PosBill", label: { en: "bill" } },
    { model: "StockItem", label: { en: "stock item" } },
    { model: "StockMove", label: { en: "stock movement" } },
  ],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
