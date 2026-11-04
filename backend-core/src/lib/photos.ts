// Listing, blog and logo photos.
// Where it fits: uploads from the business panel, the website and the admin panel; photoUrl() builds their addresses.
// How it works: only real JPEG, PNG or WebP files are kept (checked by their first bytes), under a random name, in
// MEDIA_DIR/<area>/{main,thumbnail}. The thumbnail is the same file until resizing and object storage arrive.

import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError, badRequest } from "./errors.js";

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const KINDS: [string, (b: Buffer) => boolean][] = [
  ["jpg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
];

export const photoKind = (b: Buffer) => KINDS.find(([, test]) => b.length > 12 && test(b))?.[0] ?? null;

/** `area` is the folder under MEDIA_DIR: property (listings), blog, or brand (business logos). */
export async function savePhoto(mediaDir: string | undefined, data: Buffer, area: "property" | "blog" | "brand" = "property"): Promise<string> {
  if (!mediaDir) throw new AppError(503, "storage_off", "Photo uploads aren't set up on this server yet.");
  if (data.length > MAX_PHOTO_BYTES) throw badRequest("Each photo can be up to 8 MB.");
  const ext = photoKind(data);
  if (!ext) throw badRequest("Photos must be JPG, PNG or WebP images.");
  const name = `${randomBytes(12).toString("base64url")}.${ext}`;
  for (const size of ["main", "thumbnail"]) {
    const dir = join(mediaDir, area, size);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), data);
  }
  return name;
}

/** Where photos are served from: MEDIA_URL, or the API's own /media. */
export function mediaBase(config: { MEDIA_URL?: string; API_URL: string }) {
  return (config.MEDIA_URL ?? `${config.API_URL.replace(/\/$/, "")}/media`).replace(/\/$/, "");
}

export const photoUrl = (base: string, size: "main" | "thumbnail", file: string, area: "property" | "blog" | "brand" = "property") => `${base}/${area}/${size}/${encodeURIComponent(file)}`;

/** A name savePhoto gave out (random, with an image extension), so listings can only point at uploaded photos. */
export const isPhotoName = (s: string) => /^[A-Za-z0-9_-]{16}\.(jpg|png|webp)$/.test(s);
