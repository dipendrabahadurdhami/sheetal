// Imports the rest of the old Laravel site after the listings and users (import-old-site.ts, run that first):
// blog categories, posts (with their pictures) and comments; buyer requirements and offers on them; website
// enquiries (contact agent, contact owner, site visits); inbox leads from Facebook, Instagram, WhatsApp and the
// website with their messages; and people's notifications.
//   npm run import:old-content -w @sheetal/website-api -- --dump <database-full.sql> [--files <ROOT/storage/app/public>] [--dry-run]
// Safe to run again: rows are matched by their old id.
//
// Left out on purpose: the 9 old reviews (team tests: "ss", "dfg", "oko"…) and job posts (there were none).
// Old ids share one `legacy_id` column on leads, so each table gets its own range:
//   requirement_forms 1,000,000+ · contact_agents 2,000,000+ · contact_owners 3,000,000+ · schedule_tours 4,000,000+ · leads 5,000,000+
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Prisma } from "@prisma/client";
import { loadConfig, loadEnvFiles } from "@sheetal/backend-core/config";
import { createDb } from "@sheetal/backend-core/lib/db";
import { photoKind } from "@sheetal/backend-core/lib/photos";
import { sanitizeHtml } from "@sheetal/backend-core/lib/html";
import { readOptionalTables, type Row } from "./old-dump.js";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = args.includes("--dry-run");
const dumpPath = arg("--dump");
const filesDir = arg("--files");
if (!dumpPath || !existsSync(dumpPath)) {
  console.error("Usage: npm run import:old-content -w @sheetal/website-api -- --dump <database-full.sql> [--files <ROOT/storage/app/public>] [--dry-run]");
  process.exit(1);
}

const RANGE = { requirement: 1_000_000, contact_agent: 2_000_000, contact_owner: 3_000_000, site_visit: 4_000_000, chat: 5_000_000 };
const str = (v: unknown) => { const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim(); return s && !/^(null|n\/a|-)$/i.test(s) ? s : null; };
const date = (v: unknown) => { const d = v ? new Date(String(v).replace(" ", "T") + "Z") : null; return d && !isNaN(+d) ? d : null; };
const phone = (v: unknown) => { const s = str(v)?.replace(/[^\d+]/g, ""); return s && s.length >= 7 ? s.slice(0, 20) : null; };
const email = (v: unknown) => { const s = str(v)?.toLowerCase(); return s && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(s) ? s : null; };
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "post";
const decode = (s: string) => s.replace(/&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
/** Keyboard-mash test entries ("kfjsdalkfd", "gfdgfd") stay private. */
const looksLikeTest = (...v: (string | null)[]) => v.some((x) => x && /(asdf|sdf|gfd|fdsa|kfj|lkj|qwe|zxc|test test)/i.test(x));

loadEnvFiles();
const config = loadConfig(process.env, "website");
const connected = createDb(config.DATABASE_URL);
if (!connected) { console.error("DATABASE_URL is not set (backend-core/.env)."); process.exit(1); }
const db = connected;

console.log(`Reading ${dumpPath}…`);
const T = readOptionalTables(dumpPath, ["blog_categories", "blogs", "blog_comments", "blog_tag", "blog_tags", "requirement_forms", "demand_matches", "contact_agents", "contact_owners", "schedule_tours", "leads", "lead_messages", "agent_notifications"]);
const rows = (t: string): Row[] => T[t] ?? [];

const users = await db.user.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true } });
const userOf = new Map(users.map((u) => [u.legacyId!, u.id]));
const listings = await db.listing.findMany({ where: { legacyId: { not: null } }, select: { id: true, legacyId: true, tenantId: true } });
const listingOf = new Map(listings.map((l) => [l.legacyId!, l]));
const sheetal = await db.tenant.findFirst({ where: { OR: [{ email: "shetalrealestate@gmail.com" }, { name: "Sheetal Property" }], type: "agency" } });
if (!sheetal) { console.error("Run import-old-site.ts first (Sheetal Property's business is missing)."); process.exit(1); }
if (!users.length) console.warn("No imported users found; people won't be linked. Run import-old-site.ts first.");

