import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError, badRequest } from "@sheetal/backend-core/lib/errors";

// Photos people upload with a listing. Only real JPEG, PNG or WebP images are kept (checked by their first bytes,
// not by the name the browser gives), under a random name, in MEDIA_DIR/property/{main,thumbnail}.
// The thumbnail is the same file for now; resizing comes with object storage.

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const KINDS: [string, (b: Buffer) => boolean][] = [
  ["jpg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
];

export const photoKind = (b: Buffer) => KINDS.find(([, test]) => b.length > 12 && test(b))?.[0] ?? null;

export async function savePhoto(mediaDir: string | undefined, data: Buffer): Promise<string> {
  if (!mediaDir) throw new AppError(503, "storage_off", "Photo uploads aren't set up on this server yet.");
  if (data.length > MAX_PHOTO_BYTES) throw badRequest("Each photo can be up to 8 MB.");
  const ext = photoKind(data);
  if (!ext) throw badRequest("Photos must be JPG, PNG or WebP images.");
  const name = `${randomBytes(12).toString("base64url")}.${ext}`;
  for (const size of ["main", "thumbnail"]) {
    const dir = join(mediaDir, "property", size);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), data);
  }
  return name;
}
