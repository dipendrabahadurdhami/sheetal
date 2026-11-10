// Online forms (Business → Forms): build, publish and share forms, and read the responses.
// Where it fits: the panel's Forms pages (LiveForms.jsx). The public side (showing a live form, taking answers) is in
// website/backend/src/modules/forms; every response there becomes an Inbox lead.
// How it works: a form belongs to a branch (its team gets the leads) and has a slug unique across Sheetal, so its
// link is SITE_URL/f/<slug>. Drafts can be saved half-done; publishing checks the form can be answered and that a
// Payment field has somewhere to pay. Responses are listed per form or destination, downloaded as CSV, and payment
// screenshots are confirmed or rejected here.
// Rules: the same people as the menu (messages.reply, leads.view or settings.business), on the branches in view; the
// plan's form limit counts every form of the business; files are private and only streamed from here.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Form as FormRow, Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { readPrivateFile } from "@sheetal/backend-core/lib/files";
import { worksAt } from "@sheetal/backend-core/domain/branches";
import { DESTS, DEST_LABEL, FieldsSchema, formLimits, monthStart, publishProblem, slugify, type Answer, type FormField } from "@sheetal/backend-core/domain/forms";
import { branchFor, branchView, inView, workspaceOf, type Workspace } from "../access.js";

const dataUrl = z.union([z.literal(""), z.string().max(600_000, "Pictures can be up to 400 KB.").regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Use a PNG, JPG or WebP picture.")]);
const Style = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#A3171F"), logo: z.string().trim().max(3).default(""), logoUrl: dataUrl.default(""),
  font: z.enum(["brand", "serif", "system"]).default("brand"), corners: z.enum(["rounded", "square"]).default("rounded"), button: z.string().trim().max(40).default(""),
}).partial();
const Pay = z.object({ qrUrl: dataUrl.default(""), esewa: z.string().trim().max(40).default(""), bank: z.string().trim().max(400).default("") }).partial();
const Places = z.object({ profile: z.boolean(), listing: z.boolean(), job: z.boolean(), link: z.boolean() }).partial();
const Body = z.object({
  title: z.string().trim().min(1, "Give the form a title.").max(120),
  desc: z.string().trim().max(1000).default(""),
  tpl: z.string().max(20).nullable().optional(),
  slug: z.string().max(60).optional(),
  fields: FieldsSchema.default([]),
  dest: z.enum(DESTS).default("leads"),
  thanks: z.string().trim().max(1000).default(""),
  style: Style.default({}), places: Places.default({}), pay: Pay.default({}),
  assignee: z.string().max(40).nullable().optional(),
  branchId: z.string().max(40).nullable().optional(),
});
const big = { bodyLimit: 2 * 1024 * 1024 };

