// Sheetal's own home page banners for a week (the owner's request of 27 Nov 2026): 5 Sheetal Property listings shown as photo-grid
// banners for 7 days from today, and the home banner allowed 5 at a time (Admin -> Promote can change it back).
// Run:   npx tsx scripts/sheetal-banners.ts [--codes=SP-0001,SP-0002,...] [--days=7] [--apply]
// Without --codes it picks: the Chitwan Tourism Hub investment and project first, then Sheetal's newest published listings with the most
// photos, one per kind where it can. Without --apply it only shows the choice. Staff banners are free (source "staff") and already approved.

import { PrismaClient } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/platform/core/config";

loadEnvFiles();
const db = new PrismaClient({ datasources: { db: { url: loadConfig(process.env, "website").DATABASE_URL } } });
const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const apply = args.includes("--apply");
const days = Number(arg("days") || 7);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const tenant = await db.tenant.findFirstOrThrow({ where: { name: { equals: "Sheetal Property", mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
  const live = { tenantId: tenant.id, status: "published" as const, reviewHold: false, deletedAt: null, limitPausedAt: null };
  let picks: { id: number; code: string; title: string; kind: string; n: number }[] = [];
  const row = (l: { id: number; code: string; title: string; kind: string; _count: { photos: number } }) => ({ id: l.id, code: l.code, title: l.title, kind: l.kind, n: l._count.photos });
  const sel = { id: true, code: true, title: true, kind: true, _count: { select: { photos: true } } } as const;
  if (arg("codes")) {
    for (const code of arg("codes")!.split(",").map((c) => c.trim())) picks.push(row(await db.listing.findFirstOrThrow({ where: { ...live, code }, select: sel })));
  } else {
    const hub = await db.listing.findMany({ where: { ...live, title: { startsWith: "Chitwan Tourism Hub" } }, select: sel, orderBy: { id: "asc" } });
    picks = hub.map(row);
    const rest = await db.listing.findMany({ where: { ...live, id: { notIn: picks.map((p) => p.id) }, photos: { some: {} } }, select: sel, orderBy: [{ publishedAt: "desc" }], take: 300 });
    const good = rest.map(row).filter((x) => x.n >= 4).sort((a, b) => b.n - a.n);
    const kinds = new Set(picks.map((p) => p.kind));
    for (const x of good) { if (picks.length >= 5) break; if (!kinds.has(x.kind)) { picks.push(x); kinds.add(x.kind); } }
    for (const x of good) { if (picks.length >= 5) break; if (!picks.some((p) => p.id === x.id)) picks.push(x); }
  }
  const start = new Date(`${ymd(new Date())}T00:00:00.000Z`);
  const end = new Date(+start + (days - 1) * 864e5);
  console.log(`${apply ? "APPLYING" : "dry run"}: ${picks.length} banners ${ymd(start)} to ${ymd(end)}, 5 at a time.`);
  for (const p of picks) console.log(`  ${p.code} · ${p.kind} · ${p.n} photos · ${p.title}`);
  if (!apply) return;

  const cur = ((await db.appSetting.findUnique({ where: { key: "promote" } }))?.value ?? {}) as { hero?: Record<string, unknown> };
  const next = { ...cur, hero: { price: 1500, active: true, ...(cur.hero ?? {}), spots: Math.max(5, Number(cur.hero?.spots ?? 0)) } };
  await db.appSetting.upsert({ where: { key: "promote" }, create: { key: "promote", value: next }, update: { value: next } });
  const site = (process.env.SITE_URL || "https://sheetalproperty.com").replace(/\/$/, "");
  for (const p of picks) {
    const had = await db.banner.findFirst({ where: { listingId: p.id, source: "staff", status: "approved", endOn: { gte: start } } });
    if (had) { console.log(`  = ${p.code} already has a banner`); continue; }
    const slug = (await db.listing.findUniqueOrThrow({ where: { id: p.id }, select: { slug: true } })).slug;
    await db.banner.create({ data: { source: "staff", tenantId: tenant.id, listingId: p.id, desktop: "", mobile: "", link: `${site}/property/${slug}`, title: "", button: "", days, startOn: start, endOn: end, status: "approved", approvedAt: new Date(), paidAt: new Date() } });
  }
  console.log("Done: home banners spots set to", next.hero.spots);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => db.$disconnect());
