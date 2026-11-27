// Sign-in and sign-up from inside the business panel (no trip to the website): the same Sheetal account, through the website API.
// Where it fits: BusinessStart.jsx (the signed-out page: plans first, then sign in or create an account, then the emailed code).
// How it works: the website API's address is VITE_SITE_API_URL, or worked out from the business API's (api-business. → api., :4001 → :4000).
// Guarded forms (login, register, forgot-password) carry the robot-check token like the website's forms. A finished sign-in saves the
// token under "sheetal_token", the key the website and the panels share, so one sign-in covers all of them.

import { needsRobot, robotToken } from "@sheetal/shared/core/robot";

const BIZ = (import.meta.env.VITE_BUSINESS_API_URL || "").replace(/\/+$/, "");
export const SITE_API = (import.meta.env.VITE_SITE_API_URL || BIZ.replace("//api-business.", "//api.").replace(":4001", ":4000")).replace(/\/+$/, "");

export async function siteCall(method, path, body) {
  if (!SITE_API) throw new Error("The website API isn't connected.");
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (needsRobot(method, path)) {
    const t = await robotToken(SITE_API);
    if (t) headers["x-captcha"] = t;
  }
  let res;
  try { res = await fetch(`${SITE_API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new Error("Can't reach the server. Check your connection and try again."); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json?.message || "Something went wrong.");
    e.status = res.status; e.errors = json?.errors; e.code = json?.code;
    throw e;
  }
  return json;
}

/** Saves the sign-in from an answer carrying the token. */
export function keepSignIn(res) {
  const token = res?.data?.token || res?.token;
  if (!token) throw new Error(res?.message || "Sign-in failed.");
  try { localStorage.setItem("sheetal_token", token); } catch { /* storage off */ }
  return token;
}

/** The plan picked before signing in, opened on the Plans page right after (Plans.jsx reads and clears it). */
export const PICK_KEY = "sheetal_pick_pack";
export const savePick = (packId, months) => { try { sessionStorage.setItem(PICK_KEY, JSON.stringify({ packId, months })); } catch { /* storage off */ } };
export const takePick = () => {
  try { const v = JSON.parse(sessionStorage.getItem(PICK_KEY) || "null"); sessionStorage.removeItem(PICK_KEY); return v; } catch { return null; }
};
