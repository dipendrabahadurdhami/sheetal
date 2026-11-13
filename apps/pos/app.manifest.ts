// Point of sale: front desk, restaurant and bar billing, discounts, voids and shifts.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): the server code (point of sale and stock) is in backend/ (P2-W4; it also adds a POS bill's line to a guest's room bill, see backend/repositories.ts).
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
  // Phase 3 (P3-BE-1): first values only. The live values (prices, limits, trial) are the platform.catalog setting, edited in Admin -> Pricing;
  // prices are in platform/src/billing/catalog.seed.ts, not here.
  trialDays: 14,
  limits: [
    { key: "outlets", label: { en: "Outlets" }, unit: "count" },
    { key: "bills_per_month", label: { en: "Bills a month" }, unit: "per_month" },
  ],
  editions: [
    { id: "free", name: { en: "Free" }, free: true, limits: { outlets: 1, bills_per_month: 100 }, features: [], price: null },
    { id: "full", name: { en: "Full" }, free: false, limits: { outlets: 3, bills_per_month: null }, features: ["pos.stock"], price: null },
  ],
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
  events: {
    publishes: [
      { name: "pos.menu.added", v: 1, label: "Menu items were added", payload: { count: "number" } },
      { name: "pos.menu.updated", v: 1, label: "A menu item was changed", payload: { id: "id" } },
      { name: "pos.shift.opened", v: 1, label: "A till was opened", payload: { id: "id", float: "number" } },
      { name: "pos.shift.closed", v: 1, label: "A till was closed and the cash counted", payload: { id: "id", expected: "number", counted: "number", diff: "number" } },
      { name: "pos.bill.paid", v: 1, label: "A bill was paid or put on a room", payload: { id: "id", code: "string", total: "number", method: "string" } },
      { name: "pos.bill.voided", v: 1, label: "A bill was voided", payload: { id: "id", code: "string", total: "number" } },
      { name: "pos.stock.added", v: 1, label: "A stock item was added", payload: { id: "id", qty: "number" } },
      { name: "pos.stock.updated", v: 1, label: "A stock item was changed, archived or restored", payload: { id: "id", active: "boolean" } },
      { name: "pos.stock.moved", v: 1, label: "Stock came in, went out, was wasted or counted", payload: { itemId: "id", kind: "string", qty: "number", after: "number" } },
      { name: "pos.stock.imported", v: 1, label: "Stock items were imported", payload: { added: "number", updated: "number" } },
      { name: "pos.recipe.saved", v: 1, label: "A menu item recipe was saved", payload: { menuItemId: "id", lines: "number" } },
    ],
    consumes: [],
  },
  ai: [],
  dependencies: { requires: [], optional: ["hotel"], reads: ["Booking", "Room", "FolioLine"] },
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
