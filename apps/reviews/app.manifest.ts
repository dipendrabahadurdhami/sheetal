// Reviews: see what people say about your business and reply in public.
// Where it fits: loaded by the generator (permissions, menu, roles) and by the API at start (events).
// How it works: plain data. Reviews do not belong to a branch, so branchOwned is empty. Today customers.view reads reviews and reviews.reply replies (see the alias map).
// Rules: no functions or logic; every permission and event starts with "reviews."; the code lives in apps/reviews/backend (moved in by P1-BE-6).

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "reviews",
  kind: "app",
  name: { en: "Reviews", ne: "समीक्षा" },
  tagline: { en: "See what people say about your business and reply in public." },
  icon: "star",
  category: "growth",
  businessTypes: "all",
  // Phase 3 (P3-BE-1): first values only. The live values (prices, limits, trial) are the platform.catalog setting, edited in Admin -> Pricing;
  // prices are in platform/src/billing/catalog.seed.ts, not here.
  trialDays: 14,
  limits: [
    { key: "reviews_per_month", label: { en: "Reviews a month" }, unit: "per_month" },
  ],
  editions: [
    { id: "free", name: { en: "Free" }, free: true, limits: { reviews_per_month: 20 }, features: [], price: null },
    { id: "full", name: { en: "Full" }, free: false, limits: { reviews_per_month: null }, features: ["reviews.replies", "reviews.widgets"], price: null },
  ],
  permissions: [
    { id: "reviews.review.read", label: { en: "See reviews" }, scopes: ["branch", "all"], default: "branch", group: "Reviews" },
    { id: "reviews.review.reply", label: { en: "Reply to reviews" }, scopes: ["branch", "all"], default: "branch", group: "Reviews" },
  ],
  roles: [
    { key: "frontdesk", types: ["hotel"], add: ["reviews.review.read:branch"] },
    { key: "cohost", types: ["host"], add: ["reviews.review.read:branch", "reviews.review.reply:branch"] },
    { key: "sales_manager", types: ["developer"], add: ["reviews.review.read:branch"] },
    { key: "sales_exec", types: ["developer"], add: ["reviews.review.read:branch"] },
    { key: "branch_manager", types: ["agency"], add: ["reviews.review.read:branch", "reviews.review.reply:branch"] },
  ],
  approvals: [],
  menu: [
    {
      id: "reviews",
      label: { en: "Reviews", ne: "समीक्षा" },
      icon: "star",
      path: "/business/reviews",
      group: "customers",
      order: 30,
      anyPermission: ["reviews.review.read", "reviews.review.reply"],
    },
  ],
  events: { publishes: [{ name: "reviews.review.replied", v: 1, label: "A business replied to a review", payload: { reviewId: "id", hasReply: "boolean" } }], consumes: [] },
  ai: [
    {
      id: "reply_drafter",
      name: { en: "Draft a reply" },
      description: { en: "Writes a polite first reply you can edit." },
      minutesSaved: 3,
      status: "planned",
      permission: "reviews.review.reply",
    },
  ],
  dependencies: { requires: [], optional: ["listings"], reads: ["Listing"] },
  models: ["Review"],
  branchOwned: [],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
