// Answers API calls from the demo database.
import { db, save, LOCATIONS, PROPERTY_TYPES, CATEGORIES } from "./db";
import { readDb } from "../../utils/platformDb";
import { PERIODS, planFeatureList, priceFor, savingFor } from "@sheetal/shared/core/plans";

// Plans for one business type, from the same list Business and Admin use (Starter, Business, Pro).
const sitePlans = (type = "agency") => (readDb().plans || []).filter((p) => p.type === type && p.active).map((p) => ({
  id: p.id, type: p.type, name: p.name, slug: p.name.toLowerCase(), price: p.price,
  periods: PERIODS.map((x) => ({ months: x.months, save: x.save, price: priceFor(p, x.months), saving: savingFor(p, x.months) })),
  // Every feature of this plan as [included, text], in the same order on every card (see shared/src/core/plans.js).
  features: planFeatureList(p, type, readDb().aiConfig?.credits),
}));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (status, message) => { const e = new Error(message); e.response = { status, data: { message } }; throw e; };

const toObj = (data) => {
  if (!data) return {};
  if (data instanceof FormData) {
    const o = {};
    data.forEach((v, k) => {
      const key = k.replace(/\[\]$/, "");
      const val = typeof v === "string" ? v : URL.createObjectURL(v);
      if (k.endsWith("[]")) (o[key] = o[key] || []).push(val); else o[key] = val;
    });
    return o;
  }
  return typeof data === "string" ? JSON.parse(data) : data;
};

const me = () => {
  const m = (localStorage.getItem("sheetal_token") || "").match(/demo-token-(\d+)/);
  return m ? db.users.find((u) => u.id === Number(m[1])) : null;
};
const needUser = () => me() || fail(401, "Please log in first.");
const pub = (u) => { const { password, ...r } = u; return r; };
const withAgent = (p) => ({ ...p, agent: db.agents.find((a) => a.id === p.agent_id) || null });
const newest = (l) => [...l].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

const page = (list, q) => {
  const p = Number(q.page || 1), per = Number(q.per_page || q.itemsPerPage || 12);
  const meta = { total: list.length, current_page: p, last_page: Math.max(1, Math.ceil(list.length / per)), per_page: per };
  return { status: 200, data: list.slice((p - 1) * per, p * per), meta, ...meta };
};

