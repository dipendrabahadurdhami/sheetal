// Invoicing: invoices, receipts and payouts.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): customer invoices and payouts (read only; staff write them on the admin API) are in backend/ (P2-W3).
// Rules: no functions or logic, only "import type" lines; every permission starts with "invoicing."; models match the "/// @app invoicing" tags in schema.prisma.

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "invoicing",
  kind: "app",
  name: { en: "Invoicing", ne: "बिल तथा रसिद" },
  tagline: { en: "Invoices, receipts and payouts." },
  icon: "file-text",
  category: "money",
  businessTypes: "all",
  trialDays: null,
  limits: [],
  editions: [{ id: "free", name: { en: "Free" }, free: true, limits: {}, features: [], price: null }],
  permissions: [
    { id: "invoicing.invoice.read", label: { en: "See invoices and receipts", ne: "बिल र रसिद हेर्ने" }, scopes: ["branch", "all"], default: "branch", group: "Invoices" },
    { id: "invoicing.invoice.create", label: { en: "Create invoices" }, scopes: ["branch", "all"], default: "branch", group: "Invoices" },
    {
      id: "invoicing.payout.read",
      label: { en: "See payouts and statements", ne: "भुक्तानी विवरण हेर्ने" },
      scopes: ["branch", "all"],
      default: "branch",
      group: "Payouts",
    },
  ],
  roles: [
    {
      key: "accountant",
      types: ["hotel", "developer", "agency"],
      add: ["invoicing.invoice.read:branch", "invoicing.invoice.create:branch", "invoicing.payout.read:branch"],
    },
    { key: "sales_manager", types: ["developer"], add: ["invoicing.invoice.read:branch"] },
    { key: "accountant", types: ["sponsor"], add: ["invoicing.invoice.read:branch", "invoicing.payout.read:branch"] },
  ],
  approvals: [],
  menu: [],
  events: {
    publishes: [
      { name: "invoicing.invoice.drafted", v: 1, label: "An invoice draft was saved", payload: { id: "id", no: "string", total: "number" } },
      { name: "invoicing.invoice.sent", v: 1, label: "An invoice was sent (it got its tax number)", payload: { id: "id", no: "string", total: "number" } },
      { name: "invoicing.invoice.paid", v: 1, label: "A payment (receipt) was recorded", payload: { id: "id", receipt: "string", amount: "number" } },
      { name: "invoicing.invoice.cancelled", v: 1, label: "An invoice was cancelled (it keeps its number)", payload: { id: "id", no: "string" } },
      { name: "invoicing.invoice.credited", v: 1, label: "A credit note was issued", payload: { id: "id", no: "string", invoiceId: "id", total: "number" } },
      { name: "invoicing.invoice.deleted", v: 1, label: "A draft was deleted", payload: { id: "id" } },
      { name: "invoicing.invoice.imported", v: 1, label: "Invoices were imported", payload: { count: "number" } },
    ],
    consumes: [],
  },
  ai: [],
  dependencies: { requires: [], optional: ["hotel"], reads: ["Booking", "FolioLine", "GuestPayment"] },
  models: ["BizInvoice", "BizReceipt", "Payout", "PayoutItem"],
  branchOwned: [{ model: "BizInvoice", label: { en: "invoice" } }, { model: "Payout", label: { en: "payout" } }, { model: "PayoutItem", label: { en: "payout line" } }],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
