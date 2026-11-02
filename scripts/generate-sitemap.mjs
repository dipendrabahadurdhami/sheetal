// Writes website/frontend/public/sitemap.xml before the website build.
// Always includes the public pages below. With SITEMAP_API set (the live API base URL),
// it also adds every property, blog post and blog category from the API.
//   SITEMAP_API=https://api.sheetalproperty.com node scripts/generate-sitemap.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SITE = (process.env.VITE_SITE_URL || "https://sheetalproperty.com").replace(/\/$/, "");
const API = (process.env.SITEMAP_API || "").replace(/\/$/, "");
const out = fileURLToPath(new URL("../website/frontend/public/sitemap.xml", import.meta.url));

// [path, priority, change frequency]
const PAGES = [
  ["/", "1.0", "daily"], ["/sale", "0.9", "daily"], ["/rent", "0.9", "daily"], ["/search", "0.8", "daily"], ["/map", "0.7", "daily"],
  ["/stays", "0.8", "daily"], ["/project", "0.8", "weekly"], ["/investment", "0.8", "weekly"], ["/featured", "0.7", "daily"],
  ["/partners", "0.7", "weekly"], ["/property-demand", "0.6", "daily"], ["/requirement", "0.6", "monthly"], ["/post-property", "0.6", "monthly"],
  ["/plans", "0.5", "monthly"], ["/blog", "0.8", "daily"], ["/careers", "0.4", "weekly"], ["/gallery", "0.4", "monthly"],
  ["/services", "0.6", "monthly"], ["/services/home-loan", "0.6", "monthly"], ["/services/home-loan/apply", "0.5", "monthly"],
  ["/services/legal-help", "0.5", "monthly"], ["/services/management", "0.5", "monthly"], ["/services/pay-rent", "0.5", "monthly"],
  ["/services/valuation", "0.5", "monthly"], ["/rates-and-trends", "0.6", "weekly"],
  ["/tools/emi", "0.7", "monthly"], ["/tools/roi", "0.7", "monthly"], ["/tools/land-price", "0.7", "monthly"], ["/tools/units", "0.7", "monthly"],
  ["/tools/property-tax", "0.7", "monthly"], ["/tools/rent-vs-buy", "0.7", "monthly"],
  ["/about", "0.4", "yearly"], ["/terms-and-conditions", "0.2", "yearly"], ["/privacy-policy", "0.2", "yearly"], ["/data-deletion", "0.2", "yearly"],
];

async function allPages(path, pick) {
  const found = [];
  for (let page = 1; page <= 500; page++) {
    const r = await fetch(`${API}/${path}${path.includes("?") ? "&" : "?"}page=${page}&per_page=100`);
    if (!r.ok) break;
    const j = await r.json();
    const items = Array.isArray(j) ? j : j.data || [];
    found.push(...items.map(pick).filter(Boolean));
    const last = j.meta?.last_page ?? j.last_page ?? 1;
    if (page >= last || !items.length) break;
  }
  return found;
}

const urls = PAGES.map(([p, priority, changefreq]) => ({ loc: SITE + p, priority, changefreq }));
if (API) {
  try {
    const props = await allPages("all-properties", (p) => (p.url ? { loc: `${SITE}/property/${p.url}`, lastmod: (p.updated_at || "").slice(0, 10), priority: "0.8", changefreq: "weekly" } : null));
    const posts = await allPages("blog", (b) => (b.slug ? { loc: `${SITE}/blog/${b.slug}`, lastmod: (b.updated_at || "").slice(0, 10), priority: "0.6", changefreq: "monthly" } : null));
    const cats = await fetch(`${API}/blog/categories`).then((r) => r.json()).then((j) => (j.data || j).map((c) => ({ loc: `${SITE}/blog/category/${c.slug}`, priority: "0.5", changefreq: "weekly" }))).catch(() => []);
    urls.push(...props, ...posts, ...cats);
  } catch (e) {
    console.warn("Sitemap: could not reach the API, writing public pages only.", e.message);
  }
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) =>
  `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join("\n")}\n</urlset>\n`;
writeFileSync(out, xml);
console.log(`Sitemap: ${urls.length} URLs → website/frontend/public/sitemap.xml`);
