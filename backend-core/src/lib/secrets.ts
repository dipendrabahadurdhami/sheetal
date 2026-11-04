// Password hashing and one-time tokens.
// Where it fits: sign-up, sign-in, sessions, email and invitation links.
// How it works: passwords use Argon2id (salted, memory-hard); a random token goes to the person and only its SHA-256
// is stored.
// Rules: never store or log a password or token in plain text; a copy of the database can't be used to sign in.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// Passwords: Argon2id with library defaults (memory-hard, salted). Never stored or logged in plain text.
export const hashPassword = (password: string) => hash(password);
export async function checkPassword(storedHash: string | null | undefined, password: string): Promise<boolean> {
  if (!storedHash) return false;
  try { return await verify(storedHash, password); } catch { return false; }
}

// Login sessions and email links: a random token goes to the person; only its SHA-256 is stored,
// so a database leak can't be used to log in or reset passwords.
export const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
