// SEO and analytics: page titles and descriptions, structured data for Google, and visit tracking.
// Rules: SITE_URL is the public address Google knows the site by.

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/endpoints";

const SITE = "Sheetal Property";
// Public address Google knows the site by (the old site ranks under this domain).
export const SITE_URL = (import.meta.env.VITE_SITE_URL || "https://sheetalproperty.com").replace(/\/$/, "");
const DEFAULT_IMAGE = `${SITE_URL}/brand/logo-full.png`;
const DEFAULT_DESC = "Houses, land, flats and rentals across Nepal with local agencies.";

const setMeta = (attr, key, content) => {
  let m = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!m) { m = document.createElement("meta"); m.setAttribute(attr, key); document.head.appendChild(m); }
  m.setAttribute("content", content);
};
const setLink = (rel, href) => {
  let l = document.head.querySelector(`link[rel="${rel}"]`);
  if (!l) { l = document.createElement("link"); l.rel = rel; document.head.appendChild(l); }
  l.href = href;
};

// Page title, description, canonical URL, social cards, robots and optional JSON-LD for the current page.
// opts: { image, type, noindex, jsonLd }
export function useSEO(title, description, opts = {}) {
  const { pathname } = useLocation();
  const { image = DEFAULT_IMAGE, type = "website", noindex = false, jsonLd = null } = opts;
  const ld = jsonLd ? JSON.stringify(jsonLd) : "";
  useEffect(() => {
    const full = title ? `${title} | ${SITE}` : `${SITE} — Homes, Land & Rentals in Nepal`;
    const desc = description || DEFAULT_DESC;
    const url = SITE_URL + pathname;
    document.title = full;
    setMeta("name", "description", desc);
    setMeta("name", "robots", noindex ? "noindex, nofollow" : "index, follow");
    setLink("canonical", url);
    setMeta("property", "og:title", full);
    setMeta("property", "og:description", desc);
    setMeta("property", "og:url", url);
    setMeta("property", "og:type", type);
    setMeta("property", "og:image", image);
    setMeta("name", "twitter:card", "summary_large_image");
    let s = document.getElementById("page-jsonld");
    if (ld) {
      if (!s) { s = document.createElement("script"); s.type = "application/ld+json"; s.id = "page-jsonld"; document.head.appendChild(s); }
      s.textContent = ld;
    } else if (s) s.remove();
  }, [title, description, pathname, image, type, noindex, ld]);
}

const sessionId = () => {
  let id = localStorage.getItem("sp_session_id");
  if (!id) { id = "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem("sp_session_id", id); }
  return id;
};

const pageInfo = (path) => {
  if (path === "/") return { page_type: "home" };
  const p = path.match(/^\/property\/(\d+)/);
  if (p) return { page_type: "property", entity_id: Number(p[1]) };
  if (/^\/blog\/(?!category\/)/.test(path)) return { page_type: "blog" };
  return { page_type: "page" };
};

export const trackView = (path, title = null) => {
  const { page_type, entity_id } = pageInfo(path);
  api.trackVisit({ session_id: sessionId(), page_url: path, page_type, entity_id: entity_id || null, entity_title: title, referrer: document.referrer || null }).catch(() => {});
};

// Adds the Search Console verification tag and site name from the public site settings (GET /site).
export function applySiteSettings(site) {
  if (site?.searchConsoleToken) setMeta("name", "google-site-verification", site.searchConsoleToken);
  if (site?.siteName) setMeta("property", "og:site_name", site.siteName);
}

// Visit tracking (same as the current site's admin dashboard) + optional Google Analytics 4. The id comes from
// Admin → Setup center → Google (gaId); VITE_GA_ID still works as a fallback.
export function Analytics({ gaId }) {
  const { pathname, search } = useLocation();
  useEffect(() => {
    const ping = () => api.heartbeat(sessionId()).catch(() => {});
    ping();
    const t = setInterval(ping, 20000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const ga = gaId || import.meta.env.VITE_GA_ID;
    if (ga && !window.gtag) {
      const s = document.createElement("script");
      s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${ga}`;
      document.head.appendChild(s);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", ga, { send_page_view: false });
    }
  }, [gaId]);
  useEffect(() => {
    trackView(pathname);
    if (window.gtag) window.gtag("event", "page_view", { page_path: pathname + search });
  }, [pathname, search]);
  return null;
}
