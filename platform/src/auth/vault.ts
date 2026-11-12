// Encryption for secrets kept in the database (service keys, channel tokens, email signing keys).
// (Moved here from backend-core/src/lib/vault.ts in P1-BE-1; the old file only re-exports this one.)
// Where it fits: used wherever a key is saved or read (payments, AI, Meta, email domains).
// How it works: AES-256-GCM with the key from SECRETS_KEY; stored as "v1:<iv>:<tag>:<ciphertext>" (base64url).
// Rules: SECRETS_KEY never goes in the database or git; without it a copy of the database can't read any secret.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const DEV_KEY = "sheetal-local-development-only-key"; // used only outside production when SECRETS_KEY is unset

export class Vault {
  private readonly key: Buffer;
  constructor(secret: string | undefined, production: boolean) {
    if (!secret && production) throw new Error("SECRETS_KEY is required in production");
    this.key = createHash("sha256").update(secret || DEV_KEY).digest();
  }

  /**
   * Seals a value. With `aad` (the place the value belongs to, e.g. "<connectionId>:<mode>:<field>") it is written as "v2:…" and can only be opened with the
   * same `aad`, so a sealed value copied into another row (a test key into a live row) does not open. Without `aad` it is "v1:…" as before.
   */
  seal(plain: string, aad?: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    if (aad !== undefined) c.setAAD(Buffer.from(aad, "utf8"));
    const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return [aad !== undefined ? "v2" : "v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
  }

  /** Opens "v1" values (no binding; `aad` is ignored, so every old value keeps working) and "v2" values (the same `aad` must be given, or it throws). */
  open(sealed: string, aad?: string): string {
    const [v, iv, tag, data] = sealed.split(":");
    if ((v !== "v1" && v !== "v2") || !iv || !tag || !data) throw new Error("Not a sealed value");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    if (v === "v2") {
      if (aad === undefined) throw new Error("This sealed value is bound to a place; say which one");
      d.setAAD(Buffer.from(aad, "utf8"));
    }
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  }
}
