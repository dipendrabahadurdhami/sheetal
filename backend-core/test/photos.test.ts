import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { SIZES, formatOf, isPhotoName, renderSize, savePhoto } from "../src/lib/photos.js";

const media = mkdtempSync(join(tmpdir(), "sheetal-photos-"));
afterAll(() => rmSync(media, { recursive: true, force: true }));

const photo = (width: number, height: number, format: "jpeg" | "png" = "jpeg") =>
  sharp({ create: { width, height, channels: 3, background: { r: 180, g: 120, b: 60 } } }).toFormat(format).toBuffer();

describe("photos", () => {
  it("keeps the upload and makes a main and a thumbnail size, never bigger than set", async () => {
    const name = await savePhoto(media, await photo(4000, 3000), "property");
    expect(isPhotoName(name)).toBe(true);
    expect(name.endsWith(".webp")).toBe(true);
    const main = await sharp(readFileSync(join(media, "property", "main", name))).metadata();
    const thumb = await sharp(readFileSync(join(media, "property", "thumbnail", name))).metadata();
    expect(main).toMatchObject({ format: "webp", width: SIZES.main.max, height: 1440 });
    expect(thumb).toMatchObject({ format: "webp", width: SIZES.thumbnail.max, height: 600 });
    expect((await sharp(readFileSync(join(media, "property", "original", name))).metadata()).width).toBe(4000);
  });

  it("never enlarges a small photo, and keeps a logo's transparency", async () => {
    const logo = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const name = await savePhoto(media, logo, "brand");
    const m = await sharp(readFileSync(join(media, "brand", "thumbnail", name))).metadata();
    expect(m).toMatchObject({ width: 200, height: 100, hasAlpha: true });
  });

  it("turns phone photos upright and drops hidden data such as GPS", async () => {
    const sideways = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#888" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await renderSize(sideways, "thumbnail", "jpeg", { width: 300, height: 200 });
    const m = await sharp(out).metadata();
    expect(m).toMatchObject({ width: 200, height: 300 });
    expect(m.orientation ?? 1).toBe(1);
    expect(m.exif).toBeUndefined();
  });

  it("refuses files that only look like images", async () => {
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
    await expect(savePhoto(media, fake)).rejects.toThrow(/can't be opened/);
    await expect(savePhoto(media, Buffer.from("<script>alert(1)</script>....."))).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(savePhoto(undefined, await photo(10, 10))).rejects.toThrow(/aren't set up/);
  });

  it("keeps old photos in their own format", async () => {
    expect([formatOf("a.jpg"), formatOf("b.JPEG"), formatOf("c.png"), formatOf("d.webp")]).toEqual(["jpeg", "jpeg", "png", "webp"]);
    const out = await renderSize(await photo(2500, 1000, "png"), "main", "png", { width: 2500, height: 1000 });
    expect(await sharp(out).metadata()).toMatchObject({ format: "png", width: 1920 });
    expect(existsSync(join(media, "property", "main"))).toBe(true);
  });
});
