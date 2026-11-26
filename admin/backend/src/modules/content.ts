// Website content run by Sheetal staff: blog posts, categories and comments; jobs and applications; buyer
// requirements and the requirement fee.
// Where it fits: the admin panel's Content, Careers and Demand pages.
// How it works: posts are written here and appear on the website when published; comments wait for approval;
// requirement fee proofs are confirmed or rejected here.
// Rules: CVs and payment proofs are private files, opened only through this API.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, notFound } from "@sheetal/platform/core/errors";
import { mediaBase, photoUrl, savePhoto } from "@sheetal/backend-core/lib/photos";
import { readPrivateFile } from "@sheetal/backend-core/lib/files";
import { htmlText, sanitizeHtml } from "@sheetal/backend-core/lib/html";
import { notify, teamWith } from "@sheetal/platform/notify/index";
import { staffOf } from "./routes.js";

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "post";
const opt = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);
const FEE_KEY = "requirement_fee";

export async function adminContentRoutes(app: FastifyInstance) {
  const base = mediaBase(app.config);
  const db = () => dbOf(app);
  const audit = (actorId: string, ip: string, action: string, target: string, meta?: object) =>
    db().auditLog.create({ data: { actorId, action, target, ip, meta: meta as object | undefined } });
  const image = (img: string | null) => (!img ? null : /^https?:\/\//.test(img) ? img : photoUrl(base, "main", img, "blog"));
  async function uniqueSlug(model: "blogPost" | "jobPost" | "blogCategory", wanted: string, exceptId?: number) {
    const root = slugify(wanted);
    for (let i = 0; i < 50; i++) {
      const slug = i ? `${root}-${i + 1}` : root;
      const found = await (db()[model] as unknown as { findUnique: (a: object) => Promise<{ id: number } | null> }).findUnique({ where: { slug } });
      if (!found || found.id === exceptId) return slug;
    }
    return `${root}-${Date.now()}`;
  }

  // ───── Blog ─────
  const Post = z.object({
    title: z.string().trim().min(5, "Write a title.").max(200), slug: opt(120), categoryId: z.number().int().nullable().optional(),
    content: z.string().max(200_000), excerpt: opt(400), image: opt(300), metaTitle: opt(200), metaDescription: opt(400),
    tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]), status: z.enum(["draft", "published"]).default("draft"),
    allowComments: z.boolean().default(true), publishedAt: z.coerce.date().nullable().optional(),
  });

  app.get("/admin/blog/posts", async (request) => {
    staffOf(request, "platform.content.update");
    const q = z.object({ status: z.enum(["all", "draft", "published"]).default("all"), q: z.string().trim().max(80).optional() }).parse(request.query);
    const rows = await db().blogPost.findMany({
      where: { ...(q.status !== "all" ? { status: q.status } : {}), ...(q.q ? { title: { contains: q.q, mode: "insensitive" } } : {}) },
      include: { category: { select: { id: true, name: true } }, _count: { select: { comments: { where: { status: "pending" } } } } }, orderBy: { updatedAt: "desc" }, take: 500,
    });
    return { data: rows.map(({ content, _count, ...p }) => ({ ...p, imageUrl: image(p.image), words: htmlText(content).split(" ").length, pendingComments: _count.comments })) };
  });

  app.get<{ Params: { id: string } }>("/admin/blog/posts/:id", async (request) => {
    staffOf(request, "platform.content.update");
    const p = await db().blogPost.findUnique({ where: { id: Number(request.params.id) || -1 }, include: { category: true } });
    if (!p) throw notFound("Post not found.");
    return { data: { ...p, imageUrl: image(p.image) } };
  });

  async function savePost(request: FastifyRequest, id?: number) {
    const s = staffOf(request, "platform.content.update");
    const b = Post.parse(request.body);
    // Editors write drafts; publishing needs content.publish.
    if (b.status === "published" && !s.can("platform.content.publish")) throw badRequest("Your staff role can save drafts; someone with publishing rights makes it live.");
    const before = id ? await db().blogPost.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound("Post not found.");
    const content = sanitizeHtml(b.content);
    if (b.status === "published" && htmlText(content).length < 50) throw badRequest("Write at least a few sentences before publishing.");
    const data = {
      title: b.title, slug: await uniqueSlug("blogPost", b.slug || b.title, id), categoryId: b.categoryId ?? null, content,
      excerpt: b.excerpt, image: b.image, metaTitle: b.metaTitle, metaDescription: b.metaDescription, tags: b.tags, status: b.status, allowComments: b.allowComments,
      publishedAt: b.status === "published" ? (b.publishedAt ?? before?.publishedAt ?? new Date()) : (b.publishedAt ?? null),
    };
    const p = id ? await db().blogPost.update({ where: { id }, data }) : await db().blogPost.create({ data: { ...data, authorId: s.user.id } });
    await audit(s.user.id, request.ip, id ? "content.post_updated" : "content.post_created", p.title, { status: p.status });
    return { message: p.status === "published" ? "Published." : "Saved as a draft.", data: { id: p.id, slug: p.slug } };
  }
  app.post("/admin/blog/posts", (request) => savePost(request));
  app.put<{ Params: { id: string } }>("/admin/blog/posts/:id", (request) => savePost(request, Number(request.params.id) || -1));

  app.delete<{ Params: { id: string } }>("/admin/blog/posts/:id", async (request) => {
    const s = staffOf(request, "platform.content.publish");
    const p = await db().blogPost.delete({ where: { id: Number(request.params.id) || -1 } }).catch(() => null);
    if (!p) throw notFound("Post not found.");
    await audit(s.user.id, request.ip, "content.post_deleted", p.title);
    return { message: "Post deleted." };
  });

  app.post("/admin/blog/images", { bodyLimit: 12 * 1024 * 1024 }, async (request) => {
    staffOf(request, "platform.content.update");
    const { data } = z.object({ data: z.string().min(16).max(11 * 1024 * 1024) }).parse(request.body);
    const file = await savePhoto(app.config.MEDIA_DIR, Buffer.from(data, "base64"), "blog");
    return { data: { file, url: image(file) } };
  });

  app.get("/admin/blog/categories", async (request) => {
    staffOf(request, "platform.content.update");
    const rows = await db().blogCategory.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { posts: true } } } });
    return { data: rows.map(({ _count, ...c }) => ({ ...c, posts: _count.posts })) };
  });
  app.post("/admin/blog/categories", async (request) => {
    const s = staffOf(request, "platform.content.update");
    const b = z.object({ name: z.string().trim().min(2).max(60), description: opt(300) }).parse(request.body);
    const c = await db().blogCategory.create({ data: { name: b.name, description: b.description, slug: await uniqueSlug("blogCategory", b.name) } });
    await audit(s.user.id, request.ip, "content.category_created", c.name);
    return { message: `${c.name} added.`, data: c };
  });
  app.patch<{ Params: { id: string } }>("/admin/blog/categories/:id", async (request) => {
    staffOf(request, "platform.content.update");
    const b = z.object({ name: z.string().trim().min(2).max(60).optional(), description: opt(300), active: z.boolean().optional() }).parse(request.body);
    const c = await db().blogCategory.update({ where: { id: Number(request.params.id) || -1 }, data: b }).catch(() => null);
    if (!c) throw notFound("Category not found.");
    return { message: "Saved." };
  });

  app.get("/admin/blog/comments", async (request) => {
    staffOf(request, "platform.content.update");
    const { status } = z.object({ status: z.enum(["pending", "approved", "rejected"]).default("pending") }).parse(request.query);
    const rows = await db().blogComment.findMany({ where: { status }, include: { post: { select: { id: true, title: true, slug: true } } }, orderBy: { createdAt: status === "pending" ? "asc" : "desc" }, take: 300 });
    return { data: rows };
  });
  app.patch<{ Params: { id: string } }>("/admin/blog/comments/:id", async (request) => {
    const s = staffOf(request, "platform.content.publish");
    const { status } = z.object({ status: z.enum(["approved", "rejected"]) }).parse(request.body);
    const c = await db().blogComment.update({ where: { id: request.params.id }, data: { status } }).catch(() => null);
    if (!c) throw notFound("Comment not found.");
    await audit(s.user.id, request.ip, `content.comment_${status}`, c.name);
    return { message: status === "approved" ? "Comment approved. It shows on the article." : "Comment hidden." };
  });

  // ───── Careers ─────
  const Job = z.object({
    title: z.string().trim().min(3).max(150), department: opt(80), jobType: z.enum(["full_time", "part_time", "contract", "internship"]).default("full_time"),
    location: opt(120), remote: z.boolean().default(false), experience: opt(80), form: z.object({ portfolio: z.enum(["off", "optional", "required"]).default("optional"), references: z.enum(["off", "optional", "required"]).default("optional"), vehicle: z.boolean().default(false), camera: z.boolean().default(false) }).default(() => ({ portfolio: "optional" as const, references: "optional" as const, vehicle: false, camera: false })),
    salaryMin: z.number().int().min(0).nullable().optional(), salaryMax: z.number().int().min(0).nullable().optional(), showSalary: z.boolean().default(false),
    vacancies: z.number().int().min(1).max(500).default(1), description: z.string().max(50_000), responsibilities: opt(50_000), requirements: opt(50_000), benefits: opt(50_000),
    deadline: z.coerce.date().nullable().optional(), status: z.enum(["draft", "open", "closed"]).default("draft"),
  });
  const jobData = (b: z.infer<typeof Job>) => ({
    ...b, description: sanitizeHtml(b.description), responsibilities: b.responsibilities && sanitizeHtml(b.responsibilities),
    requirements: b.requirements && sanitizeHtml(b.requirements), benefits: b.benefits && sanitizeHtml(b.benefits), deadline: b.deadline ?? null,
  });

  app.get("/admin/jobs", async (request) => {
    staffOf(request, "platform.content.update");
    const rows = await db().jobPost.findMany({ where: { tenantId: null }, orderBy: { createdAt: "desc" }, include: { _count: { select: { applications: true } } } });
    const fresh = await db().jobApplication.groupBy({ by: ["jobId"], where: { status: "new" }, _count: true });
    const n = new Map(fresh.map((f) => [f.jobId, f._count]));
    return { data: rows.map(({ _count, ...j }) => ({ ...j, applications: _count.applications, newApplications: n.get(j.id) ?? 0 })) };
  });
  app.post("/admin/jobs", async (request) => {
    const s = staffOf(request, "platform.content.update");
    const b = Job.parse(request.body);
    const j = await db().jobPost.create({ data: { ...jobData(b), slug: await uniqueSlug("jobPost", b.title) } });
    await audit(s.user.id, request.ip, "content.job_created", j.title);
    return { message: j.status === "open" ? "Job posted." : "Saved.", data: { id: j.id } };
  });
  app.put<{ Params: { id: string } }>("/admin/jobs/:id", async (request) => {
    const s = staffOf(request, "platform.content.update");
    const b = Job.parse(request.body);
    const own = await db().jobPost.findFirst({ where: { id: Number(request.params.id) || -1, tenantId: null }, select: { id: true } });
    if (!own) throw notFound("Job not found.");   // a business's job is changed by that business, only checked here
    const j = await db().jobPost.update({ where: { id: own.id }, data: jobData(b) });
    await audit(s.user.id, request.ip, "content.job_updated", j.title, { status: j.status });
    return { message: "Saved." };
  });
  // Jobs businesses posted from their panel: unverified businesses' open jobs wait here for a check.
  app.get("/admin/business-jobs", async (request) => {
    staffOf(request, "platform.content.update");
    const q = z.object({ show: z.enum(["pending", "all"]).default("pending") }).parse(request.query);
    const where: Prisma.JobPostWhereInput = { tenantId: { not: null }, ...(q.show === "pending" ? { review: "pending", status: "open" } : {}) };
    const [rows, waiting] = await Promise.all([
      db().jobPost.findMany({ where, orderBy: { updatedAt: q.show === "pending" ? "asc" : "desc" }, take: 300, include: { tenant: { select: { id: true, name: true, verification: true } }, _count: { select: { applications: true } } } }),
      db().jobPost.count({ where: { tenantId: { not: null }, review: "pending", status: "open" } }),
    ]);
    return { data: rows.map(({ _count, ...j }) => ({ ...j, applications: _count.applications })), meta: { waiting } };
  });
  app.patch<{ Params: { id: string } }>("/admin/business-jobs/:id", async (request) => {
    const s = staffOf(request, "platform.content.update");
    const b = z.object({ review: z.enum(["approved", "rejected"]), note: z.string().trim().max(500).optional() }).parse(request.body);
    if (b.review === "rejected" && !b.note) throw badRequest("Write why, so the business can fix it.", { note: ["Write why, so the business can fix it."] });
    const j = await db().jobPost.findFirst({ where: { id: Number(request.params.id) || -1, tenantId: { not: null } } });
    if (!j?.tenantId) throw notFound("Job not found.");
    await db().jobPost.update({ where: { id: j.id }, data: { review: b.review, reviewNote: b.review === "rejected" ? b.note : null } });
    await audit(s.user.id, request.ip, b.review === "approved" ? "content.business_job_approved" : "content.business_job_rejected", j.title, { tenantId: j.tenantId, note: b.note });
    const people = await teamWith(db(), j.tenantId, ["workspace.team.invite"]);
    await notify(db(), people, b.review === "approved"
      ? { tenantId: j.tenantId, type: "job_review", title: "Your job is on the website", message: j.title, link: "/business/jobs" }
      : { tenantId: j.tenantId, type: "job_review", title: "Your job needs changes", message: `${j.title}: ${b.note}`, link: "/business/jobs" });
    return { message: b.review === "approved" ? "Approved. The job is on the website." : "Sent back to the business with your note." };
  });
  app.get<{ Params: { id: string } }>("/admin/jobs/:id/applications", async (request) => {
    staffOf(request, "platform.content.update");
    const rows = await db().jobApplication.findMany({ where: { jobId: Number(request.params.id) || -1 }, orderBy: { createdAt: "desc" } });
    return { data: rows.map(({ ip: _ip, ...a }) => ({ ...a, cv: a.cvFile ? `/admin/applications/${a.id}/cv` : null })) };
  });
  app.patch<{ Params: { id: string } }>("/admin/applications/:id", async (request) => {
    staffOf(request, "platform.content.update");
    const { status } = z.object({ status: z.enum(["new", "shortlisted", "rejected", "hired"]) }).parse(request.body);
    const a = await db().jobApplication.update({ where: { id: request.params.id }, data: { status } }).catch(() => null);
    if (!a) throw notFound("Application not found.");
    return { message: "Saved." };
  });
  app.get<{ Params: { id: string } }>("/admin/applications/:id/cv", async (request, reply) => {
    staffOf(request, "platform.content.update");
    const a = await db().jobApplication.findUnique({ where: { id: request.params.id } });
    const f = a?.cvFile ? await readPrivateFile(app.config.MEDIA_DIR, "cv", a.cvFile) : null;
    if (!a || !f) throw notFound("CV not found.");
    return reply.header("content-type", f.type).header("content-disposition", `attachment; filename="cv-${slugify(a.name)}.${a.cvFile!.split(".").pop()}"`).header("cache-control", "private, no-store").send(f.data);
  });

  // ───── Buyer requirements and the requirement fee ─────
  app.get("/admin/requirements", async (request) => {
    staffOf(request, "platform.listing.moderate");
    const q = z.object({ show: z.enum(["fee_pending", "public", "hidden", "all"]).default("fee_pending") }).parse(request.query);
    const where: Prisma.LeadWhereInput = {
      kind: "requirement", tenantId: null,
      ...(q.show === "fee_pending" ? { feeStatus: "pending" } : q.show === "public" ? { public: true } : q.show === "hidden" ? { public: false } : {}),
    };
    const [rows, waiting] = await Promise.all([
      db().lead.findMany({ where, orderBy: { createdAt: q.show === "fee_pending" ? "asc" : "desc" }, take: 300, include: { _count: { select: { matches: true } } } }),
      db().lead.count({ where: { kind: "requirement", feeStatus: "pending" } }),
    ]);
    return {
      data: rows.map(({ _count, feeProof, ip: _ip, ...l }) => ({ ...l, code: `REQ-${String(l.ref).padStart(4, "0")}`, offers: _count.matches, proof: feeProof ? `/admin/requirements/${l.id}/proof` : null })),
      meta: { waiting },
    };
  });

  app.get<{ Params: { id: string } }>("/admin/requirements/:id/proof", async (request, reply) => {
    staffOf(request, "platform.listing.moderate");
    const l = await db().lead.findUnique({ where: { id: request.params.id } });
    const f = l?.feeProof ? await readPrivateFile(app.config.MEDIA_DIR, "proofs", l.feeProof) : null;
    if (!l || !f) throw notFound("Proof not found.");
    return reply.header("content-type", f.type).header("cache-control", "private, no-store").send(f.data);
  });

  /** Confirm or reject the fee, or show/hide a requirement on the board. */
  app.patch<{ Params: { id: string } }>("/admin/requirements/:id", async (request) => {
    const s = staffOf(request, "platform.listing.moderate");
    const b = z.object({ fee: z.enum(["confirmed", "rejected"]).optional(), public: z.boolean().optional(), note: z.string().trim().max(500).optional() }).parse(request.body);
    const l = await db().lead.findFirst({ where: { id: request.params.id, kind: "requirement", tenantId: null } });
    if (!l) throw notFound("Requirement not found.");
    if (b.fee && l.feeStatus !== "pending") throw badRequest("This payment was already checked.");
    if (b.fee === "rejected" && !b.note) throw badRequest("Say why, so the buyer can fix it.");
    const pub = b.fee === "confirmed" ? true : b.fee === "rejected" ? false : b.public;
    await db().lead.update({ where: { id: l.id }, data: { feeStatus: b.fee, public: pub } });
    await audit(s.user.id, request.ip, b.fee ? `requirement.fee_${b.fee}` : "requirement.visibility", `REQ-${String(l.ref).padStart(4, "0")}`, b.note ? { note: b.note } : undefined);
    const code = `REQ-${String(l.ref).padStart(4, "0")}`;
    if (b.fee && l.email) {
      await app.mailer.send({
        to: l.email, subject: b.fee === "confirmed" ? `Your requirement ${code} is live` : `About your payment for ${code}`,
        text: b.fee === "confirmed"
          ? `Namaste ${l.name},\n\nWe confirmed your payment. Your requirement ${code} is now on the requirement board, and agents can offer you properties. You'll get each offer by email.\n\nSheetal Property`
          : `Namaste ${l.name},\n\nWe couldn't confirm the payment for your requirement ${code}: ${b.note}\n\nPlease reply to this email or call us, and we'll sort it out.\n\nSheetal Property`,
      });
    }
    if (b.fee) await notify(db(), [l.userId], { type: "requirement", title: b.fee === "confirmed" ? `Your requirement ${code} is live` : `We couldn't confirm the payment for ${code}`, message: b.note ?? "", link: "/property-demand" });
    return { message: b.fee === "confirmed" ? "Payment confirmed. The requirement is on the board." : b.fee === "rejected" ? "Payment rejected; the buyer has been told." : pub ? "Shown on the board." : "Hidden from the board." };
  });

  app.get("/admin/settings/requirement-fee", async (request) => {
    staffOf(request, "platform.settings.read+platform.settings.update");
    const row = await db().appSetting.findUnique({ where: { key: FEE_KEY } });
    return { data: { enabled: false, amount: 0, note: "", ...((row?.value as object) ?? {}) } };
  });
  app.put("/admin/settings/requirement-fee", async (request) => {
    const s = staffOf(request, "platform.settings.read+platform.settings.update");
    const b = z.object({ enabled: z.boolean(), amount: z.number().int().min(0).max(100_000), note: z.string().trim().max(300).default("") }).parse(request.body);
    if (b.enabled && !b.amount) throw badRequest("Set the amount to switch the fee on.");
    await db().appSetting.upsert({ where: { key: FEE_KEY }, create: { key: FEE_KEY, value: b }, update: { value: b } });
    await audit(s.user.id, request.ip, "settings.requirement_fee", `Rs. ${b.amount}`, b);
    return { message: b.enabled ? `Requirement fee on: Rs. ${b.amount}.` : "Requirement fee off." };
  });
}
