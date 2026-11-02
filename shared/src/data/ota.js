// Selling on other sites (Booking.com, Airbnb …), run by Sheetal.
// Sheetal holds ONE partner account (contract, verification, payouts) with each site.
// A business never signs up with the site itself: from a listing it asks Sheetal to post it,
// and the Sheetal channel team sets it up under Sheetal's account and turns it live.
export const OTAS = [
  { id: "booking", name: "Booking.com", days: "3–5 days" },
  { id: "airbnb", name: "Airbnb", days: "2–4 days" },
  { id: "agoda", name: "Agoda", days: "5–7 days" },
  { id: "expedia", name: "Expedia", days: "7–10 days" },
  { id: "trip", name: "Trip.com", days: "5–7 days" },
  { id: "google", name: "Google Hotels", days: "1–2 days" },
];
export const otaName = (id) => OTAS.find((o) => o.id === id)?.name || id;
export const isOta = (src) => OTAS.some((o) => o.id === src);

// Platform settings (super admin → Settings → Other sites). Stored at platformSettings.ota.
export const OTA_DEFAULTS = {
  payoutDays: 7, minPhotos: 8, types: { hotel: true, host: true },
  sites: {
    booking: { on: true, commission: 15, fee: 2, markup: 15 }, airbnb: { on: true, commission: 3, fee: 2, markup: 10 },
    agoda: { on: true, commission: 15, fee: 2, markup: 15 }, expedia: { on: false, commission: 18, fee: 2, markup: 18 },
    trip: { on: true, commission: 15, fee: 2, markup: 15 }, google: { on: true, commission: 0, fee: 1, markup: 0 },
  },
};
export const otaSettings = (db) => {
  const s = db.platformSettings?.ota || {};
  return { ...OTA_DEFAULTS, ...s, types: { ...OTA_DEFAULTS.types, ...(s.types || {}) }, sites: Object.fromEntries(OTAS.map((o) => [o.id, { ...OTA_DEFAULTS.sites[o.id], ...(s.sites?.[o.id] || {}) }])) };
};
// What the business keeps from a booking made on a site
export const otaSplit = (db, ch, amount) => {
  const s = otaSettings(db).sites[ch] || { commission: 0, fee: 0 };
  const site = Math.round((amount * s.commission) / 100), fee = Math.round((amount * s.fee) / 100);
  return { site, fee, net: amount - site - fee, commission: s.commission, feePct: s.fee };
};

// requested → setting_up → live. Side states: needs_info (waiting on the business), stop_requested, paused, declined.
export const OTA_STATUS = {
  requested: ["Requested", "action"], setting_up: ["Being set up", "progress"], needs_info: ["Needs your reply", "action"],
  live: ["Live", "done"], stop_requested: ["Stop requested", "action"], paused: ["Paused", "neutral"], declined: ["Declined", "problem"],
};
export const OPEN = ["requested", "setting_up", "needs_info", "stop_requested"];
export const canAsk = (st) => !st || st === "paused" || st === "declined";

export function seedOta(db) {
  const T = (id) => (db.tenants || []).find((x) => x.id === id);
  const r = (id, tid, lid, title, ch, status, at, extra = {}) => ({ id, tid, lid, title, ch, status, at, price: extra.price ?? 15, note: extra.note || "", ask: extra.ask || "", otaId: extra.otaId || "", url: extra.url || "", by: extra.by || "", log: extra.log || [] });
  const list = [
    r("OTA-101", "t1", "S-201", "Lakeside Retreat Hotel", "booking", "live", "2026-11-04", { otaId: "BDC 8841207", by: "Sujata Rai", price: 15 }),
    r("OTA-103", "t1", "S-201", "Lakeside Retreat Hotel", "google", "live", "2026-12-01", { otaId: "GHA 220931", by: "Kiran Basnet", price: 0 }),
    r("OTA-118", "t1", "S-201", "Lakeside Retreat Hotel", "agoda", "setting_up", "2027-02-26", { by: "Kiran Basnet", note: "We want this before the April season." }),
    r("OTA-102", "t1", "S-202", "Garden villa at Lakeside Retreat", "airbnb", "live", "2026-11-10", { otaId: "ABNB 51298874", by: "Sujata Rai", price: 10 }),
    r("OTA-121", "t4", "S-301", "Fewa View Villa, Sedi", "airbnb", "live", "2026-12-12", { otaId: "ABNB 60011452", by: "Anjali Thapa", price: 10 }),
    r("OTA-124", "t4", "S-301", "Fewa View Villa, Sedi", "booking", "needs_info", "2027-02-28", { by: "Anjali Thapa", ask: "Please add 8 more photos (bathroom and kitchen) and your check-in time." }),
  ];
  [["t6", "booking", "requested", "First time on other sites."], ["t12", "airbnb", "requested", ""], ["t10", "agoda", "setting_up", ""]].forEach(([tid, ch, st, note], i) => {
    const x = T(tid); if (x) list.push(r(`OTA-13${i}`, tid, null, x.name, ch, st, `2027-03-0${i + 1}`, { note, by: st === "setting_up" ? "Sujata Rai" : "" }));
  });
  return { accounts: { booking: "connected", airbnb: "connected", agoda: "connected", expedia: "pending", trip: "connected", google: "connected" }, requests: list };
}
export const otaOf = (db) => db.otaDesk || seedOta(db);
export const withOta = (d) => (d.otaDesk = d.otaDesk || seedOta(d));
export const forListing = (db, lid) => otaOf(db).requests.filter((r) => r.lid === lid);
export const latestFor = (reqs, ch) => reqs.filter((r) => r.ch === ch).sort((a, b) => b.at.localeCompare(a.at))[0];

// Public page of a live listing. The channel team saves the real link when they mark it live.
const BASE = { booking: "https://www.booking.com/hotel/np/", airbnb: "https://www.airbnb.com/rooms/", agoda: "https://www.agoda.com/", expedia: "https://www.expedia.com/", trip: "https://www.trip.com/hotels/", google: "https://www.google.com/travel/hotels/" };
export const otaUrl = (r) => r.url || (BASE[r.ch] || "https://") + String(r.otaId || "").replace(/^[A-Z]+\s*/, "").replace(/\s+/g, "");
export const siteHref = (p) => (typeof window !== "undefined" && window.location.hash.startsWith("#/") ? `#${p}` : p);

// Reservations that arrive from the sites and still need the business to confirm them (demo data for t1)
export const OTA_RES = [
  { id: "BDC-4471028", ch: "booking", guest: "Hannah Weber", country: "Germany", room: "Deluxe lake view", from: "2027-03-08", to: "2027-03-11", amount: 23400, pay: "prepaid", status: "new" },
  { id: "HMXK29Q", ch: "airbnb", guest: "Arjun Mehta", country: "India", room: "Garden villa", from: "2027-03-14", to: "2027-03-18", amount: 52800, pay: "prepaid", status: "new" },
];
