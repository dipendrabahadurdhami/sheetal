// The support-session token in the browser (ACCESS.md section 12): how a Sheetal staff member's "Open as support" reaches the business panel.
// Where it fits: the admin panel builds a link with supportLink(token) after POST /admin/businesses/:id/impersonate; the business panel calls
// takeSupportTokenFromUrl() once when it starts; client.js sends supportToken() instead of the person's own sign-in while it is set.
// How it works: the token travels in the address FRAGMENT (#support=…), which browsers never send to a server or write to its logs. The panel moves it into
// sessionStorage (this tab only, gone when the tab closes) and removes it from the address bar at once. The person's own sign-in (localStorage) is untouched,
// so their other tabs keep working as themselves.
// Rules: never put the token in a query string, in localStorage, or in a log. A support token only works on the business of its session, for at most 30 minutes,
// and the server refuses it after "End session".

const KEY = "sheetal_support_token";
const PREFIX = "sup1.";

const store = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };

/** The support token of this tab, or null. */
export function supportToken() {
  try { const t = store()?.getItem(KEY); return t && t.startsWith(PREFIX) ? t : null; } catch { return null; }
}

export function setSupportToken(token) {
  try { if (token && token.startsWith(PREFIX)) store()?.setItem(KEY, token); } catch { /* storage off: the session just does not start */ }
}

export function clearSupportToken() {
  try { store()?.removeItem(KEY); } catch { /* storage off */ }
}

/** "#support=sup1.abc" (or "#a=1&support=…") -> the token, or null. Only tokens that look like a support token are taken. */
export function supportTokenFromHash(hash) {
  const m = /(?:^#|&)support=([^&]+)/.exec(hash || "");
  if (!m) return null;
  let t;
  try { t = decodeURIComponent(m[1]); } catch { return null; }
  return t.startsWith(PREFIX) && t.length < 600 ? t : null;
}

/** Run once when the business panel starts: keeps a token found in the address fragment and cleans the address bar. Returns true when one was taken. */
export function takeSupportTokenFromUrl(win = globalThis.window) {
  if (!win?.location) return false;
  const t = supportTokenFromHash(win.location.hash);
  if (!t) return false;
  setSupportToken(t);
  try { win.history?.replaceState(null, "", win.location.pathname + win.location.search); } catch { /* old browser: the fragment stays, harmless */ }
  return true;
}

/** The address the admin panel opens: the business panel with the token in the fragment. */
export const supportLink = (token, base = "/business") => `${base}#support=${encodeURIComponent(token)}`;
