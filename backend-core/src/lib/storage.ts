// Object storage for photos (any S3-compatible bucket: Cloudflare R2, Backblaze B2, AWS S3, MinIO).
// Where it fits: savePhoto() and scripts/resize-photos.ts call putObject() after writing a size to MEDIA_DIR.
// How it works: configureStorage() runs once when an API starts (backend-core/src/app.ts). Without S3_BUCKET and
// both keys it does nothing, so photos stay on the server's disk and the API serves them at /media. With them, every
// size is also uploaded with a one-year cache header; point MEDIA_URL at the bucket's public address to serve from it.
// Rules: the S3 library is loaded only when storage is switched on; originals are never uploaded (they stay private).

import type { Config } from "../config.js";

type StorageConfig = Pick<Config, "S3_BUCKET" | "S3_ENDPOINT" | "S3_REGION" | "S3_ACCESS_KEY_ID" | "S3_SECRET_ACCESS_KEY">;
interface Client { send: (command: unknown) => Promise<unknown> }

let settings: StorageConfig | null = null;
let client: Promise<{ client: Client; Put: new (input: object) => unknown }> | null = null;

export function configureStorage(c: StorageConfig) {
  settings = c.S3_BUCKET && c.S3_ACCESS_KEY_ID && c.S3_SECRET_ACCESS_KEY ? c : null;
  client = null;
}

/** True when photos are also put in object storage. */
export const storageOn = () => !!settings;

async function connect() {
  const s = settings!;
  const sdk = await import("@aws-sdk/client-s3");
  const c = new sdk.S3Client({
    region: s.S3_REGION, endpoint: s.S3_ENDPOINT, forcePathStyle: !!s.S3_ENDPOINT,
    credentials: { accessKeyId: s.S3_ACCESS_KEY_ID!, secretAccessKey: s.S3_SECRET_ACCESS_KEY! },
  });
  return { client: c as unknown as Client, Put: sdk.PutObjectCommand as unknown as new (input: object) => unknown };
}

/** Uploads one file (key like "property/main/abc.webp"); does nothing while storage is off. */
export async function putObject(key: string, body: Buffer, contentType: string) {
  if (!settings) return;
  client ??= connect();
  const { client: c, Put } = await client;
  await c.send(new Put({ Bucket: settings.S3_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
}
