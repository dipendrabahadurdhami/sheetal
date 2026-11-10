// Themes (light, dark, red, and colour bars in the panels) for the website and both panels.
// Moved here from shared/src/core/theme.js (task P1-FE-1); that file is now a shim. Nothing else changed.
// How it works: each app keeps its own choice in localStorage; <html data-theme> is set before the first paint by the
// boot script in each index.html. "red" is applied as "dark red" so dark-theme fixes also apply to it.

import { useEffect, useRef } from "react";

/** localStorage key for the app at `path`: /business and /admin each have their own, everything else is the website. */
export const themeKeyFor = (path = "") => (/^\/business(\/|$)/.test(path) ? "sheetal_theme_business" : /^\/admin(\/|$)/.test(path) ? "sheetal_theme_admin" : "sheetal_theme");
export const THEME_KEY = themeKeyFor(typeof location === "undefined" ? "" : location.pathname);
export const THEMES = [
  { id: "light", attr: "light", icon: "sun", meta: "#FFFFFF" },
  { id: "dark", attr: "dark", icon: "moon", meta: "#59595B" },
  { id: "red", attr: "dark red", icon: "droplet", meta: "#9D1D21" },
];

/** /business and /admin only: a dark page with the top bar and sidebar in the colour (Sheetal's crimson, or the
 *  business's own brand colour). Applied as "dark bars" so every dark-mode rule applies to the page. */
export const PANEL_THEMES = [...THEMES, { id: "bars", attr: "dark bars", icon: "panels-top-left", meta: "#9D1D21" }];

export const normaliseTheme = (v) => (PANEL_THEMES.some((t) => t.id === v) ? v : "light");
export const themeAttr = (id) => PANEL_THEMES.find((t) => t.id === normaliseTheme(id)).attr;

export function readTheme() {
  const v = document.documentElement.dataset.theme || "";
  return v.includes("bars") ? "bars" : v.includes("red") ? "red" : v.includes("dark") ? "dark" : "light";
}

export function storedTheme() {
  try { return normaliseTheme(localStorage.getItem(THEME_KEY)); } catch { return readTheme(); }
}

export function applyTheme(id) {
  const t = PANEL_THEMES.find((x) => x.id === normaliseTheme(id));
  const html = document.documentElement;
  if (html.dataset.theme !== t.attr) html.dataset.theme = t.attr;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.meta);
  try { localStorage.setItem(THEME_KEY, t.id); } catch { /* ignore */ }
}

// Calls fn when the theme changes in this tab (any app writes <html data-theme>).
// Each tab keeps its own theme: a change in another tab is not followed. The last choice is
// still saved, so pages opened or reloaded afterwards start with it.
export function onThemeChange(fn) {
  const mo = new MutationObserver(() => fn(readTheme()));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

// For apps that keep the theme in their own state (platform store, website context).
// On mount the page theme wins; after that, state changes are written to the page and page changes are read back.
export function useSharedTheme(theme, setTheme) {
  const cur = useRef(theme);
  cur.current = theme;
  const first = useRef(true);
  useEffect(() => {
    const sync = (v) => { if (v !== cur.current) setTheme(v); };
    sync(readTheme());
    return onThemeChange(sync);
  }, []);
  useEffect(() => {
    if (first.current) { first.current = false; if (readTheme() !== theme) return; }
    applyTheme(theme);
  }, [theme]);
}