const counts: Record<string, number> = {};
const count = (k: string) => { counts[k] = (counts[k] ?? 0) + 1; };

// ───── Blog ─────
const catOf = new Map<number, number>();
for (const c of rows("blog_categories")) {
  const name = str(c.name);
  if (!name) continue;
  const data = { name, slug: slugify(str(c.slug) ?? name), description: str(c.description), active: Number(c.status ?? 1) === 1 };
  if (!dryRun) {
    const row = await db.blogCategory.upsert({ where: { legacyId: Number(c.id) }, create: { ...data, legacyId: Number(c.id) }, update: data });
    catOf.set(Number(c.id), row.id);
  }
  count("blog categories");
}

const tagName = new Map(rows("blog_tags").map((t) => [Number(t.id), str(t.name)]));
const tagsOf = new Map<number, string[]>();
for (const bt of rows("blog_tag")) { const n = tagName.get(Number(bt.blog_tag_id)); if (n) tagsOf.set(Number(bt.blog_id), [...(tagsOf.get(Number(bt.blog_id)) ?? []), n]); }

/** Copies an old picture (storage/app/public/blogs/…) into MEDIA_DIR/blog; returns the new name or null. */
function copyBlogImage(path: string | null): string | null {
  if (!path || !filesDir || !config.MEDIA_DIR) return null;
  const from = join(filesDir, path);
  if (!existsSync(from)) return null;
  const kind = photoKind(readFileSync(from));
  if (!kind) return null;
  const name = `${basename(path).replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60) || "image"}.${kind}`;
  if (!dryRun) for (const size of ["main", "thumbnail"]) { mkdirSync(join(config.MEDIA_DIR, "blog", size), { recursive: true }); copyFileSync(from, join(config.MEDIA_DIR, "blog", size, name)); }
  return name;
}

const postOf = new Map<number, number>();
for (const b of rows("blogs")) {
  const title = str(b.title);
  const content = sanitizeHtml(decode(String(b.content ?? "")));
  if (!title || !content) continue;
  // Old slugs end with a timestamp ("…-2026-1778657157"); the new ones don't need it.
  const slug = slugify(String(str(b.slug) ?? title).replace(/-\d{9,}$/, ""));
  const image = copyBlogImage(str(b.thumbnail));
  if (str(b.thumbnail) && !image) count("blog pictures not found");
  const data = {
    title: decode(title), slug, content, excerpt: str(b.excerpt) ? decode(str(b.excerpt)!) : null, image, metaTitle: str(b.meta_title), metaDescription: str(b.meta_description),
    tags: tagsOf.get(Number(b.id)) ?? [], status: b.status === "published" ? "published" : "draft", allowComments: Number(b.allow_comments ?? 1) === 1,
    publishedAt: date(b.published_at) ?? (b.status === "published" ? date(b.created_at) : null), views: Number(b.views) || 0,
    categoryId: catOf.get(Number(b.blog_category_id)) ?? null, authorId: userOf.get(Number(b.user_id)) ?? null, createdAt: date(b.created_at) ?? new Date(),
  };
  if (!dryRun) {
    const clash = await db.blogPost.findUnique({ where: { slug } });
    if (clash && clash.legacyId !== Number(b.id)) data.slug = `${slug}-${b.id}`;
    const row = await db.blogPost.upsert({ where: { legacyId: Number(b.id) }, create: { ...data, legacyId: Number(b.id) }, update: data });
    postOf.set(Number(b.id), row.id);
  }
  count(data.status === "published" ? "blog posts published" : "blog posts draft");
}
for (const c of rows("blog_comments")) {
  const postId = postOf.get(Number(c.blog_id));
  const text = str(c.content);
  if (!postId || !text) continue;
  if (!dryRun && !(await db.blogComment.findFirst({ where: { postId, comment: text, name: str(c.author_name) ?? "Reader" } }))) {
    await db.blogComment.create({ data: { postId, userId: userOf.get(Number(c.user_id)) ?? null, name: str(c.author_name) ?? "Reader", email: email(c.author_email), comment: text, status: c.status === "approved" ? "approved" : "pending", createdAt: date(c.created_at) ?? new Date() } });
  }
  count("blog comments");
}

