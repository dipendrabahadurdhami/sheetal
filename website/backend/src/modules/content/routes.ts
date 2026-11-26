// Blog and careers on the website.
// Where it fits: the website's Blog and Careers pages; posts and Sheetal's jobs are written in the admin panel, a business's
// jobs in its business panel (Jobs) and shown once approved (Sheetal checks jobs of businesses that aren't verified).
// How it works: only published posts and open jobs are shown; comments wait for Sheetal's approval; job applications
// (with a CV kept as a private file) go to the admin panel and the support email.

import type { FastifyInstance } from "fastify";
import type { BlogCategory, BlogPost, JobPost, Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, notFound } from "@sheetal/platform/core/errors";
import { mediaBase, photoUrl } from "@sheetal/backend-core/lib/photos";
import { savePrivateFile } from "@sheetal/backend-core/lib/files";
import { notify, teamWith } from "@sheetal/platform/notify/index";

const words = (html: string) => html.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const files = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is Buffer => Buffer.isBuffer(x));

export async function contentRoutes(app: FastifyInstance) {
  const base = mediaBase(app.config);
  const db = () => dbOf(app);
  const image = (img: string | null) => (!img ? null : /^https?:\/\//.test(img) ? img : photoUrl(base, "main", img, "blog"));
  const cat = (c: BlogCategory | null) => (c ? { id: c.id, name: c.name, slug: c.slug, description: c.description } : null);
  const card = (b: BlogPost & { category: BlogCategory | null }) => ({
    id: b.id, title: b.title, slug: b.slug, excerpt: b.excerpt ?? b.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200),
    image: image(b.image), thumbnail: image(b.image), featured_image: image(b.image), category: cat(b.category), tags: b.tags,
    published_at: b.publishedAt, created_at: b.publishedAt ?? b.createdAt, read_time: Math.max(1, Math.round(words(b.content) / 200)), views: b.views,
  });
  const paged = <T>(rows: T[], total: number, page: number, per: number) => {
    const meta = { total, current_page: page, last_page: Math.max(1, Math.ceil(total / per)), per_page: per };
    return { status: 200, data: rows, meta, ...meta };
  };
  const pageQ = z.object({ page: z.coerce.number().int().min(1).default(1), per_page: z.coerce.number().int().min(1).max(50).default(9) });
  const live = () => ({ status: "published", publishedAt: { lte: new Date() } }) satisfies Prisma.BlogPostWhereInput;

  // ───── Blog ─────
  app.get("/blog/categories", async () => {
    const cats = await db().blogCategory.findMany({ where: { active: true }, orderBy: { name: "asc" }, include: { _count: { select: { posts: { where: live() } } } } });
    return { status: 200, data: cats.filter((c) => c._count.posts > 0).map((c) => ({ ...cat(c), posts_count: c._count.posts })) };
  });

  app.get("/blog", async (request) => {
    const q = pageQ.extend({ q: text(80), tag: text(40) }).parse(request.query);
    const where: Prisma.BlogPostWhereInput = { ...live(), ...(q.q ? { title: { contains: q.q, mode: "insensitive" } } : {}), ...(q.tag ? { tags: { has: q.tag } } : {}) };
    const [total, rows] = await Promise.all([
      db().blogPost.count({ where }),
      db().blogPost.findMany({ where, include: { category: true }, orderBy: { publishedAt: "desc" }, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    ]);
    return paged(rows.map(card), total, q.page, q.per_page);
  });

  app.get<{ Params: { slug: string } }>("/blog/category/:slug", async (request) => {
    const q = pageQ.parse(request.query);
    const c = await db().blogCategory.findFirst({ where: { slug: request.params.slug.slice(0, 120), active: true } });
    if (!c) throw notFound("Category not found.");
    const where = { ...live(), categoryId: c.id };
    const [total, rows] = await Promise.all([
      db().blogPost.count({ where }),
      db().blogPost.findMany({ where, include: { category: true }, orderBy: { publishedAt: "desc" }, skip: (q.page - 1) * q.per_page, take: q.per_page }),
    ]);
    return { ...paged(rows.map(card), total, q.page, q.per_page), category: cat(c) };
  });

  app.get<{ Params: { slug: string } }>("/blog/:slug", async (request) => {
    const b = await db().blogPost.findFirst({ where: { ...live(), slug: request.params.slug.slice(0, 200) }, include: { category: true, comments: { where: { status: "approved" }, orderBy: { createdAt: "asc" } } } });
    if (!b) throw notFound("Article not found.");
    await db().blogPost.update({ where: { id: b.id }, data: { views: { increment: 1 } } });
    const related = await db().blogPost.findMany({ where: { ...live(), id: { not: b.id }, ...(b.categoryId ? { categoryId: b.categoryId } : {}) }, include: { category: true }, orderBy: { publishedAt: "desc" }, take: 3 });
    return {
      status: 200,
      data: {
        ...card(b), content: b.content, meta_title: b.metaTitle ?? b.title, meta_description: b.metaDescription ?? card(b).excerpt, allow_comments: b.allowComments,
        // Commenters' emails are never shown.
        comments: b.comments.map((c) => ({ id: c.id, name: c.name, comment: c.comment, created_at: c.createdAt })),
      },
      related: related.map(card),
    };
  });

  app.post<{ Params: { id: string } }>("/blog/:id/comment", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (request) => {
    const b = z.object({
      name: z.string().trim().min(2, "Enter your name.").max(60), email: z.union([z.email("Enter a valid email address."), z.literal("")]).optional(),
      comment: z.string().trim().min(3, "Write a comment.").max(2000), website: z.string().max(0).optional(), // spam trap
    }).parse(request.body);
    const post = await db().blogPost.findFirst({ where: { ...live(), id: Number(request.params.id) || -1 } });
    if (!post) throw notFound("Article not found.");
    if (!post.allowComments) throw badRequest("Comments are closed on this article.");
    await db().blogComment.create({ data: { postId: post.id, userId: request.user?.id, name: b.name, email: b.email || null, comment: b.comment, ip: request.ip } });
    return { status: 200, message: "Thanks. Your comment shows once Sheetal has checked it." };
  });

  // ───── Careers ─────
  type Company = { id: string; name: string; logoUrl: string | null; verification: string; city: string | null } | null;
  const companyOf = (t: Company) => (t
    ? { name: t.name, city: t.city, verified: t.verification === "verified", logo: t.logoUrl && !t.logoUrl.startsWith("/brand/") ? t.logoUrl : null, link: `/site/${t.id}`, own: false }
    : { name: "Sheetal Property", city: "Kathmandu", verified: true, logo: null, link: "/about", own: true });
  const withCompany = { tenant: { select: { id: true, name: true, logoUrl: true, verification: true, city: true } } } as const;
  const jobJson = (j: JobPost & { tenant?: Company }) => {
    const salary = j.showSalary && (j.salaryMin || j.salaryMax) ? `Rs. ${[j.salaryMin, j.salaryMax].filter(Boolean).map((n) => n!.toLocaleString("en-IN")).join(" – ")} a month` : null;
    return {
      id: j.id, title: j.title, slug: j.slug, department: j.department, job_type: j.jobType, type: j.jobType.replace(/_/g, " "),
      location: j.remote ? `${j.location ?? "Nepal"} (remote possible)` : j.location, experience: j.experience, salary, vacancies: j.vacancies,
      description: j.description, responsibilities: j.responsibilities, requirements: j.requirements, benefits: j.benefits,
      deadline: j.deadline ? j.deadline.toISOString().slice(0, 10) : null, created_at: j.createdAt,
      company: companyOf(j.tenant ?? null),
    };
  };
  // Open and approved; a business's job only while that business is running (not suspended or cancelled).
  const openJob = (): Prisma.JobPostWhereInput => ({
    status: "open", review: "approved", OR: [{ deadline: null }, { deadline: { gte: new Date(Date.now() - 864e5) } }],
    AND: [{ OR: [{ tenantId: null }, { tenant: { status: { in: ["active", "trial", "past_due"] } } }] }],
  });

  app.get("/jobs", async () => ({ status: 200, data: (await db().jobPost.findMany({ where: openJob(), orderBy: { createdAt: "desc" }, include: withCompany })).map(jobJson) }));

  app.get<{ Params: { slug: string } }>("/jobs/:slug", async (request) => {
    const j = await db().jobPost.findFirst({ where: { ...openJob(), slug: request.params.slug.slice(0, 200) }, include: withCompany });
    if (!j) throw notFound("This job isn't open any more.");
    await db().jobPost.update({ where: { id: j.id }, data: { views: { increment: 1 } } });
    return { status: 200, data: jobJson(j) };
  });

  app.post<{ Params: { slug: string } }>("/jobs/:slug/apply", { bodyLimit: 8 * 1024 * 1024, config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request) => {
    const raw = (request.body ?? {}) as Record<string, unknown>;
    const b = z.object({
      name: z.string().trim().min(2, "Enter your name.").max(80), email: z.email("Enter a valid email address."),
      phone: text(30), cover_letter: text(5000), message: text(5000), website: z.string().max(0).optional(),
    }).parse(Object.fromEntries(Object.entries(raw).filter(([, v]) => !Buffer.isBuffer(v))));
    const j = await db().jobPost.findFirst({ where: { ...openJob(), slug: request.params.slug.slice(0, 200) } });
    if (!j) throw notFound("This job isn't open any more.");
    const cv = files(raw.cv ?? raw.resume ?? raw.file)[0];
    if (!cv) throw badRequest("Attach your CV.", { cv: ["Attach your CV."] });
    const cvFile = await savePrivateFile(app.config.MEDIA_DIR, "cv", cv);
    await db().jobApplication.create({ data: { jobId: j.id, name: b.name, email: b.email.toLowerCase(), phone: b.phone, coverLetter: b.cover_letter ?? b.message, cvFile, ip: request.ip } });
    const who = `${b.name} <${b.email}>${b.phone ? `, ${b.phone}` : ""} applied for ${j.title}.`;
    if (!j.tenantId) {
      await app.mailer.send({ to: app.config.SUPPORT_EMAIL, subject: `Job application: ${j.title} — ${b.name}`, text: `${who}\nOpen it in the admin panel: Content → Careers.` });
    } else {
      // A business's job: its hiring people get a notification and the business's own email a copy (never Sheetal's).
      const t = await db().tenant.findUnique({ where: { id: j.tenantId }, select: { email: true } });
      await notify(db(), await teamWith(db(), j.tenantId, ["workspace.team.invite"]), { type: "job_application", title: "New job application", message: `${b.name} · ${j.title}`, link: "/business/jobs", tenantId: j.tenantId });
      if (t?.email) await app.mailer.send({ to: t.email, subject: `Job application: ${j.title} — ${b.name}`, text: `${who}\nOpen it in your business panel: Jobs.` });
    }
    return { status: 200, message: "Application received. We'll be in touch if it's a fit." };
  });
}
