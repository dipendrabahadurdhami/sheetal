// Private files people send: payment proofs, CVs, business verification documents and expense receipts.
// Where it fits: saved by the website and business APIs; opened by staff through the admin API, or by the business's
// own settings people for verification documents.
// How it works: kept in MEDIA_DIR/private/<kind>, which is never served publicly; checked by their first bytes and
// saved under a random name.
// Rules: never link to these files directly; always stream them through an endpoint that checks who is asking.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError, badRequest } from "./errors.js";
import { photoKind } from "./photos.js";

export type PrivateKind = "proofs" | "cv" | "kyc" | "expenses";
const MAX = { proofs: 8 * 1024 * 1024, cv: 5 * 1024 * 1024, kyc: 10 * 1024 * 1024, expenses: 8 * 1024 * 1024 };

const docKind = (b: Buffer) => {
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  // .docx is a zip file; old .doc files start with the OLE header.
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "docx";
  if (b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "doc";
  return null;
};

export const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function savePrivateFile(mediaDir: string | undefined, kind: PrivateKind, data: Buffer): Promise<string> {
  if (!mediaDir) throw new AppError(503, "storage_off", "File uploads aren't set up on this server yet.");
  if (data.length > MAX[kind]) throw badRequest(`Files can be up to ${MAX[kind] / 1024 / 1024} MB.`);
  const doc = docKind(data);
  // CVs may be Word files; verification documents a PDF or a photo; payment proofs a photo.
  const ext = photoKind(data) ?? (kind === "cv" ? doc : (kind === "kyc" || kind === "expenses") && doc === "pdf" ? "pdf" : null);
  if (!ext) throw badRequest(kind === "cv" ? "Send your CV as a PDF, Word file or photo." : kind === "kyc" ? "Send the document as a PDF or a photo (JPG, PNG or WebP)." : kind === "expenses" ? "Send the receipt as a PDF or a photo (JPG, PNG or WebP)." : "Send a JPG, PNG or WebP picture of the payment.");
  const name = `${randomBytes(12).toString("base64url")}.${ext}`;
  const dir = join(mediaDir, "private", kind);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), data);
  return name;
}

/** A private file for staff: its bytes and content type, or null if the name isn't one we gave out. */
export async function readPrivateFile(mediaDir: string | undefined, kind: PrivateKind, name: string) {
  if (!mediaDir || !/^[A-Za-z0-9_-]{16}\.(jpg|png|webp|pdf|docx?)$/.test(name)) return null;
  try {
    return { data: await readFile(join(mediaDir, "private", kind, name)), type: CONTENT_TYPES[name.split(".").pop()!]! };
  } catch {
    return null;
  }
}
