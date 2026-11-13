// Hotel PMS: bookings, calendar and rates (also used by hosts).
// Where it fits: read as data by scripts/gen-permissions.mjs (permission lists, role templates) and scripts/check-manifests.mjs.
// How it works: a plain object, declaration only (id, name, icon, business types, permissions, roles, models): rooms, calendar, bookings and the front desk (P2-W4) and the online travel sites (P2-W6: OtaFeed, OtaRequest, OtaAccount) are in backend/.
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
  // Phase 3 (P3-BE-1): first values only. The live values (prices, limits, trial) are the platform.catalog setting, edited in Admin -> Pricing;
  // prices are in platform/src/billing/catalog.seed.ts, not here.
  trialDays: 14,
  limits: [
    { key: "rooms", label: { en: "Rooms" }, unit: "count" },
  ],
  editions: [
    { id: "free", name: { en: "Free" }, free: true, limits: { rooms: 5 }, features: [], price: null },
    { id: "full", name: { en: "Full" }, free: false, limits: { rooms: 40 }, features: ["hotel.calendar", "hotel.channel_sync"], price: null },
  ],
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
  events: {
    publishes: [
      { name: "hotel.feed.added", v: 1, label: "Another site's calendar was connected", payload: { id: "id" } },
      { name: "hotel.feed.synced", v: 1, label: "Another site's calendar was read", payload: { id: "id", added: "number", updated: "number", cancelled: "number" } },
      { name: "hotel.otarequest.sent", v: 1, label: "Asked Sheetal to sell a stay on another site", payload: { id: "id", channel: "string" } },
      { name: "hotel.otarequest.replied", v: 1, label: "Answered Sheetal's channel team", payload: { id: "id" } },
      { name: "hotel.otarequest.paused", v: 1, label: "Asked to stop selling on another site", payload: { id: "id" } },
      { name: "hotel.room.added", v: 1, label: "Rooms were added", payload: { count: "number", type: "string" } },
      { name: "hotel.room.updated", v: 1, label: "A room was changed or cleaned", payload: { id: "id", status: "string" } },
      { name: "hotel.calendar.changed", v: 1, label: "Night prices, closed dates or rules changed", payload: { type: "string" } },
      { name: "hotel.booking.created", v: 1, label: "A booking was made", payload: { id: "id", code: "string", nights: "number", rate: "number" } },
      { name: "hotel.booking.updated", v: 1, label: "A booking was confirmed or changed", payload: { id: "id", code: "string", status: "string" } },
      { name: "hotel.booking.cancelled", v: 1, label: "A booking was cancelled", payload: { id: "id", code: "string", status: "string" } },
      { name: "hotel.booking.checked_in", v: 1, label: "A guest checked in", payload: { id: "id", code: "string", roomId: "id" } },
      { name: "hotel.folio.added", v: 1, label: "An extra or a discount went on a room bill", payload: { id: "id", kind: "string", amount: "number" } },
      { name: "hotel.payment.received", v: 1, label: "A guest paid at the desk", payload: { id: "id", method: "string", amount: "number" } },
      { name: "hotel.booking.checked_out", v: 1, label: "A guest checked out", payload: { id: "id", code: "string", total: "number" } },
    ],
    consumes: [],
  },
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
