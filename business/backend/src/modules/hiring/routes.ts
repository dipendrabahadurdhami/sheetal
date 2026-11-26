// Jobs a business posts on the website's Careers page, and the applications it gets.
// Where it fits: the business panel's Jobs page; the website shows open, approved jobs (website/backend content routes);
// Sheetal checks jobs from businesses that aren't verified yet (admin → Content → Careers → Jobs from businesses).
// How it works: a job saved as Open goes live at once for a verified business; otherwise it waits for Sheetal's check.
// Changing an approved job of an unverified business sends it back for a check. Applicants' CVs stay private files,
// opened only through this API.
// Rules: "workspace.team.invite" (owners and managers by default); a business only ever sees its own jobs.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { forbidden, notFound } from "@sheetal/platform/core/errors";
import { readPrivateFile } from "@sheetal/backend-core/lib/files";
import { sanitizeHtml } from "@sheetal/backend-core/lib/html";
import { notifyStaff } from "@sheetal/platform/notify/index";
import { workspaceOf, type Workspace } from "../access.js";

export const HIRING_PERM = "workspace.team.invite";
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "job";
const opt = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);
const MAX_OPEN = 30;

const Job = z.object({
  title: z.string().trim().min(3, "Write the job title.").max(120), department: opt(80),
  jobType: z.enum(["full_time", "part_time", "contract", "internship"]).default("full_time"),
  location: opt(120), remote: z.boolean().default(false), experience: opt(80),
  salaryMin: z.number().int().min(0).max(10_000_000).nullable().optional(), salaryMax: z.number().int().min(0).max(10_000_000).nullable().optional(),
  showSalary: z.boolean().default(false), vacancies: z.number().int().min(1).max(500).default(1),
  description: z.string().trim().min(20, "Write a few lines about the job (at least 20 letters).").max(50_000),
  responsibilities: opt(50_000), requirements: opt(50_000), benefits: opt(50_000),
  deadline: z.coerce.date().nullable().optional(), status: z.enum(["draft", "open", "closed"]).default("draft"),
});

