import { useEffect, useRef } from "react";

// One theme system for the website, /admin and /business.
// Source of truth: <html data-theme> + localStorage "sheetal_theme". The boot script in each index.html sets it before first paint.
// "red" is applied as "dark red" so every dark-mode fix (white logo, maps, photo strength) also applies to the red theme.
export const THEME_KEY = "sheetal_theme";
export const THEMES = [
  { id: "light", attr: "light", icon: "sun", meta: "#FFFFFF" },
  { id: "dark", attr: "dark", icon: "moon", meta: "#59595B" },
  { id: "red", attr: "dark red", icon: "droplet", meta: "#9D1D21" },
];

export const normaliseTheme = (v) => (THEMES.some((t) => t.id === v) ? v : "light");
export const themeAttr = (id) => THEMES.find((t) => t.id === normaliseTheme(id)).attr;

export function readTheme() {
  const v = document.documentElement.dataset.theme || "";
  return v.includes("red") ? "red" : v.includes("dark") ? "dark" : "light";
}

export function storedTheme() {
  try { return normaliseTheme(localStorage.getItem(THEME_KEY)); } catch { return readTheme(); }
}

export function applyTheme(id) {
  const t = THEMES.find((x) => x.id === normaliseTheme(id));
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
