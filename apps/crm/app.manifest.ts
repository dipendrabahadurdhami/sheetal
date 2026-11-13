// CRM: leads (agencies), customers and inbox messages.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): the Inbox (leads, replies) is in backend/ (P2-W5); the screens read the panel store until wave 6.
// Rules: no functions or logic, only "import type" lines; every permission starts with "crm."; models match the "/// @app crm" tags in schema.prisma.

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "crm",
  kind: "app",
  name: { en: "CRM", ne: "ग्राहक सम्बन्ध" },
  tagline: { en: "Leads, customers and the messages inbox." },
  icon: "users",
  category: "sales",
  businessTypes: "all",
  // Phase 3 (P3-BE-1): first values only. The live values (prices, limits, trial) are the platform.catalog setting, edited in Admin -> Pricing;
  // prices are in platform/src/billing/catalog.seed.ts, not here.
  trialDays: 14,
  limits: [
    { key: "leads", label: { en: "Leads" }, unit: "count" },
    { key: "pipelines", label: { en: "Pipelines" }, unit: "count" },
  ],
  editions: [
    { id: "free", name: { en: "Free" }, free: true, limits: { leads: 100, pipelines: 1 }, features: [], price: null },
    { id: "full", name: { en: "Full" }, free: false, limits: { leads: null, pipelines: null }, features: ["crm.assignment", "crm.lead_finder"], price: null },
  ],
  permissions: [
    { id: "crm.lead.read", label: { en: "See leads" }, scopes: ["own", "branch", "all"], default: "branch", group: "Leads", types: ["agency"] },
    { id: "crm.lead.assign", label: { en: "Assign leads" }, scopes: ["branch", "all"], default: "branch", group: "Leads", types: ["agency"] },
    { id: "crm.customer.read", label: { en: "See customer details and IDs" }, scopes: ["branch", "all"], default: "branch", group: "Customers" },
    { id: "crm.message.reply", label: { en: "Reply to messages", ne: "सन्देशको जवाफ दिने" }, scopes: ["branch", "all"], default: "branch", group: "Messages" },
  ],
  roles: [
    { key: "frontdesk", types: ["hotel"], add: ["crm.customer.read:branch", "crm.message.reply:branch"] },
    { key: "cohost", types: ["host"], add: ["crm.customer.read:branch", "crm.message.reply:branch"] },
    { key: "sales_manager", types: ["developer"], add: ["crm.customer.read:branch", "crm.message.reply:branch"] },
    { key: "sales_exec", types: ["developer"], add: ["crm.customer.read:branch", "crm.message.reply:branch"] },
    { key: "branch_manager", types: ["agency"], add: ["crm.lead.read:branch", "crm.lead.assign:branch", "crm.customer.read:branch", "crm.message.reply:branch"] },
    { key: "agent", types: ["agency"], add: ["crm.lead.read:branch", "crm.message.reply:branch"] },
    { key: "investor_relations", types: ["sponsor"], add: ["crm.message.reply:branch"] },
  ],
  approvals: [],
  menu: [],
  events: {
    publishes: [
      { name: "crm.lead.found", v: 1, label: "The AI lead finder added leads", payload: { count: "number" } },
      { name: "crm.lead.received", v: 1, label: "A lead came in (website enquiry, online form, public API, WhatsApp, Messenger, Instagram)", payload: { id: "id", channel: "string" } },
      { name: "crm.lead.updated", v: 1, label: "A lead was changed (owner, follow-up, tags, value, read)", payload: { id: "id", stage: "string", assigneeId: "id" } },
      { name: "crm.lead.stage_changed", v: 1, label: "A lead moved to another stage", payload: { id: "id", stage: "string", assigneeId: "id" } },
      { name: "crm.lead.replied", v: 1, label: "Someone replied to a lead", payload: { id: "id", channel: "string" } },
    ],
    consumes: [],
  },
  ai: [],
  dependencies: { requires: [], optional: ["listings"], reads: ["Listing", "ChannelAccount"] },
  models: ["Lead", "LeadMessage"],
  branchOwned: [{ model: "Lead", label: { en: "lead" } }],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
