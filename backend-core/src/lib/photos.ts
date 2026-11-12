// Listing, blog and logo photos.
// Where it fits: every upload (business panel, website posts, admin blog, business logos and payment QRs) goes
// through savePhoto(); photoUrl() builds their addresses; scripts/resize-photos.ts brings older photos to the same
// sizes (`npm run photos:resize`).
// How it works: only real JPEG, PNG or WebP images are kept (checked by their first bytes, then opened). Each upload
// is turned upright (phone camera rotation), cleaned of hidden data (GPS position, camera details), converted to sRGB
// and saved as WebP in two sizes, never enlarged:
//   main       up to 1920 px on the long side, quality 82: the photo page and the gallery
//   thumbnail  up to 800 px on the long side, quality 80, lightly sharpened: cards and lists, crisp on phone screens
// The upload itself is kept untouched in original/ under the same name (never served), so the sizes can be made
// again later without losing quality. With S3_BUCKET set, both sizes are also put in object storage (storage.ts).
// Rules: names are random; logos keep their transparency (WebP has it); change SIZES only together with a
// `npm run photos:resize -- --force` so old photos follow.

import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Metadata } from "sharp";
import { AppError, badRequest } from "@sheetal/platform/core/errors";
import { putObject } from "@sheetal/platform/files/storage";

/** Phones make photos of 5 to 15 MB; they are made much smaller here, so a big upload is fine. */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export type PhotoArea = "property" | "blog" | "brand";
export type PhotoFormat = "webp" | "jpeg" | "png";

export const SIZES = {
  main: { max: 1920, quality: 82 },
  thumbnail: { max: 800, quality: 80 },
} as const;
export type PhotoSize = keyof typeof SIZES;

const KINDS: [string, (b: Buffer) => boolean][] = [
  ["jpg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
];

export const photoKind = (b: Buffer) => KINDS.find(([, test]) => b.length > 12 && test(b))?.[0] ?? null;

/** The file format a stored name stands for (old imported photos keep .jpg/.png; new ones are .webp). */
export const formatOf = (file: string): PhotoFormat => (/\.webp$/i.test(file) ? "webp" : /\.png$/i.test(file) ? "png" : "jpeg");
export const contentTypeOf = (file: string) => `image/${formatOf(file)}`;

/** The longest side of a photo as people see it. */
export const longSide = (m: Pick<Metadata, "width" | "height">) => Math.max(m.width ?? 0, m.height ?? 0);

/** One size of a photo. `strict` refuses damaged files (uploads); the resize script lets slightly damaged old ones through. */
export async function renderSize(input: Buffer, size: PhotoSize, format: PhotoFormat, meta: Pick<Metadata, "width" | "height">, _strict = true): Promise<Buffer> {
  const s = SIZES[size];
  const shrinks = longSide(meta) > s.max;
  let img = sharp(input, { failOn: "none", limitInputPixels: 120_000_000 })
    .rotate()
    .resize({ width: s.max, height: s.max, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" });
  // Shrinking softens a photo a little; a light sharpen brings back the detail people expect in a small picture.
  if (size === "thumbnail" && shrinks) img = img.sharpen({ sigma: 0.6 });
  if (format === "webp") return img.webp({ quality: s.quality, effort: 5, smartSubsample: true }).toBuffer();
  if (format === "jpeg") return img.jpeg({ quality: s.quality, mozjpeg: true, progressive: true }).toBuffer();
  return img.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}

/** Writes through a temporary file, so a stopped server or script never leaves half a photo. */
export async function writeAtomic(path: string, data: Buffer) {
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

const folder = async (mediaDir: string, area: PhotoArea, size: string) => {
  const dir = join(mediaDir, area, size);
  await mkdir(dir, { recursive: true });
  return dir;
};

/** `area` is the folder under MEDIA_DIR: property (listings), blog, or brand (business logos and QR codes). */
export async function savePhoto(mediaDir: string | undefined, data: Buffer, area: PhotoArea = "property"): Promise<string> {
  if (!mediaDir) throw new AppError(503, "storage_off", "Photo uploads aren't set up on this server yet.");
  if (data.length > MAX_PHOTO_BYTES) throw badRequest("Each photo can be up to 20 MB.");
  if (!photoKind(data)) throw badRequest("Photos must be JPG, PNG or WebP images.");
  const unreadable = () => badRequest("This photo can't be opened. Save it again as JPG and try once more.");
  const meta = await sharp(data, { failOn: "none" }).metadata().catch(() => null);
  if (!meta?.width || !meta.height) throw unreadable();
  const name = `${randomBytes(12).toString("base64url")}.webp`;
  let main: Buffer, thumbnail: Buffer;
  try {
    [main, thumbnail] = await Promise.all([renderSize(data, "main", "webp", meta), renderSize(data, "thumbnail", "webp", meta)]);
  } catch {
    throw unreadable();
  }
  await writeAtomic(join(await folder(mediaDir, area, "original"), name), data);
  await writeAtomic(join(await folder(mediaDir, area, "main"), name), main);
  await writeAtomic(join(await folder(mediaDir, area, "thumbnail"), name), thumbnail);
  await putObject(`${area}/main/${name}`, main, "image/webp");
  await putObject(`${area}/thumbnail/${name}`, thumbnail, "image/webp");
  return name;
}

/** Where photos are served from: MEDIA_URL (object storage or a CDN), or the API's own /media. */
export function mediaBase(config: { MEDIA_URL?: string; API_URL: string }) {
  return (config.MEDIA_URL ?? `${config.API_URL.replace(/\/$/, "")}/media`).replace(/\/$/, "");
}

export const photoUrl = (base: string, size: "main" | "thumbnail", file: string, area: PhotoArea = "property") => `${base}/${area}/${size}/${encodeURIComponent(file)}`;

/** A name savePhoto gave out (random, with an image extension), so listings can only point at uploaded photos. */
export const isPhotoName = (s: string) => /^[A-Za-z0-9_-]{16}\.(jpg|png|webp)$/.test(s);
