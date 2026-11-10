// Listings: property listings and viewings.
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): the routes stay in their old modules until the app moves onto the kernel.
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
  trialDays: null,
  limits: [],
  editions: [{ id: "free", name: { en: "Free" }, free: true, limits: {}, features: [], price: null }],
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
  events: { publishes: [], consumes: [] },
  ai: [],
  dependencies: { requires: [], optional: [], reads: [] },
  models: ["Listing", "ListingPhoto", "ListingReview", "Favourite", "DemandMatch"],
  branchOwned: [{ model: "Listing", label: { en: "listing" } }, { model: "ListingReview", label: { en: "listing review" } }],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
