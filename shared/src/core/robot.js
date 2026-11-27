// The robot check (Cloudflare Turnstile) for public forms on the website and the business panel's sign-in, done by the API client (website api/client.js, business siteAuth.js).
// How it works: GET /site says the public site key (null = the check is off: nothing loads, nothing changes). When a guarded form is sent,
// Turnstile runs out of sight and hands a one-time token, sent in the "x-captcha" header. Most people never see anything; when Cloudflare
// wants a person to confirm, a small box appears at the bottom of the screen with one tick.
// Rules: the same routes as the API's list (website/backend/src/modules/robot/hook.ts); a token is used once; never blocks reading pages.

const TURNSTILE = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** The form routes the API checks (POST). Keep in step with ROBOT_ROUTES on the API. */
const GUARDED = [
  /^\/(auth\/)?(login|register|forgot-password)$/,
  /^\/(contact-agent|contact-owner|schedule-tour|requirement-form|agent-requirement-form|contact|demo-request)$/,
  /^\/reviews$/, /^\/blog\/[^/]+\/comment$/, /^\/jobs\/[^/]+\/apply$/, /^\/post-property$/, /^\/start-free$/, /^\/rent\/pay$/,
];
export const needsRobot = (method, url) => String(method).toUpperCase() === "POST" && GUARDED.some((r) => r.test(url.split("?")[0]));

let keyPromise = null;
/** The public site key while the check is on, else null (asked once per visit). */
function siteKey(apiBase) {
  keyPromise ??= fetch(`${apiBase}/site`, { credentials: "include" }).then((r) => r.json()).then((j) => j?.data?.captcha || null).catch(() => { keyPromise = null; return null; });
  return keyPromise;
}

export function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((ok, fail) => {
    let s = document.querySelector(`script[src="${TURNSTILE}"]`);
    if (!s) { s = document.createElement("script"); s.src = TURNSTILE; s.async = true; document.head.appendChild(s); }
    s.addEventListener("load", () => ok(window.turnstile));
    s.addEventListener("error", () => fail(new Error("The robot check didn't load. Check your internet and try again.")));
  });
}

/** A fresh token for one form, or null when the check is off. */
export async function robotToken(apiBase) {
  const key = await siteKey(apiBase);
  if (!key) return null;
  const ts = await loadTurnstile();
  return new Promise((ok, fail) => {
    const box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Robot check");
    Object.assign(box.style, { position: "fixed", left: "50%", bottom: "16px", transform: "translateX(-50%)", zIndex: 2147483000, display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" });
    document.body.appendChild(box);
    let id = null;
    const done = (fn, v) => { clearTimeout(timer); try { if (id != null) ts.remove(id); } catch { /* gone */ } box.remove(); fn(v); };
    const timer = setTimeout(() => done(fail, new Error("The robot check took too long. Please try again.")), 120_000);
    id = ts.render(box, {
      sitekey: key, appearance: "interaction-only",
      // Shown only when Cloudflare asks a person to tick: a white card so the box is easy to see on any page.
      "before-interactive-callback": () => Object.assign(box.style, { background: "#fff", padding: "12px", borderRadius: "10px", boxShadow: "0 8px 30px rgba(0,0,0,.18)" }),
      callback: (t) => done(ok, t),
      "error-callback": () => done(fail, new Error("The robot check didn't pass. Please try again.")),
    });
  });
}