export async function formRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const site = app.config.SITE_URL.replace(/\/+$/, "");
  const link = (slug: string) => `${site}/f/${slug}`;

  const access = (request: FastifyRequest) => {
    const ws = workspaceOf(request);
    if (!ws.can("messages.reply") && !ws.can("leads.view") && !ws.can("settings.business")) throw forbidden("Your role can't use forms.");
    return ws;
  };
  const scope = async (ws: Workspace, request: FastifyRequest) => ({ tenantId: ws.tenantId, ...inView(await branchView(db(), request, ws)) });
  const one = async (ws: Workspace, request: FastifyRequest, id: string) => {
    const f = await db().form.findFirst({ where: { ...(await scope(ws, request)), id } });
    if (!f) throw notFound("Form not found.");
    return f;
  };
  /** A slug nobody else uses: the one asked for, or with -2, -3… after it. */
  const freeSlug = async (want: string, selfId?: string) => {
    const base = slugify(want);
    for (let i = 1; i < 200; i++) {
      const s = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
      const other = await db().form.findUnique({ where: { slug: s }, select: { id: true } });
      if (!other || other.id === selfId) return s;
    }
    return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
  };
  /** The person new leads go to: in the team, working at the form's branch. */
  const checkAssignee = async (tenantId: string, userId: string | null | undefined, branchId: string | null) => {
    if (!userId) return null;
    const [m, br] = await Promise.all([
      db().membership.findFirst({ where: { tenantId, userId, status: "active" }, include: { role: true, branches: { select: { branchId: true } } } }),
      branchId ? db().branch.findUnique({ where: { id: branchId }, select: { name: true } }) : null,
    ]);
    if (!m) throw badRequest("Pick someone in your team to get the leads.");
    if (!worksAt(m, branchId, br?.name)) throw badRequest(`They don't work at ${br?.name}. Give them that branch on the Team page first.`);
    if (!m.role.perms.includes("*") && !["leads.view", "messages.reply"].some((p) => m.role.perms.includes(p))) throw badRequest("Their role can't see leads. Pick someone who can, or leave it unassigned.");
    return userId;
  };
  const limitsFor = async (tenantId: string) => {
    const [lim, forms, month] = await Promise.all([formLimits(db(), tenantId), db().form.count({ where: { tenantId } }), db().formResponse.count({ where: { tenantId, createdAt: { gte: monthStart() } } })]);
    return { ...lim, used: forms, monthResponses: month };
  };
  const full = (f: FormRow, names: Map<string, string>) => ({
    id: f.id, status: f.status, slug: f.slug, url: link(f.slug), title: f.title, desc: f.description, tpl: f.tpl, fields: f.fields, dest: f.dest,
    thanks: f.thanks, style: f.style, places: f.places, pay: f.pay, assignee: f.assigneeId, assigneeName: f.assigneeId ? names.get(f.assigneeId) ?? null : null,
    branchId: f.branchId, created: f.createdAt.toISOString().slice(0, 10), publishedAt: f.publishedAt,
  });
  const audit = (ws: Workspace, ip: string, action: string, target: string) => db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip } });

  app.get("/forms", async (request) => {
    const ws = access(request);
    const where = await scope(ws, request);
    const [rows, counts, limits, team] = await Promise.all([
      db().form.findMany({ where, orderBy: { createdAt: "desc" } }),
      db().formResponse.groupBy({ by: ["formId"], where: { tenantId: ws.tenantId }, _count: true }),
      limitsFor(ws.tenantId),
      db().membership.findMany({ where: { tenantId: ws.tenantId, status: "active" }, select: { userId: true, user: { select: { userName: true } } } }),
    ]);
    const names = new Map(team.map((m) => [m.userId, m.user.userName]));
    const n = new Map(counts.map((c) => [c.formId, c._count]));
    return {
      data: {
        forms: rows.map((f) => ({ ...full(f, names), fields: undefined, style: undefined, pay: undefined, answerable: (f.fields as unknown as FormField[]).filter((x) => x.type !== "section" && x.type !== "page").length, responses: n.get(f.id) ?? 0 })),
        limits, site, team: team.map((m) => ({ id: m.userId, name: m.user.userName })),
      },
    };
  });

  app.post("/forms", big, async (request) => {
    const ws = access(request);
    const b = Body.parse(request.body);
    const lim = await limitsFor(ws.tenantId);
    if (lim.forms !== -1 && lim.used >= lim.forms) throw badRequest(`Your plan includes ${lim.forms} forms. Upgrade to add more.`);
    const branchId = branchFor(await branchView(db(), request, ws), b.branchId);
    const f = await db().form.create({
      data: {
        tenantId: ws.tenantId, branchId, title: b.title, description: b.desc, tpl: b.tpl ?? null, slug: await freeSlug(b.slug || b.title), fields: b.fields as Prisma.InputJsonValue,
        dest: b.dest, thanks: b.thanks, style: b.style, places: b.places, pay: b.pay, assigneeId: await checkAssignee(ws.tenantId, b.assignee, branchId), createdBy: ws.user.id,
      },
    });
    await audit(ws, request.ip, "form.created", f.title);
    return { status: 201, message: "Form created.", data: { id: f.id, slug: f.slug, url: link(f.slug) } };
  });

  app.get<{ Params: { id: string } }>("/forms/:id", async (request) => {
    const ws = access(request);
    const f = await one(ws, request, request.params.id);
    const u = f.assigneeId ? await db().user.findUnique({ where: { id: f.assigneeId }, select: { id: true, userName: true } }) : null;
    return { data: full(f, new Map(u ? [[u.id, u.userName]] : [])) };
  });

  // Saves the whole form (the builder saves a moment after each change). A live form must stay answerable.
  app.put<{ Params: { id: string } }>("/forms/:id", big, async (request) => {
    const ws = access(request);
    const f = await one(ws, request, request.params.id);
    const b = Body.parse(request.body);
    const branchId = b.branchId !== undefined && b.branchId !== f.branchId ? branchFor(await branchView(db(), request, ws), b.branchId) : f.branchId;
    if (f.status === "live") { const p = publishProblem(b.fields, b.pay); if (p) throw badRequest(`${p} (The form is live; unpublish it to save it half-done.)`); }
    const slug = b.slug !== undefined && slugify(b.slug) !== f.slug ? await freeSlug(b.slug, f.id) : f.slug;
    await db().form.update({
      where: { id: f.id },
      data: {
        title: b.title, description: b.desc, tpl: b.tpl === undefined ? undefined : b.tpl, slug, fields: b.fields as Prisma.InputJsonValue, dest: b.dest, thanks: b.thanks,
        style: b.style, places: b.places, pay: b.pay, branchId, assigneeId: b.assignee === undefined ? undefined : await checkAssignee(ws.tenantId, b.assignee, branchId),
      },
    });
    return { message: "Saved.", data: { slug, url: link(slug) } };
  });

  app.patch<{ Params: { id: string } }>("/forms/:id/assignee", async (request) => {
    const ws = access(request);
    const f = await one(ws, request, request.params.id);
    const { assignee } = z.object({ assignee: z.string().max(40).nullable() }).parse(request.body);
    await db().form.update({ where: { id: f.id }, data: { assigneeId: await checkAssignee(ws.tenantId, assignee, f.branchId) } });
    return { message: assignee ? "New leads go to them." : "New leads stay unassigned." };
  });

  app.post<{ Params: { id: string } }>("/forms/:id/publish", async (request) => {
    const ws = access(request);
    const f = await one(ws, request, request.params.id);
    const p = publishProblem(FieldsSchema.parse(f.fields), Pay.parse(f.pay));
    if (p) throw badRequest(p);
    if (f.status !== "live") {
      await db().form.update({ where: { id: f.id }, data: { status: "live", publishedAt: f.publishedAt ?? new Date() } });
      await audit(ws, request.ip, "form.published", f.title);
    }
    return { message: "Your form is live.", data: { url: link(f.slug) } };
  });

  app.post<{ Params: { id: string } }>("/forms/:id/unpublish", async (request) => {
    const ws = access(request);
    const f = await one(ws, request, request.params.id);
    await db().form.update({ where: { id: f.id }, data: { status: "draft" } });
    await audit(ws, request.ip, "form.unpublished", f.title);
    return { message: "Unpublished. The link shows the form is closed." };
  });

  // Removing a form removes its responses; the Inbox leads they made stay.
  app.delete<{ Params: { id: string } }>("/forms/:id", async (request) => {
    const ws = access(request);
    const f = await one(ws, request, request.params.id);
    await db().form.delete({ where: { id: f.id } });
    await audit(ws, request.ip, "form.removed", f.title);
    return { message: `${f.title} removed. Its leads stay in the Inbox.` };
  });

  // ───── Responses ─────
  const RespQ = z.object({ formId: z.string().max(40).optional(), dest: z.enum(["leads", "jobs", "requirements", "all"]).default("all"), take: z.coerce.number().int().min(1).max(5000).default(500) });
  const responses = async (ws: Workspace, request: FastifyRequest, q: z.infer<typeof RespQ>) => {
    const forms = await db().form.findMany({ where: { ...(await scope(ws, request)), ...(q.formId ? { id: q.formId } : {}), ...(q.dest !== "all" ? { dest: q.dest } : {}) }, select: { id: true, title: true, dest: true, fields: true } });
    const byId = new Map(forms.map((f) => [f.id, f]));
    const rows = await db().formResponse.findMany({ where: { tenantId: ws.tenantId, formId: { in: forms.map((f) => f.id) } }, orderBy: { createdAt: "desc" }, take: q.take });
    return { forms, rows: rows.map((r) => ({ r, form: byId.get(r.formId)! })) };
  };

  app.get("/forms/responses", async (request) => {
    const ws = access(request);
    const { rows, forms } = await responses(ws, request, RespQ.parse(request.query));
    return {
      data: rows.map(({ r, form }) => {
        const answers = r.answers as unknown as Answer[];
        const files = answers.filter((a) => a.type === "file" || a.type === "payment").map((a) => ({ label: a.label, name: (a.value as { name?: string }).name ?? "file", file: (a.value as { file?: string }).file ?? null })).filter((x) => x.file);
        const rest = answers.filter((a) => !["short", "phone", "email", "file", "payment"].includes(a.type));
        return {
          id: r.id, formId: r.formId, formTitle: form.title, dest: form.dest, at: r.createdAt.toISOString(), name: r.name, phone: r.phone, email: r.email, leadId: r.leadId,
          answers: answers.map((a) => [a.label, a.text]), summary: rest.slice(0, 3).map((a) => a.text).join(" · ") || form.title,
          pay: r.payAmount != null ? { amount: r.payAmount, status: r.payStatus ?? "to_confirm" } : null, files,
        };
      }),
      formsCount: forms.length,
    };
  });

  // One row per response; with a form picked, one column per question of that form.
  app.get("/forms/responses.csv", async (request, reply) => {
    const ws = access(request);
    const q = RespQ.parse({ ...(request.query as object), take: 5000 });
    const { rows, forms } = await responses(ws, request, q);
    const cell = (v: unknown) => { let x = v == null ? "" : String(v); if (/^[=+@-]/.test(x) && Number.isNaN(Number(x))) x = `'${x}`; return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const picked = q.formId ? forms[0] : null;
    const qs = picked ? (picked.fields as unknown as FormField[]).filter((f) => f.type !== "section" && f.type !== "page") : [];
    const head = ["Date", "Form", "Goes to", "Name", "Phone", "Email", ...(picked ? qs.map((f) => f.label) : ["Answers"]), "Payment", "Payment status"];
    const lines = rows.map(({ r, form }) => {
      const a = r.answers as unknown as Answer[];
      const at = new Date(r.createdAt.getTime() + 5.75 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
      return [at, form.title, DEST_LABEL[form.dest] ?? form.dest, r.name, r.phone, r.email, ...(picked ? qs.map((f) => a.find((x) => x.id === f.id)?.text ?? "") : [a.map((x) => `${x.label}: ${x.text}`).join(" | ")]), r.payAmount ?? "", r.payAmount != null ? r.payStatus : ""];
    });
    const body = "\uFEFF" + [head, ...lines].map((l) => l.map(cell).join(",")).join("\r\n");
    return reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", `attachment; filename="${picked ? slugify(picked.title) : "form"}-responses.csv"`).send(body);
  });

  app.patch<{ Params: { id: string } }>("/forms/responses/:id", async (request) => {
    const ws = access(request);
    const { pay } = z.object({ pay: z.enum(["confirmed", "rejected", "to_confirm"]) }).parse(request.body);
    const r = await db().formResponse.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId, form: await scope(ws, request) } });
    if (!r) throw notFound("Response not found.");
    if (r.payAmount == null) throw badRequest("This response has no payment.");
    await db().formResponse.update({ where: { id: r.id }, data: { payStatus: pay } });
    if (r.leadId && pay === "confirmed") await db().lead.updateMany({ where: { id: r.leadId, tenantId: ws.tenantId }, data: { value: BigInt(r.payAmount) } });
    await audit(ws, request.ip, `form.payment_${pay}`, `${r.name}: Rs. ${r.payAmount}`);
    return { message: pay === "confirmed" ? "Payment confirmed." : pay === "rejected" ? "Payment rejected." : "Marked to confirm." };
  });

  app.get<{ Params: { id: string; name: string } }>("/forms/responses/:id/files/:name", async (request, reply) => {
    const ws = access(request);
    const r = await db().formResponse.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId, form: await scope(ws, request) } });
    const a = (r?.answers as unknown as Answer[] | undefined)?.find((x) => (x.value as { file?: string } | null)?.file === request.params.name);
    const file = a ? await readPrivateFile(app.config.MEDIA_DIR, "forms", request.params.name) : null;
    if (!file) throw notFound("File not found.");
    const shown = ((a!.value as { name?: string }).name ?? "file").replace(/[^\w .()-]/g, "");
    return reply.header("content-type", file.type).header("content-disposition", `inline; filename="${shown}"`).header("cache-control", "private, no-store").send(file.data);
  });
}