export async function hiringRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const manage = (ws: Workspace) => { if (!ws.can(HIRING_PERM)) throw forbidden("Your role can't post jobs. Ask the owner."); };
  const mine = async (ws: Workspace, id: string) => {
    const j = await db().jobPost.findFirst({ where: { id: Number(id) || -1, tenantId: ws.tenantId } });
    if (!j) throw notFound("Job not found.");
    return j;
  };
  const clean = (b: z.infer<typeof Job>) => ({
    ...b, description: sanitizeHtml(b.description), responsibilities: b.responsibilities && sanitizeHtml(b.responsibilities),
    requirements: b.requirements && sanitizeHtml(b.requirements), benefits: b.benefits && sanitizeHtml(b.benefits),
    deadline: b.deadline ?? null, salaryMin: b.salaryMin ?? null, salaryMax: b.salaryMax ?? null,
  });
  async function uniqueSlug(title: string, company: string) {
    const root = slugify(`${title} ${company}`);
    for (let i = 0; ; i++) {
      const slug = i ? `${root}-${i + 1}` : root;
      if (!(await db().jobPost.findUnique({ where: { slug }, select: { id: true } }))) return slug;
    }
  }
  /** What Sheetal's check should be after a save: verified businesses never wait; an approved job stays approved while only its status moves. */
  const reviewAfter = (verified: boolean, open: boolean, before?: { review: string }, contentChanged = true) =>
    verified ? "approved" : before && before.review === "approved" && !contentChanged ? "approved" : open ? "pending" : before?.review === "rejected" ? "rejected" : "pending";
  const ask = (company: string, title: string) =>
    notifyStaff(db(), "platform.content.update", { type: "job_review", title: "Job to check", message: `${company}: ${title}`, link: "/admin/careers" });
  const tenantOf = (ws: Workspace) => db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, select: { name: true, verification: true } });
  const view = (j: Awaited<ReturnType<typeof mine>> & { _count?: { applications: number } }, fresh = 0) => ({
    id: j.id, title: j.title, slug: j.slug, department: j.department, jobType: j.jobType, location: j.location, remote: j.remote,
    experience: j.experience, salaryMin: j.salaryMin, salaryMax: j.salaryMax, showSalary: j.showSalary, vacancies: j.vacancies,
    description: j.description, responsibilities: j.responsibilities, requirements: j.requirements, benefits: j.benefits,
    deadline: j.deadline, status: j.status, review: j.review, reviewNote: j.reviewNote, views: j.views, createdAt: j.createdAt,
    applications: j._count?.applications ?? 0, newApplications: fresh,
  });

  app.get("/jobs", async (request) => {
    const ws = workspaceOf(request);
    manage(ws);
    const [rows, fresh, t] = await Promise.all([
      db().jobPost.findMany({ where: { tenantId: ws.tenantId }, orderBy: { createdAt: "desc" }, include: { _count: { select: { applications: true } } } }),
      db().jobApplication.groupBy({ by: ["jobId"], where: { status: "new", job: { tenantId: ws.tenantId } }, _count: true }),
      tenantOf(ws),
    ]);
    const n = new Map(fresh.map((f) => [f.jobId, f._count]));
    return { data: rows.map((j) => view(j, n.get(j.id) ?? 0)), meta: { verified: t.verification === "verified" } };
  });

  app.post("/jobs", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request);
    manage(ws);
    const b = Job.parse(request.body);
    const t = await tenantOf(ws);
    if (b.status === "open" && (await db().jobPost.count({ where: { tenantId: ws.tenantId, status: "open" } })) >= MAX_OPEN) throw forbidden(`Up to ${MAX_OPEN} open jobs at a time. Close one first.`);
    const review = reviewAfter(t.verification === "verified", b.status === "open");
    const j = await db().jobPost.create({ data: { ...clean(b), tenantId: ws.tenantId, review, slug: await uniqueSlug(b.title, t.name) } });
    await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: "jobs.created", target: j.title, ip: request.ip } });
    if (b.status === "open" && review === "pending") await ask(t.name, j.title);
    return { message: b.status !== "open" ? "Saved as a draft." : review === "approved" ? "Job posted. It's on the website now." : "Sent to Sheetal. It goes on the website once checked, usually within a working day.", data: { id: j.id } };
  });

  app.put<{ Params: { id: string } }>("/jobs/:id", async (request) => {
    const ws = workspaceOf(request);
    manage(ws);
    const before = await mine(ws, request.params.id);
    const b = Job.parse(request.body);
    const t = await tenantOf(ws);
    if (b.status === "open" && before.status !== "open" && (await db().jobPost.count({ where: { tenantId: ws.tenantId, status: "open" } })) >= MAX_OPEN) throw forbidden(`Up to ${MAX_OPEN} open jobs at a time. Close one first.`);
    const data = clean(b);
    const changed = (["title", "department", "jobType", "location", "remote", "experience", "salaryMin", "salaryMax", "showSalary", "vacancies", "description", "responsibilities", "requirements", "benefits"] as const)
      .some((k) => (data[k] ?? null) !== (before[k] ?? null));
    const review = reviewAfter(t.verification === "verified", b.status === "open", before, changed);
    await db().jobPost.update({ where: { id: before.id }, data: { ...data, review, reviewNote: review === "rejected" ? before.reviewNote : null } });
    await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: "jobs.updated", target: b.title, ip: request.ip, meta: { status: b.status, review } } });
    if (b.status === "open" && review === "pending" && (before.review !== "pending" || before.status !== "open")) await ask(t.name, b.title);
    return { message: b.status !== "open" ? "Saved." : review === "approved" ? "Saved. It's on the website." : "Saved and sent to Sheetal to check." };
  });

  app.delete<{ Params: { id: string } }>("/jobs/:id", async (request) => {
    const ws = workspaceOf(request);
    manage(ws);
    const j = await mine(ws, request.params.id);
    await db().jobPost.delete({ where: { id: j.id } });
    await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: "jobs.deleted", target: j.title, ip: request.ip } });
    return { message: "Job deleted." };
  });

  app.get<{ Params: { id: string } }>("/jobs/:id/applications", async (request) => {
    const ws = workspaceOf(request);
    manage(ws);
    const j = await mine(ws, request.params.id);
    const rows = await db().jobApplication.findMany({ where: { jobId: j.id }, orderBy: { createdAt: "desc" } });
    return { data: rows.map(({ ip: _ip, cvFile, ...a }) => ({ ...a, cv: !!cvFile })) };
  });

  app.patch<{ Params: { id: string } }>("/job-applications/:id", async (request) => {
    const ws = workspaceOf(request);
    manage(ws);
    const { status } = z.object({ status: z.enum(["new", "shortlisted", "rejected", "hired"]) }).parse(request.body);
    const r = await db().jobApplication.updateMany({ where: { id: request.params.id, job: { tenantId: ws.tenantId } }, data: { status } });
    if (!r.count) throw notFound("Application not found.");
    return { message: "Saved." };
  });

  app.get<{ Params: { id: string } }>("/job-applications/:id/cv", async (request, reply) => {
    const ws = workspaceOf(request);
    manage(ws);
    const a = await db().jobApplication.findFirst({ where: { id: request.params.id, job: { tenantId: ws.tenantId } } });
    const f = a?.cvFile ? await readPrivateFile(app.config.MEDIA_DIR, "cv", a.cvFile) : null;
    if (!f) throw notFound("CV not found.");
    return reply.header("content-type", f.type).header("cache-control", "private, no-store").send(f.data);
  });
}