// ───── Leads ─────
async function upsertLead(legacyId: number, data: Prisma.LeadUncheckedCreateInput) {
  if (dryRun) return null;
  return db.lead.upsert({ where: { legacyId }, create: { ...data, legacyId }, update: { ...data } });
}

const reqOf = new Map<number, string>();
const recent = Date.now() - 180 * 864e5;
for (const r of rows("requirement_forms")) {
  const name = str(r.name);
  if (!name) continue;
  const created = date(r.created_at) ?? new Date();
  const fee = Number(r.fee_amount) || 0;
  const paid = Number(r.paid) === 1;
  const test = looksLikeTest(name, str(r.prefered_location), str(r.description));
  const details = Object.fromEntries(Object.entries({
    property_type: str(r.requirements), tenant_option: str(r.tenant_option), location: str(r.prefered_location), min_budget: str(r.minimum_budget), max_budget: str(r.maximum_budget),
    vehicles: str(r.vehicle), occupation: str(r.occupation), address: str(r.temporary_address) ?? str(r.permanent_address),
  }).filter(([, v]) => v));
  const lead = await upsertLead(RANGE.requirement + Number(r.id), {
    kind: "requirement", tenantId: null, name, email: email(r.email), phone: phone(r.contact_number), message: str(r.description) ?? "", details,
    status: Number(r.new) === 1 ? "new" : "contacted", createdAt: created, lastAt: created, readAt: Number(r.new) === 1 ? null : created,
    public: !test && created.getTime() >= recent && (!fee || paid),
    feeStatus: fee ? (paid ? "confirmed" : "pending") : null, feeAmount: fee || null, feeRef: str(r.payment_reference),
  });
  if (lead) reqOf.set(Number(r.id), lead.id);
  count(test ? "requirements (test, kept private)" : "requirements");
}
for (const m of rows("demand_matches")) {
  const leadId = reqOf.get(Number(m.requirement_form_id));
  const listing = listingOf.get(Number(m.property_id));
  const userId = userOf.get(Number(m.user_id));
  if (!leadId || !listing || !userId) { count("offers skipped (missing requirement, listing or person)"); continue; }
  if (!dryRun) await db.demandMatch.upsert({ where: { leadId_listingId: { leadId, listingId: listing.id } }, create: { leadId, listingId: listing.id, userId, message: str(m.message) ?? "", status: str(m.status) ?? "sent", createdAt: date(m.created_at) ?? new Date() }, update: {} });
  count("offers on requirements");
}

const reasons = (v: unknown) => { const s = str(v); if (!s) return undefined; try { const j = JSON.parse(s); return Array.isArray(j) ? j.map(String) : [s]; } catch { return [s]; } };
const enquiry = async (kind: "contact_agent" | "contact_owner" | "site_visit", r: Row, extra: { listingLegacy?: number; message: string | null; phone: unknown; details: Record<string, unknown> }) => {
  const name = str(r.name);
  if (!name) return;
  const listing = extra.listingLegacy ? listingOf.get(extra.listingLegacy) : undefined;
  const created = date(r.created_at) ?? new Date();
  await upsertLead(RANGE[kind] + Number(r.id), {
    kind, tenantId: listing?.tenantId ?? sheetal.id, listingId: listing?.id ?? null, name, email: email(r.email), phone: phone(extra.phone), message: extra.message ?? "",
    details: Object.fromEntries(Object.entries({ ...extra.details, source: str(r.source) }).filter(([, v]) => v != null && v !== "")) as Prisma.InputJsonValue,
    status: Number(r.new) === 1 ? "new" : "contacted", createdAt: created, lastAt: created, readAt: Number(r.new) === 1 ? null : created,
  });
  count(`enquiries: ${kind.replace("_", " ")}`);
};
for (const r of rows("contact_agents")) await enquiry("contact_agent", r, { message: str(r.contact_form), phone: r.phone, details: { reasons: reasons(r.reasons), reason_other: str(r.reason_other), preferred_contact_time: str(r.preferred_contact_time), preferred_date: str(r.preferred_date) } });
for (const r of rows("contact_owners")) await enquiry("contact_owner", r, { listingLegacy: Number(r.property_id) || undefined, message: str(r.reason_other), phone: r.mobile_number, details: { reasons: reasons(r.reasons), preferred_contact_time: str(r.preferred_contact_time), preferred_date: str(r.preferred_date), owner_type: str(r.owner_type), company: str(r.company_name) } });
for (const r of rows("schedule_tours")) await enquiry("site_visit", r, { listingLegacy: Number(r.property_id) || undefined, message: str(r.message_description), phone: r.phone, details: { date: str(r.date), time: str(r.time), reasons: reasons(r.reasons), preferred_contact_time: str(r.preferred_contact_time) } });

