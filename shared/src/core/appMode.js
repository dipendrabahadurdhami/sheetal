// App mode: tells the screens when they run as an installed app (home-screen web app, the Android app or the Windows app) instead of a
// browser tab, and switches on the offline service worker.
// How it works: the Android and Windows apps add "SheetalApp/<platform>" to the browser's user agent; an installed web app reports the
// "standalone" display mode. <html data-app="android|windows|installed"> is set once at start, so CSS can hide website-only parts (the footer,
// "get the app" prompts) with [data-app]. The service worker (/sw.js) is registered on the live site only (never in development).

export function appPlatform() {
  if (typeof window === "undefined") return null;
  const ua = navigator.userAgent || "";
  const m = ua.match(/SheetalApp\/(android|windows|ios)/i);
  if (m) return m[1].toLowerCase();
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
  return standalone ? "installed" : null;
}

export const isApp = () => !!appPlatform();

/** Call once at start: marks <html> and registers the service worker (live site only). */
export function startAppMode({ production }) {
  const p = appPlatform();
  if (p) document.documentElement.setAttribute("data-app", p);
  if (production && "serviceWorker" in navigator) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {}); });
  }
}
