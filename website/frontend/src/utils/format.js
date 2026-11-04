// Formatting for the website: prices (lakh, crore), dates, "time ago", photo addresses, sale or rent, sold.

import { planFeatureList } from "@sheetal/shared/core/plans";
export const fmtPrice = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  if (!n) return "Price on request";
  if (n >= 1e7) return `Rs. ${+(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `Rs. ${+(n / 1e5).toFixed(2)} Lakh`;
  if (n >= 1e3) return `Rs. ${+(n / 1e3).toFixed(1)}K`;
  return `Rs. ${n.toLocaleString("en-IN")}`;
};
export const fmtFull = (v) => `Rs. ${Number(v || 0).toLocaleString("en-IN")}`;

export const fmtDate = (d) => {
  const p = new Date(d);
  return isNaN(p) ? "" : p.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
export const timeAgo = (d) => {
  const s = (Date.now() - new Date(d)) / 1000;
  if (isNaN(s)) return "";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return fmtDate(d);
};

export const imgUrl = (src) => {
  if (!src) return null;
  if (typeof src === "object") src = src.image || src.url || src.path;
  if (!src) return null;
  if (/^(https?:|blob:|data:|\/)/.test(src)) return src;
  return `/storage/${src}`;
};

export const images = (p) => {
  const g = (p?.gallery_images || []).map(imgUrl).filter(Boolean);
  const f = imgUrl(p?.feature_image);
  return [...new Set([f, ...g].filter(Boolean))];
};

export const purposeOf = (p) => {
  const v = p?.purpose?.name || p?.purpose || p?.advertisement_purpose || "Sale";
  const s = String(v).toLowerCase();
  // Properties are only Sale or Rent. Old "Investment" (purpose id 3) records show as Sale.
  return s.startsWith("rent") || s === "lease" ? "Rent" : "Sale";
};

export const isSold = (p) => {
  const v = p?.sold ?? p?.is_sold;
  if (v && v !== "0" && v !== "false") return true;
  return /SOLD|RENTED/i.test(p?.property_status || "");
};

export const titleOf = (p) => p?.name || p?.title || "Untitled property";
export const linkOf = (p) => p?.link || `/property/${p?.url || p?.id}`;

export const specs = (p) => {
  const beds = Number(p?.bedroom ?? p?.bedrooms) || 0;
  const baths = Number(p?.bathroom ?? p?.bathrooms) || 0;
  const area = p?.property_area || (p?.land_area_in_anna_lal ? `${p.land_area_in_anna_lal} Aana` : "") || (p?.land_area_in_ropani_lal ? `${p.land_area_in_ropani_lal} Ropani` : "") || p?.built_up_area || "";
  return { beds, baths, area };
};

export const agencyName = (a) => {
  if (!a) return "Sheetal Property";
  const full = [a.first_name, a.last_name].filter((x) => x && x !== "null").join(" ");
  return full || a.user_name || a.name || "Agency";
};
// Agency tier from the API value "Agent: Pro" → "Pro"
export const agencyTier = (t) => String(t || "").replace(/^Agent:\s*/i, "").trim();
// old name kept so older files still work
export const agentName = agencyName;
export const initials = (name = "") => name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
export const stripHtml = (h = "") => String(h).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// what a subscription plan includes — reads the live backend fields (max_listings_per_month, max_featured, homepage_banner, …)
export function planFeatures(pl = {}) {
  // Plans that already list every feature as [included, text] (shared/src/core/plans.js planFeatureList).
  if (Array.isArray(pl.features) && pl.features.length && Array.isArray(pl.features[0])) return pl.features;
  // Plans from the API carry their limits and on/off switches; the same list is built from them here.
  if (pl.limits && pl.features && !Array.isArray(pl.features)) return planFeatureList(pl, pl.type);
  const lim = (v) => (Number(v) === -1 ? "Unlimited" : Number(v));
  const out = [];
  const L = pl.max_listings_per_month ?? pl.listings;
  if (L != null && L !== "") out.push([true, `${lim(L)} listings / month`]);
  if (pl.max_featured != null && pl.max_featured !== "") out.push([Number(pl.max_featured) !== 0, Number(pl.max_featured) === 0 ? "No featured listings" : `${lim(pl.max_featured)} featured listings`]);
  if (pl.homepage_banner != null) out.push([!!Number(pl.homepage_banner) || pl.homepage_banner === true, "Homepage banner"]);
  if (pl.verified_badge != null) out.push([!!Number(pl.verified_badge) || pl.verified_badge === true, "Verified badge"]);
  if (pl.priority_support != null) out.push([!!Number(pl.priority_support) || pl.priority_support === true, "Priority support"]);
  (Array.isArray(pl.features) ? pl.features : []).forEach((x) => { if (!out.some(([, t]) => t.toLowerCase() === String(x).toLowerCase())) out.push([true, String(x)]); });
  if (!out.length) out.push([true, "Buyer requests and enquiries"]);
  return out;
}
export const planTier = (pl = {}) => String(pl.role_name || pl.name || "").replace(/^Agent:\s*/i, "");
