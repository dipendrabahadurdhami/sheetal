// Robot check on public forms (Cloudflare Turnstile, free).
// Where it fits: the website API checks it on online-form responses; staff save the keys in Admin → Setup.
// How it works: the "captcha" app setting holds the site key (public) and the secret key (sealed with SECRETS_KEY).
// With no keys saved the check is off and forms rely on the rate limit and the hidden spam field. With keys, the form
// page shows the box and the API asks Cloudflare whether the token is good.
// Rules: the secret is write-only; when Cloudflare can't be reached the response is refused (asked to try again).

import type { Db } from "./db.js";
import type { Fetch } from "./payments.js";
import { Vault } from "./vault.js";
import { badRequest } from "./errors.js";

export interface CaptchaSettings { siteKey?: string; secret?: string }
export const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function captchaSettings(db: Db): Promise<CaptchaSettings> {
  return ((await db.appSetting.findUnique({ where: { key: "captcha" } }))?.value ?? {}) as CaptchaSettings;
}

/** The public site key when the check is on, else null. */
export async function captchaSiteKey(db: Db) {
  const s = await captchaSettings(db);
  return s.siteKey && s.secret ? s.siteKey : null;
}

/** Throws a 400 unless the token passes (or the check is off). */
export async function checkCaptcha(opts: { db: Db; vault: Vault; token?: string | null; ip?: string; fetch?: Fetch }) {
  const s = await captchaSettings(opts.db);
  if (!s.siteKey || !s.secret) return;
  if (!opts.token) throw badRequest("Please tick the box to show you're not a robot.", { captcha: ["Tick the box."] });
  const body = new URLSearchParams({ secret: opts.vault.open(s.secret), response: opts.token.slice(0, 2048), ...(opts.ip ? { remoteip: opts.ip } : {}) });
  let ok = false;
  try {
    const res = await (opts.fetch ?? fetch)(VERIFY_URL, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
    ok = !!((await res.json()) as { success?: boolean }).success;
  } catch {
    throw badRequest("We couldn't check the robot box just now. Please try again in a minute.");
  }
  if (!ok) throw badRequest("The robot check didn't pass. Please tick the box again.", { captcha: ["Tick the box again."] });
}
