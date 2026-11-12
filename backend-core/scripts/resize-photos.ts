// Brings every photo already in MEDIA_DIR to the sizes new uploads get (src/lib/photos.ts SIZES): main up to
// 1920 px, thumbnail up to 800 px, sharp and light. Run it once after updating, and again any time; it continues
// where it stopped.
//   npm run photos:resize                       all areas (property, blog, brand)
//   npm run photos:resize -- --dry-run          only counts what it would do; changes nothing
//   npm run photos:resize -- --area=property    one area
//   npm run photos:resize -- --limit=200        the first 200 not done yet (a quick test)
//   npm run photos:resize -- --force            do them all again (after changing SIZES)
//   npm run photos:resize -- --upload           also put the sizes in object storage (S3_BUCKET must be set)
//   npm run photos:resize -- --no-original      don't keep a copy of the untouched photo (saves disk; not undoable)
// How it works: for each file in <area>/main, the untouched source is original/<name> (copied there first when
// missing, so nothing is ever lost). The thumbnail is always made again from the source; main is made again only
// when it is bigger than 1920 px, heavier than 700 KB or stored sideways, and only kept when it comes out smaller.
// Files keep their names and their format (.jpg stays JPEG), so the database doesn't change. Done files are listed
// in MEDIA_DIR/.resized/<area>.txt; unreadable ones in <area>-errors.txt.
// Rules: the database is not needed. Ctrl+C is safe (every file is written through a temporary file).

import { appendFile, copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";
import { SIZES, contentTypeOf, formatOf, longSide, renderSize, writeAtomic, type PhotoArea } from "../src/lib/photos.js";
import { configureStorage, putObject, storageOn } from "@sheetal/platform/files/storage";

loadEnvFiles();
const config = loadConfig(process.env, "website");
configureStorage(config);

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const dry = flag("dry-run"), force = flag("force"), upload = flag("upload"), keepOriginal = !flag("no-original");
const limit = Number(value("limit")) || Infinity;
const AREAS: PhotoArea[] = ["property", "blog", "brand"];
const areas = value("area") ? AREAS.filter((a) => a === value("area")) : AREAS;
const VERSION = `v1:${SIZES.main.max}:${SIZES.thumbnail.max}`;
const PHOTO = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,120}\.(jpe?g|png|webp)$/i;
const HEAVY = 700 * 1024;

const media = config.MEDIA_DIR;
if (!media || !existsSync(media)) {
  console.error("MEDIA_DIR isn't set or doesn't exist. Set it in backend-core/.env to the photos folder.");
  process.exit(1);
}
if (upload && !storageOn()) {
  console.error("--upload needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in backend-core/.env.");
  process.exit(1);
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const log = join(media, ".resized");
await mkdir(log, { recursive: true });
sharp.cache({ memory: 256, files: 0 });
const workers = Math.max(1, Math.min(4, cpus().length - 1));
console.log(`Photos in ${media}${dry ? " (dry run: nothing is changed)" : ""}. ${workers} at a time.`);

for (const area of areas) {
  const mainDir = join(media, area, "main");
  if (!existsSync(mainDir)) { console.log(`${area}: no main folder, skipped.`); continue; }
  for (const size of ["original", "thumbnail"]) await mkdir(join(media, area, size), { recursive: true });
  const doneFile = join(log, `${area}.txt`);
  const done = new Set(force || !existsSync(doneFile) ? [] : (await readFile(doneFile, "utf8")).split(/\r?\n/).filter((l) => l.startsWith(`${VERSION} `)).map((l) => l.slice(VERSION.length + 1)));
  const files = (await readdir(mainDir)).filter((f) => PHOTO.test(f));
  const todo = files.filter((f) => !done.has(f)).slice(0, limit);
  console.log(`${area}: ${files.length} photos, ${files.length - todo.length} already done, ${todo.length} to do.`);
  const n = { done: 0, mainRedone: 0, bad: 0, before: 0, after: 0 };
  let next = 0;

  async function one(file: string) {
    const mainP = join(mainDir, file), thumbP = join(media!, area, "thumbnail", file), origP = join(media!, area, "original", file);
    const hasOriginal = existsSync(origP);
    const src = await readFile(hasOriginal ? origP : mainP);
    const meta = await sharp(src, { failOn: "none" }).metadata().catch(() => null);
    if (!meta?.width || !meta.height) {
      n.bad++;
      if (!dry) await appendFile(join(log, `${area}-errors.txt`), `${file}\tcan't be opened\n`);
      return;
    }
    const fmt = formatOf(file);
    const mainSize = (await stat(mainP)).size;
    const thumbBefore = existsSync(thumbP) ? (await stat(thumbP)).size : 0;
    n.before += mainSize + thumbBefore;
    const sideways = (meta.orientation ?? 1) > 1;
    let mainOut: Buffer | null = null;
    if (longSide(meta) > SIZES.main.max || mainSize > HEAVY || sideways) {
      const out = await renderSize(src, "main", fmt, meta, false);
      if (out.length < mainSize || sideways || longSide(meta) > SIZES.main.max) mainOut = out;
    }
    const thumb = await renderSize(src, "thumbnail", fmt, meta, false);
    n.after += (mainOut?.length ?? mainSize) + thumb.length;
    if (mainOut) n.mainRedone++;
    if (dry) { n.done++; return; }
    if (!hasOriginal && keepOriginal) await copyFile(mainP, origP);
    if (mainOut) await writeAtomic(mainP, mainOut);
    await writeAtomic(thumbP, thumb);
    if (upload) {
      await putObject(`${area}/main/${file}`, mainOut ?? (await readFile(mainP)), contentTypeOf(file));
      await putObject(`${area}/thumbnail/${file}`, thumb, contentTypeOf(file));
    }
    await appendFile(doneFile, `${VERSION} ${file}\n`);
    n.done++;
  }

  const started = Date.now();
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < todo.length) {
      const file = todo[next++]!;
      try { await one(file); } catch (e) {
        n.bad++;
        if (!dry) await appendFile(join(log, `${area}-errors.txt`), `${file}\t${e instanceof Error ? e.message : "failed"}\n`);
      }
      const seen = n.done + n.bad;
      if (seen % 100 === 0 || seen === todo.length) {
        const rate = seen / Math.max(1, (Date.now() - started) / 1000);
        console.log(`  ${area}: ${seen}/${todo.length} · ${n.bad} unreadable · ${mb(n.before)} → ${mb(n.after)} · about ${Math.ceil((todo.length - seen) / Math.max(rate, 0.1) / 60)} min left`);
      }
    }
  }));
  console.log(`${area}: ${n.done} done (${n.mainRedone} main photos made smaller), ${n.bad} unreadable. ${mb(n.before)} → ${mb(n.after)}.${n.bad ? ` See .resized/${area}-errors.txt.` : ""}`);
}
console.log(dry ? "Dry run finished. Run again without --dry-run to change the photos." : "Finished. Run `npm run backup` to copy the new sizes to the backup.");
