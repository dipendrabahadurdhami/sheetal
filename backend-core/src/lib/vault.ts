import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Encrypts secrets kept in the database (domain signing keys, service keys) with AES-256-GCM.
// The key comes from SECRETS_KEY; it never goes in the database, so a stolen database copy can't read them.
// Stored form: "v1:<iv>:<tag>:<ciphertext>" (base64url).

const DEV_KEY = "sheetal-local-development-only-key"; // used only outside production when SECRETS_KEY is unset

export class Vault {
  private readonly key: Buffer;
  constructor(secret: string | undefined, production: boolean) {
    if (!secret && production) throw new Error("SECRETS_KEY is required in production");
    this.key = createHash("sha256").update(secret || DEV_KEY).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
  }

  open(sealed: string): string {
    const [v, iv, tag, data] = sealed.split(":");
    if (v !== "v1" || !iv || !tag || !data) throw new Error("Not a sealed value");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  }
}