// Inbox leads from the channels (Facebook, Instagram, WhatsApp, website) with their conversation.
const CHANNEL: Record<string, string> = { facebook: "messenger", instagram: "instagram", whatsapp: "whatsapp", website: "web", ai_extracted: "web" };
const STAGE: Record<string, string> = { new: "new", contacted: "contacted", qualified: "viewing", negotiating: "negotiating", won: "won", converted: "won", lost: "lost", closed: "lost" };
const msgsOf = new Map<number, Row[]>();
for (const m of rows("lead_messages")) msgsOf.set(Number(m.lead_id), [...(msgsOf.get(Number(m.lead_id)) ?? []), m]);
for (const r of rows("leads")) {
  const name = str(r.contact_name) ?? "Facebook user";
  const created = date(r.created_at) ?? new Date();
  const msgs = (msgsOf.get(Number(r.id)) ?? []).sort((a, b) => +(date(a.sent_at ?? a.created_at) ?? 0) - +(date(b.sent_at ?? b.created_at) ?? 0));
  let tags: string[] = [];
  try { const t = JSON.parse(String(r.tags ?? "[]")); if (Array.isArray(t)) tags = t.map(String).slice(0, 10); } catch { /* not a list */ }
  const first = msgs.find((m) => m.direction === "in" || m.direction === "inbound");
  const last = date(r.last_message_at) ?? created;
  const lead = await upsertLead(RANGE.chat + Number(r.id), {
    kind: "chat", tenantId: sheetal.id, name, email: email(r.contact_email), phone: phone(r.manual_phone), message: str(first?.body) ?? "",
    details: Object.fromEntries(Object.entries({ channel: CHANNEL[String(r.channel)] ?? "web", note: str(r.admin_note), follow_up_note: str(r.follow_up_note) }).filter(([, v]) => v)),
    status: STAGE[String(r.status)] ?? "new", tags, followAt: date(r.follow_up_at), createdAt: created, lastAt: last, readAt: Number(r.is_read) === 1 ? last : null,
  });
  if (lead && msgs.length) {
    await db.leadMessage.deleteMany({ where: { leadId: lead.id } });
    const rest = first ? msgs.filter((m) => m !== first) : msgs;
    await db.leadMessage.createMany({ data: rest.filter((m) => str(m.body)).map((m) => ({ leadId: lead.id, direction: m.direction === "out" || m.direction === "outbound" ? "out" : "in", body: str(m.body)!, createdAt: date(m.sent_at ?? m.created_at) ?? created })) });
  }
  count(`inbox leads: ${CHANNEL[String(r.channel)] ?? "web"}`);
}

// ───── Notifications ─────
for (const n of rows("agent_notifications")) {
  const userId = userOf.get(Number(n.user_id));
  const title = str(n.title);
  if (!userId || !title) { count("notifications skipped (person not found)"); continue; }
  const createdAt = date(n.created_at) ?? new Date();
  if (!dryRun && !(await db.notification.findFirst({ where: { userId, title, createdAt } }))) {
    await db.notification.create({ data: { userId, type: str(n.type) ?? "info", title, message: str(n.message) ?? "", readAt: Number(n.is_read) === 1 ? date(n.read_at) ?? createdAt : null, createdAt } });
  }
  count("notifications");
}

console.log(dryRun ? "Dry run, nothing saved:" : "Imported:");
for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${k}: ${v}`);
await db.$disconnect();