const filter = (q) => {
  const v = (k) => String(q[k] ?? "").toLowerCase().trim();
  let l = db.properties;
  const kw = v("keyword").replace(/^#/, "");
  if (kw) l = l.filter((p) => [p.name, p.property_location, p.district, p.property_type, p.property_code].join(" ").toLowerCase().includes(kw));
  const pur = v("advertisement_purpose");
  if (pur && pur !== "all") l = l.filter((p) => p.purpose.toLowerCase().startsWith(pur.slice(0, 4)));
  if (v("property_type") && v("property_type") !== "all") l = l.filter((p) => p.property_type.toLowerCase() === v("property_type"));
  if (v("category") && v("category") !== "all") l = l.filter((p) => p.property_category.toLowerCase() === v("category"));
  if (v("property_status") && v("property_status") !== "all") l = l.filter((p) => p.property_status.toLowerCase() === v("property_status"));
  if (v("district")) l = l.filter((p) => p.district.toLowerCase() === v("district"));
  if (Number(q.min_price)) l = l.filter((p) => p.total_price >= Number(q.min_price));
  if (Number(q.max_price)) l = l.filter((p) => p.total_price <= Number(q.max_price));
  if (Number(q.bedrooms)) l = l.filter((p) => p.bedroom >= Number(q.bedrooms));
  const o = v("price_order");
  if (o === "low_to_high") return [...l].sort((a, b) => a.total_price - b.total_price);
  if (o === "high_to_low") return [...l].sort((a, b) => b.total_price - a.total_price);
  if (o === "oldest") return newest(l).reverse();
  return newest(l);
};

const ok = (data, extra = {}) => ({ status: 200, data, ...extra });

const routes = [
  ["get", /^\/banners$/, () => db.banners],
  ["get", /^\/property-attributes$/, () => ok({
    property_types: PROPERTY_TYPES.map((name, i) => ({ id: i + 1, name })),
    categories: CATEGORIES.map((name, i) => ({ id: i + 1, name })),
    purposes: ["Sale", "Rent"].map((name, i) => ({ id: i + 1, name })),
    property_status: ["AVAILABLE", "SOLD OUT", "RENTED OUT"].map((name, i) => ({ id: i + 1, name })),
    facilities: ["Parking", "Water Supply", "Security", "CCTV", "Power Backup", "Garden", "Balcony", "Lift", "WiFi", "Gym"].map((name, i) => ({ id: i + 1, name })),
  })],
  ["get", /^\/search\/suggestions$/, (q) => {
    const s = String(q.q || "").toLowerCase(), m = (x) => !s || x.toLowerCase().includes(s), u = (a) => [...new Set(a)];
    return {
      districts: u(LOCATIONS.map((l) => l.district)).filter(m).slice(0, 4).map((name) => ({ name, type: "district" })),
      cities: u(LOCATIONS.map((l) => l.city)).filter(m).slice(0, 5).map((name) => ({ name, type: "city" })),
      localities: LOCATIONS.filter((l) => m(l.locality)).slice(0, 6).map((l) => ({ name: l.locality, locality: l.city, type: "locality" })),
      properties: s ? db.properties.filter((p) => m(p.name)).slice(0, 4).map((p) => ({ name: p.name, locality: p.property_location, type: "property", id: p.id })) : [],
    };
  }],
  ["get", /^\/featured-property-list$/, () => ok(db.properties.filter((p) => p.is_featured))],
  ["get", /^\/all-properties$/, (q) => page(newest(db.properties), q)],
  ["get", /^\/(sale|rent)$/, (q, [, k]) => page(newest(db.properties.filter((p) => p.purpose === (k === "rent" ? "Rent" : "Sale"))), q)],
  ["get", /^\/search$/, (q) => page(filter(q), q)],
  ["get", /^\/property-detail\/(\d+)$/, (q, [, id]) => { const p = db.properties.find((x) => x.id === Number(id)) || fail(404, "Property not found"); p.views++; save(); return ok(withAgent(p)); }],
  ["get", /^\/property-by-slug\/(.+)$/, (q, [, s]) => ok(withAgent(db.properties.find((x) => x.url === s) || fail(404, "Property not found")))],
  ["get", /^\/property-by-code\/(.+)$/, (q, [, c]) => { const k = c.replace("#", "").toUpperCase(); return ok(withAgent(db.properties.find((x) => x.property_code === k || String(x.id) === k) || fail(404, "Not found"))); }],

  ["get", /^\/agent-list$/, () => ok(db.agents)],
  ["get", /^\/agent-detail\/(\d+)$/, (q, [, id]) => ok(db.agents.find((a) => a.id === Number(id)) || fail(404, "Agent not found"))],
  ["get", /^\/agent-properties\/(\d+)$/, (q, [, id]) => ok(db.properties.filter((p) => p.agent_id === Number(id)))],

  ["get", /^\/reviews-public$/, (q) => ok(newest(db.reviews.filter((r) => r.type === q.type && (q.type === "agent" ? r.agent_id === Number(q.agent_id) : r.property_id === Number(q.property_id)))))],
  ["post", /^\/reviews$/, (q, m, b) => { const u = needUser(); db.reviews.push({ id: Date.now(), ...b, rating: Number(b.rating), property_id: Number(b.property_id) || undefined, agent_id: Number(b.agent_id) || undefined, user: { name: u.user_name, photo: u.photo }, created_at: new Date().toISOString() }); save(); return { status: 200, message: "Thank you for your review." }; }],

  ["post", /^\/(contact-agent|contact-owner|schedule-tour|requirement-form|agent-requirement-form|contact)$/, (q, [, k], b) => { (k === "schedule-tour" ? db.tours : db.inquiries).push({ type: k, ...b, created_at: new Date().toISOString() }); save(); return { status: 200, message: "Sent. We will get back to you soon." }; }],
  ["get", /^\/property-demand-list$/, () => ok(db.demands)],
  ["get", /^\/demand-matches-by-requirements$/, (q) => ok(String(q.requirement_form_ids || "").split(",").filter(Boolean).map((id) => ({ requirement_form_id: Number(id), matches_count: (Number(id) * 7) % 5 })))],
  ["post", /^\/demand-match$/, () => { needUser(); return { status: 200, message: "Match submitted. The buyer will be notified." }; }],
  ["get", /^\/requirement-fee\/settings-public$/, () => ok({ enabled: true, amount: 500, currency: "NPR", note: "Pay Rs. 500 by Fonepay or eSewa and upload the screenshot." })],
  ["post", /^\/ask-ai$/, (q, m, b) => {
    const list = (b.property_codes || []).map((c) => db.properties.find((p) => p.property_code === c)).filter(Boolean);
    if (!list.length) fail(422, "Add a valid property code.");
    const best = [...list].sort((a, z) => a.total_price - z.total_price)[0];
    const lines = list.map((p) => `${p.property_code}: ${p.name} in ${p.property_location}, ${p.property_area}, road ${p.road_access}, asking Rs. ${p.total_price.toLocaleString("en-IN")}.`);
    return { status: 200, summary: `${lines.join(" ")} ${list.length > 1 ? `For value, ${best.property_code} has the lowest asking price.` : ""} (Demo answer — the live site uses the AI service on the Laravel backend.)` };
  }],
  ["post", /^\/track-(visit|heartbeat)$/, () => ({ ok: true })],
  ["post", /^\/reset-password$/, () => ({ status: 200, message: "Your password has been reset. Please log in." })],
  ["post", /^\/email\/(resend|change-resend|resend-verification)$/, () => ({ status: 200, message: "Verification email sent." })],
  ["get", /^\/email\/verify\/.*/, () => fail(400, "This link has expired or was already used. Please ask for a new one.")],

  ["post", /^\/login$/, (q, m, b) => {
    const u = db.users.find((x) => x.email === String(b.email || "").toLowerCase());
    if (!u || u.password !== b.password) fail(401, "Wrong email or password.");
    return ok({ ...pub(u), token: `demo-token-${u.id}` });
  }],
  ["post", /^\/register$/, (q, m, b) => {
    const email = String(b.email || "").toLowerCase();
    if (db.users.some((u) => u.email === email)) fail(422, "This email is already registered.");
    const u = { id: db.users.length + 1, user_name: b.user_name || email.split("@")[0], first_name: b.user_name || "", last_name: "", email, password: b.password, phone: "", photo: null, user_type: b.user_type || "User", plan: "Starter", email_verified: true };
    db.users.push(u); save();
    return { status: 200, message: "Account created. You can log in now." };
  }],
  ["post", /^\/logout$/, () => ({ status: 200, message: "You are logged out." })],
  ["post", /^\/forgot-password$/, () => ({ status: 200, message: "If the email exists, a reset link has been sent." })],
  ["get", /^\/user-info$/, () => ok(pub(needUser()))],
  ["post", /^\/update-profile$/, (q, m, b) => { const u = needUser(); Object.assign(u, b); save(); return { status: 200, message: "Profile updated", data: pub(u) }; }],
  ["post", /^\/change-password$/, (q, m, b) => { const u = needUser(); if (b.current_password !== u.password) fail(422, "Current password is not correct."); u.password = b.new_password; save(); return { status: 200, message: "Password changed" }; }],

  ["get", /^\/user-favourites-list$/, () => { const u = needUser(); return ok(db.favourites.filter((f) => f.user_id === u.id).map((f) => ({ ...f, property: db.properties.find((p) => p.id === f.property_id) })).filter((f) => f.property)); }],
  ["post", /^\/add-to-favourite$/, (q, m, b) => { const u = needUser(), id = Number(b.property_id); if (!db.favourites.some((f) => f.user_id === u.id && f.property_id === id)) db.favourites.push({ user_id: u.id, property_id: id }); save(); return { status: 200, message: "Saved" }; }],
  ["post", /^\/remove-from-favourite$/, (q, m, b) => { const u = needUser(), id = Number(b.property_id); db.favourites = db.favourites.filter((f) => !(f.user_id === u.id && f.property_id === id)); save(); return { status: 200, message: "Removed" }; }],
  ["get", /^\/user-property$/, () => { const u = needUser(); return ok(newest(db.properties.filter((p) => p.user_id === u.id))); }],
  ["post", /^\/post-property\/?$/, (q, m, b) => {
    const u = needUser();
    const id = Math.max(0, ...db.properties.map((p) => p.id)) + 1;
    const purpose = Number(b.purpose_id) === 2 ? "Rent" : "Sale";
    const type = PROPERTY_TYPES[Number(b.propertytype_id) - 1] || "House";
    const p = { ...b, id, property_code: `SP${1000 + id}`, url: `listing-${id}`, name: b.name, title: b.name, purpose, property_type: type,
      total_price: Number(b.total_price) || 0, price: Number(b.total_price) || 0, bedroom: Number(b.bedrooms) || 0, bathroom: Number(b.bathrooms) || 0,
      property_location: b.property_location, district: b.district || "", feature_image: b.feature_image || "/demo/1.jpg",
      gallery_images: (b.gallery_images || []).map((image) => ({ image })), sold: 0, property_status: "AVAILABLE", is_featured: false, views: 0,
      property_description: b.property_description ? `<p>${b.property_description}</p>` : "", property_highlights: b.property_highlights ? `<p>${b.property_highlights}</p>` : "",
      user_id: u.id, agent_id: 1, posted_by: u.user_name, posted_date: new Date().toISOString().slice(0, 10), created_at: new Date().toISOString() };
    db.properties.unshift(p); save();
    return { status: 200, message: "Your property is posted.", data: p };
  }],
  ["delete", /^\/delete-property\/(\d+)$/, (q, [, id]) => { db.properties = db.properties.filter((p) => p.id !== Number(id)); save(); return { status: 200, message: "Deleted" }; }],
  ["post", /^\/mark-as-sold$/, (q, m, b) => { const p = db.properties.find((x) => x.id === Number(b.property_id)); if (p) { p.sold = b.sold ? 1 : 0; p.property_status = b.sold ? (p.purpose === "Rent" ? "RENTED OUT" : "SOLD OUT") : "AVAILABLE"; save(); } return { status: 200, message: "Updated" }; }],
  ["get", /^\/agent-notifications$/, () => { needUser(); return ok(db.notifications, { unread_count: db.notifications.filter((n) => !n.read).length }); }],
  ["post", /^\/agent-notifications\/read-all$/, () => { db.notifications.forEach((n) => (n.read = true)); save(); return { status: 200 }; }],
  ["get", /^\/subscription-plans$/, (q) => ok(sitePlans(q.type))],
  ["post", /^\/request-upgrade$/, () => ({ status: 200, message: "Upgrade request sent. Our team will call you." })],

  ["get", /^\/blog\/categories$/, () => ok(db.blogCategories)],
  ["get", /^\/blog\/category\/([^/]+)$/, (q, [, s]) => ({ ...page(db.blogs.filter((b) => b.category.slug === s), q), category: db.blogCategories.find((c) => c.slug === s) })],
  ["post", /^\/blog\/(\d+)\/comment$/, () => ({ status: 200, message: "Comment submitted for review." })],
  ["get", /^\/blog\/([^/]+)$/, (q, [, s]) => { const b = db.blogs.find((x) => x.slug === s) || fail(404, "Article not found"); return ok(b, { related: db.blogs.filter((x) => x.id !== b.id).slice(0, 3) }); }],
  ["get", /^\/blog$/, (q) => page(db.blogs, q)],

  ["get", /^\/jobs$/, () => ok(db.jobs)],
  ["post", /^\/jobs\/([^/]+)\/apply$/, () => ({ status: 200, message: "Application received. Good luck!" })],
  ["get", /^\/jobs\/([^/]+)$/, (q, [, s]) => ok(db.jobs.find((j) => j.slug === s) || fail(404, "Job not found"))],
];

export async function mockRequest(method, url, { params = {}, data } = {}) {
  await wait(180 + Math.random() * 320);
  const [path, qs] = url.split("?");
  const q = { ...Object.fromEntries(new URLSearchParams(qs || "")), ...params };
  for (const [m, re, fn] of routes) {
    if (m !== method.toLowerCase()) continue;
    const match = path.match(re);
    if (match) return fn(q, match, toObj(data));
  }
  console.warn("[demo data] no route for", method.toUpperCase(), path);
  return { status: 200, data: [] };
}
