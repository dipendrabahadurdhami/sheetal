// Hotel PMS: bookings, calendar and rates (also used by hosts).
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): the routes stay in their old modules until the app moves onto the kernel.
// Rules: no functions or logic, only "import type" lines; every permission starts with "hotel."; models match the "/// @app hotel" tags in schema.prisma.

import type { AppManifest } from "@sheetal/platform/core/manifest";

const manifest = {
  manifestVersion: 1,
  id: "hotel",
  kind: "app",
  name: { en: "Hotel PMS", ne: "होटल व्यवस्थापन" },
  tagline: { en: "Bookings, the calendar and rates for hotels and hosts." },
  icon: "bed-double",
  category: "hospitality",
  businessTypes: ["hotel", "host"],
  trialDays: null,
  limits: [],
  editions: [{ id: "free", name: { en: "Free" }, free: true, limits: {}, features: [], price: null }],
  permissions: [
    { id: "hotel.booking.read", label: { en: "See bookings", ne: "बुकिङ हेर्ने" }, scopes: ["branch", "all"], default: "branch", group: "Bookings" },
    { id: "hotel.booking.create", label: { en: "Create manual bookings", ne: "बुकिङ बनाउने" }, scopes: ["branch", "all"], default: "branch", group: "Bookings" },
    { id: "hotel.booking.update", label: { en: "Change dates and rooms", ne: "मिति र कोठा बदल्ने" }, scopes: ["branch", "all"], default: "branch", group: "Bookings" },
    {
      id: "hotel.booking.cancel",
      label: { en: "Cancel and refund bookings", ne: "बुकिङ रद्द र फिर्ता गर्ने" },
      scopes: ["branch", "all"],
      default: "branch",
      group: "Bookings",
    },
    { id: "hotel.calendar.read", label: { en: "See the calendar", ne: "पात्रो हेर्ने" }, scopes: ["branch", "all"], default: "branch", group: "Calendar and rates" },
    {
      id: "hotel.calendar.update",
      label: { en: "Block dates, edit rates and rules", ne: "मिति रोक्ने, दर र नियम बदल्ने" },
      scopes: ["branch", "all"],
      default: "branch",
      group: "Calendar and rates",
    },
  ],
  roles: [
    { key: "frontdesk", types: ["hotel"], add: ["hotel.booking.read:branch", "hotel.booking.create:branch", "hotel.booking.update:branch", "hotel.calendar.read:branch"] },
    { key: "housekeeping", types: ["hotel"], add: ["hotel.calendar.read:branch"] },
    { key: "accountant", types: ["hotel"], add: ["hotel.booking.read:branch"] },
    {
      key: "cohost",
      types: ["host"],
      add: ["hotel.booking.read:branch", "hotel.booking.create:branch", "hotel.booking.update:branch", "hotel.calendar.read:branch", "hotel.calendar.update:branch"],
    },
    { key: "cleaner", types: ["host"], add: ["hotel.calendar.read:branch"] },
  ],
  approvals: [],
  menu: [],
  events: { publishes: [], consumes: [] },
  ai: [],
  dependencies: { requires: [], optional: [], reads: [] },
  models: ["Room", "RoomRule", "RateDay", "Booking", "FolioLine", "GuestPayment", "OtaFeed", "OtaRequest", "OtaAccount"],
  branchOwned: [
    { model: "Room", label: { en: "room" } },
    { model: "RoomRule", label: { en: "room rule" } },
    { model: "RateDay", label: { en: "rate day" } },
    { model: "Booking", label: { en: "booking" } },
    { model: "OtaRequest", label: { en: "channel request" } },
  ],
  settings: [],
  jobs: [],
} satisfies AppManifest;

export default manifest;
