// Listings: property listings and viewings.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): a business's listings are in backend/ (P2-W5); review by staff stays on the admin API, and the screens read the panel store until wave 6.
// Rules: no functions or logic, only "import type" lines; every permission starts with "listings."; models match the "/// @app listings" tags in schema.prisma.

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "listings",
  kind: "app",
  name: { en: "Listings", ne: "सूची" },
  tagline: { en: "Add, edit and publish property listings and book viewings." },
  icon: "house",
  category: "property",
  businessTypes: ["agency"],
  // Phase 3 (P3-BE-1): first values only. The live values (prices, limits, trial) are the platform.catalog setting, edited in Admin -> Pricing;
  // prices are in platform/src/billing/catalog.seed.ts, not here.
  trialDays: 14,
  limits: [
    { key: "listings", label: { en: "Listings" }, unit: "count" },
    { key: "stays", label: { en: "Stays (homes for short stays)" }, unit: "count" },
  ],
  editions: [
    { id: "free", name: { en: "Free" }, free: true, limits: { listings: 3, stays: null }, features: [], price: null },
    { id: "full", name: { en: "Full" }, free: false, limits: { listings: 500, stays: null }, features: ["listings.checkups"], price: null },
  ],
  permissions: [
    { id: "listings.listing.read", label: { en: "See listings" }, scopes: ["branch", "all"], default: "branch", group: "Listings" },
    { id: "listings.listing.create", label: { en: "Add listings" }, scopes: ["branch", "all"], default: "branch", group: "Listings" },
    { id: "listings.listing.update", label: { en: "Change listings" }, scopes: ["branch", "all"], default: "branch", group: "Listings" },
    { id: "listings.listing.delete", label: { en: "Delete listings" }, scopes: ["branch", "all"], default: "branch", group: "Listings" },
    { id: "listings.listing.publish", label: { en: "Publish listings" }, scopes: ["branch", "all"], default: "branch", group: "Listings" },
    { id: "listings.viewing.read", label: { en: "See viewings" }, scopes: ["branch", "all"], default: "branch", group: "Viewings" },
    { id: "listings.viewing.create", label: { en: "Add viewings" }, scopes: ["branch", "all"], default: "branch", group: "Viewings" },
    { id: "listings.viewing.update", label: { en: "Change viewings" }, scopes: ["branch", "all"], default: "branch", group: "Viewings" },
    { id: "listings.viewing.delete", label: { en: "Delete viewings" }, scopes: ["branch", "all"], default: "branch", group: "Viewings" },
  ],
  roles: [
    {
      key: "branch_manager",
      types: ["agency"],
      add: [
        "listings.listing.read:branch",
        "listings.listing.create:branch",
        "listings.listing.update:branch",
        "listings.listing.delete:branch",
        "listings.listing.publish:branch",
        "listings.viewing.read:branch",
        "listings.viewing.create:branch",
        "listings.viewing.update:branch",
        "listings.viewing.delete:branch",
      ],
    },
    {
      key: "agent",
      types: ["agency"],
      add: [
        "listings.listing.read:branch",
        "listings.listing.create:branch",
        "listings.listing.update:branch",
        "listings.listing.delete:branch",
        "listings.listing.publish:branch",
        "listings.viewing.read:branch",
        "listings.viewing.create:branch",
        "listings.viewing.update:branch",
        "listings.viewing.delete:branch",
      ],
    },
  ],
  approvals: [],
  menu: [],
  events: {
    publishes: [
      { name: "listings.checkup.setup_saved", v: 1, label: "The check-up settings were saved", payload: { id: "id" } },
      { name: "listings.checkup.reviewed", v: 1, label: "A reviewer checked a listing (correct, changed or skipped)", payload: { id: "id", action: "string" } },
      { name: "listings.checkup.decided", v: 1, label: "The day's check-up changes were decided", payload: { applied: "number", conflicts: "number" } },
      { name: "listings.checkup.picked", v: 1, label: "The owner picked a value no reviewer majority chose", payload: { id: "id" } },
      { name: "listings.listing.drafted", v: 1, label: "A listing was saved as a draft", payload: { id: "id", code: "string", kind: "string" } },
      { name: "listings.listing.submitted", v: 1, label: "A listing was sent to Sheetal for review", payload: { id: "id", code: "string", kind: "string" } },
      { name: "listings.listing.updated", v: 1, label: "A draft or a listing was changed", payload: { id: "id", code: "string", kind: "string" } },
      { name: "listings.listing.status_changed", v: 1, label: "Listings were published, paused, archived or marked sold", payload: { codes: "string", status: "string" } },
      { name: "listings.listing.removed", v: 1, label: "Listings were deleted (kept as removed)", payload: { codes: "string" } },
      { name: "listings.listing.moved", v: 1, label: "A listing moved to another business", payload: { id: "id", code: "string", to: "id" } },
    ],
    consumes: [],
  },
  ai: [],
  dependencies: { requires: [], optional: [], reads: [] },
  models: ["Listing", "ListingPhoto", "ListingReview", "Favourite", "DemandMatch"],
  branchOwned: [{ model: "Listing", label: { en: "listing" } }, { model: "ListingReview", label: { en: "listing review" } }],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
