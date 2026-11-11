// The token of a support session ("log in as a business", ACCESS.md section 12): signed, short, and separate from a staff sign-in.
// Where it fits: the admin API gives it to the staff member when a session starts (support/sessions.ts); the business API reads it from
// `Authorization: Bearer sup1.<sessionId>.<signature>` (support/hooks.ts).
// How it works: the token carries ONLY the session id and an HMAC-SHA256 signature made with a key derived from SECRETS_KEY (the same secret both APIs already
// share), so nothing needs storing to check it. The session row (ImpersonationSession) decides everything else: not ended, not expired, the staff member
// still active. A token is useless once its row ended or ran out.
// Rules: never log a token. The prefix keeps it apart from a normal sign-in token, which has no dots. Without SECRETS_KEY (development and tests only: production
// refuses to start without it) a fixed development key is used, the same way vault.ts does.

import { createHmac, createHash } from "node:crypto";
import { safeEqual } from "./secrets.js";

export const SUPPORT_PREFIX = "sup1.";
const DEV_KEY = "sheetal-local-development-only-key";

const keyOf = (secret: string | undefined): Buffer => createHash("sha256").update(`support-session:${secret || DEV_KEY}`).digest();
const sign = (secret: string | undefined, sessionId: string) => createHmac("sha256", keyOf(secret)).update(sessionId).digest("base64url");

export const isSupportToken = (token: string): boolean => token.startsWith(SUPPORT_PREFIX);

export function signSupportToken(secret: string | undefined, sessionId: string): string {
  return `${SUPPORT_PREFIX}${sessionId}.${sign(secret, sessionId)}`;
}

/** The session id inside a token, or null when it is not a support token or its signature is wrong. */
export function readSupportToken(secret: string | undefined, token: string): string | null {
  if (!isSupportToken(token)) return null;
  const rest = token.slice(SUPPORT_PREFIX.length);
  const dot = rest.lastIndexOf(".");
  if (dot < 1) return null;
  const sessionId = rest.slice(0, dot);
  const signature = rest.slice(dot + 1);
  return /^[A-Za-z0-9_-]{8,40}$/.test(sessionId) && safeEqual(signature, sign(secret, sessionId)) ? sessionId : null;
}
