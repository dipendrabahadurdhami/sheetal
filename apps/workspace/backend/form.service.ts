// The rules of online forms (Business → Forms) on the kernel: build, publish and share forms, and read the responses. Moved from
// business/backend/src/modules/forms/routes.ts in P2-W6 (Workspace part 2); every rule, message, status code and audit string unchanged.
// Where it fits: FormController calls one method per route (LiveForms.jsx). The public side (a live form, taking answers) is in
// website/backend/src/modules/forms; every response there becomes an Inbox lead.
// How it works: a form belongs to a branch (its team gets the leads) and has a slug unique across Sheetal, so its link is SITE_URL/f/<slug>. Drafts can be
// saved half-done; publishing checks the form can be answered and that a Payment field has somewhere to pay. Responses are listed per form or
// destination, downloaded as CSV, and payment screenshots are confirmed or rejected here. Each change runs in ONE transaction with its audit line and its
// event. The builder saves a moment after each change, so a save writes its event but no audit line (as before: the Team activity list would fill up).
// A save may send `version`: a stale one is refused (409).
// Rules: people who reply to messages, see leads or manage the business settings, on the branches in view; the plan's form limit counts every form of the
// business; files are private and only streamed from here.

import { z } from "zod";
import type { Form as FormRow, Prisma } from "@prisma/client";
import { badRequest, conflict, forbidden, notFound } from "@sheetal/platform/core/errors";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseRepository, type BusinessEntity } from "@sheetal/platform/core/repository";
import { BaseService } from "@sheetal/platform/core/service";
import { worksAt } from "@sheetal/backend-core/domain/branches";
import { hasPerm } from "@sheetal/backend-core/domain/permissions";
import { DESTS, DEST_LABEL, FieldsSchema, publishProblem, slugify, type Answer, type FormField } from "@sheetal/backend-core/domain/forms";
import { FormRepository, type InView } from "./form.repository.js";
import { SETTINGS_PERM } from "./workspace.service.js";

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
  version: z.number().int().min(1).optional(),
});
export const RespQ = z.object({ formId: z.string().max(40).optional(), dest: z.enum(["leads", "jobs", "requirements", "all"]).default("all"), take: z.coerce.number().int().min(1).max(5000).default(500) });
type Line = { audit: { action: string; target: string } | null; event: { name: string; payload: object; branchId?: string | null } };

class FormBase extends BaseRepository<BusinessEntity, never, never> {
  constructor() { super({ model: "form", branchField: "branchId", ownerField: null, label: "This form", filterable: {}, sortable: ["createdAt"], defaultSort: [{ field: "createdAt", dir: "desc" }] }); }
}
export interface FormDeps { bus: EventBus; siteUrl: string; readFile: (name: string) => Promise<{ type: string; data: Buffer } | null> }

export class FormService extends BaseService<BusinessEntity, never, never> {
  readonly forms = new FormRepository();
  readonly site: string;
  constructor(private readonly x: FormDeps) {
    super({ app: "workspace", resource: "form", repo: new FormBase(), permissions: { read: SETTINGS_PERM, create: SETTINGS_PERM, update: SETTINGS_PERM, delete: SETTINGS_PERM },
      schemas: { create: z.never(), update: z.never() }, audit: { entity: "form", label: (f) => f.id }, bus: x.bus, requireVersion: false });
    this.site = x.siteUrl.replace(/\/+$/, "");
  }
  private link(slug: string) { return `${this.site}/f/${slug}`; }
  private write<R>(ctx: BusinessContext, run: (tx: BusinessContext) => Promise<R>, after: (r: R) => Line): Promise<R> {
    this.refuseReadOnly(ctx);
    return this.inTransaction(ctx, async (tx) => {
      const r = await run(tx);
      const a = after(r);
      if (a.audit) await this.writeAudit(tx, a.audit.action, a.audit.target);
      await this.deps.bus.publish(tx, a.event.name, a.event.payload, 1, { branchId: a.event.branchId ?? null });
      return r;
    });
  }
  /** The same people as the menu: reply to messages, see leads, or manage the business settings. */
  private access(ctx: BusinessContext) {
    const can = (p: string) => ctx.permissions.can(p);
    if (!can("crm.message.reply") && !can("crm.lead.read") && !can(SETTINGS_PERM)) throw forbidden("Your role can't use forms.");
  }
  private inView(ctx: BusinessContext): InView { const ids = ctx.branches.idsFor("branch"); return ids ? { branchId: { in: [...ids] } } : {}; }
  private async one(ctx: BusinessContext, id: string) {
    const f = await this.forms.one(ctx, this.inView(ctx), id);
    if (!f) throw notFound("Form not found.");
    return f;
  }
  /** A slug nobody else uses: the one asked for, or with -2, -3… after it. */
  private async freeSlug(ctx: BusinessContext, want: string, selfId?: string) {
    const base = slugify(want);
    for (let i = 1; i < 200; i++) {
      const s = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
      const other = await this.forms.slugOwner(ctx, s);
      if (!other || other.id === selfId) return s;
    }
    return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
  }
  /** The person new leads go to: in the team, working at the form's branch, with a role that sees leads. */
  private async checkAssignee(ctx: BusinessContext, userId: string | null | undefined, branchId: string | null) {
    if (!userId) return null;
    const [m, br] = await Promise.all([this.forms.member(ctx, userId), branchId ? this.forms.branchName(ctx, branchId) : null]);
    if (!m) throw badRequest("Pick someone in your team to get the leads.");
    if (!worksAt(m, branchId, br?.name)) throw badRequest(`They don't work at ${br?.name}. Give them that branch on the Team page first.`);
    if (!["crm.lead.read", "crm.message.reply"].some((p) => hasPerm(m.role.perms, p))) throw badRequest("Their role can't see leads. Pick someone who can, or leave it unassigned.");
    return userId;
  }
  private full(f: FormRow, names: Map<string, string>) {
    return {
      id: f.id, status: f.status, slug: f.slug, url: this.link(f.slug), title: f.title, desc: f.description, tpl: f.tpl, fields: f.fields, dest: f.dest,
      thanks: f.thanks, style: f.style, places: f.places, pay: f.pay, assignee: f.assigneeId, assigneeName: f.assigneeId ? names.get(f.assigneeId) ?? null : null,
      branchId: f.branchId, created: f.createdAt.toISOString().slice(0, 10), publishedAt: f.publishedAt, version: (f as { version?: number }).version,
    };
  }

  async browse(ctx: BusinessContext) {
    this.access(ctx);
    const [rows, counts, limits, team] = await Promise.all([this.forms.forms(ctx, this.inView(ctx)), this.forms.responseCounts(ctx), this.forms.limits(ctx), this.forms.team(ctx)]);
    const names = new Map(team.map((m) => [m.userId, m.user.userName]));
    const n = new Map(counts.map((c) => [c.formId, c._count]));
    return {
      forms: rows.map((f) => ({ ...this.full(f, names), fields: undefined, style: undefined, pay: undefined, answerable: (f.fields as unknown as FormField[]).filter((x) => x.type !== "section" && x.type !== "page").length, responses: n.get(f.id) ?? 0 })),
      limits, site: this.site, team: team.map((m) => ({ id: m.userId, name: m.user.userName })),
    };
  }

  async makeForm(ctx: BusinessContext, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.access(ctx);
    const b = Body.parse(raw);
    const lim = await this.forms.limits(ctx);
    if (lim.forms !== -1 && lim.used >= lim.forms) throw badRequest(`Your plan includes ${lim.forms} forms. Upgrade to add more.`);
    const branchId = ctx.branches.branchForNew(b.branchId);
    const slug = await this.freeSlug(ctx, b.slug || b.title);
    const assigneeId = await this.checkAssignee(ctx, b.assignee, branchId);
    const f = await this.write(ctx, (tx) => this.forms.create(tx, {
      branchId, title: b.title, description: b.desc, tpl: b.tpl ?? null, slug, fields: b.fields as Prisma.InputJsonValue,
      dest: b.dest, thanks: b.thanks, style: b.style, places: b.places, pay: b.pay, assigneeId,
    }), (f) => ({ audit: { action: "form.created", target: f.title }, event: { name: "workspace.form.created", payload: { id: f.id }, branchId } }));
    return { status: 201, message: "Form created.", data: { id: f.id, slug: f.slug, url: this.link(f.slug) } };
  }

  async openForm(ctx: BusinessContext, id: string) {
    this.access(ctx);
    const f = await this.one(ctx, id);
    const u = f.assigneeId ? await this.forms.userName(ctx, f.assigneeId) : null;
    return this.full(f, new Map(u ? [[u.id, u.userName]] : []));
  }

  // Saves the whole form (the builder saves a moment after each change). A live form must stay answerable.
  async saveForm(ctx: BusinessContext, id: string, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.access(ctx);
    const f = await this.one(ctx, id);
    const b = Body.parse(raw);
    const branchId = b.branchId !== undefined && b.branchId !== f.branchId ? ctx.branches.branchForNew(b.branchId) : f.branchId;
    if (f.status === "live") { const p = publishProblem(b.fields, b.pay); if (p) throw badRequest(`${p} (The form is live; unpublish it to save it half-done.)`); }
    const slug = b.slug !== undefined && slugify(b.slug) !== f.slug ? await this.freeSlug(ctx, b.slug, f.id) : f.slug;
    const assigneeId = b.assignee === undefined ? undefined : await this.checkAssignee(ctx, b.assignee, branchId);
    await this.write(ctx, async (tx) => {
      const ok = await this.forms.change(tx, f.id, {
        title: b.title, description: b.desc, tpl: b.tpl === undefined ? undefined : b.tpl, slug, fields: b.fields as Prisma.InputJsonValue, dest: b.dest, thanks: b.thanks,
        style: b.style, places: b.places, pay: b.pay, branchId, assigneeId,
      }, b.version);
      if (!ok) throw conflict("Someone else changed this form. Reload to see the latest.");
    }, () => ({ audit: null, event: { name: "workspace.form.saved", payload: { id: f.id }, branchId } }));
    return { message: "Saved.", data: { slug, url: this.link(slug) } };
  }

  async setAssignee(ctx: BusinessContext, id: string, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.access(ctx);
    const f = await this.one(ctx, id);
    const { assignee } = z.object({ assignee: z.string().max(40).nullable() }).parse(raw);
    const assigneeId = await this.checkAssignee(ctx, assignee, f.branchId);
    await this.write(ctx, (tx) => this.forms.change(tx, f.id, { assigneeId }),
      () => ({ audit: { action: "form.assigned", target: f.title }, event: { name: "workspace.form.saved", payload: { id: f.id }, branchId: f.branchId } }));
    return { message: assignee ? "New leads go to them." : "New leads stay unassigned." };
  }

  async publish(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    this.access(ctx);
    const f = await this.one(ctx, id);
    const p = publishProblem(FieldsSchema.parse(f.fields), Pay.parse(f.pay));
    if (p) throw badRequest(p);
    if (f.status !== "live") {
      await this.write(ctx, (tx) => this.forms.change(tx, f.id, { status: "live", publishedAt: f.publishedAt ?? new Date() }),
        () => ({ audit: { action: "form.published", target: f.title }, event: { name: "workspace.form.published", payload: { id: f.id }, branchId: f.branchId } }));
    }
    return { message: "Your form is live.", data: { url: this.link(f.slug) } };
  }

  async unpublish(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    this.access(ctx);
    const f = await this.one(ctx, id);
    await this.write(ctx, (tx) => this.forms.change(tx, f.id, { status: "draft" }),
      () => ({ audit: { action: "form.unpublished", target: f.title }, event: { name: "workspace.form.unpublished", payload: { id: f.id }, branchId: f.branchId } }));
    return { message: "Unpublished. The link shows the form is closed." };
  }

  // Removing a form removes its responses; the Inbox leads they made stay.
  async removeForm(ctx: BusinessContext, id: string) {
    this.refuseReadOnly(ctx);
    this.access(ctx);
    const f = await this.one(ctx, id);
    await this.write(ctx, (tx) => this.forms.remove(tx, f.id),
      () => ({ audit: { action: "form.removed", target: f.title }, event: { name: "workspace.form.removed", payload: { id: f.id }, branchId: f.branchId } }));
    return { message: `${f.title} removed. Its leads stay in the Inbox.` };
  }

  // ───── Responses ─────
  private async pick(ctx: BusinessContext, q: z.infer<typeof RespQ>) {
    const forms = await this.forms.formsFor(ctx, this.inView(ctx), q);
    const byId = new Map(forms.map((f) => [f.id, f]));
    const rows = await this.forms.responses(ctx, forms.map((f) => f.id), q.take);
    return { forms, rows: rows.map((r) => ({ r, form: byId.get(r.formId)! })) };
  }
  async responses(ctx: BusinessContext, rawQuery: unknown) {
    this.access(ctx);
    const { rows, forms } = await this.pick(ctx, RespQ.parse(rawQuery));
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
  }
  // One row per response; with a form picked, one column per question of that form.
  async responsesCsv(ctx: BusinessContext, rawQuery: unknown) {
    this.access(ctx);
    const q = RespQ.parse({ ...(rawQuery as object), take: 5000 });
    const { rows, forms } = await this.pick(ctx, q);
    const cell = (v: unknown) => { let x = v == null ? "" : String(v); if (/^[=+@-]/.test(x) && Number.isNaN(Number(x))) x = `'${x}`; return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const picked = q.formId ? forms[0] : null;
    const qs = picked ? (picked.fields as unknown as FormField[]).filter((f) => f.type !== "section" && f.type !== "page") : [];
    const head = ["Date", "Form", "Goes to", "Name", "Phone", "Email", ...(picked ? qs.map((f) => f.label) : ["Answers"]), "Payment", "Payment status"];
    const lines = rows.map(({ r, form }) => {
      const a = r.answers as unknown as Answer[];
      const at = new Date(r.createdAt.getTime() + 5.75 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
      return [at, form.title, DEST_LABEL[form.dest] ?? form.dest, r.name, r.phone, r.email, ...(picked ? qs.map((f) => a.find((x) => x.id === f.id)?.text ?? "") : [a.map((x) => `${x.label}: ${x.text}`).join(" | ")]), r.payAmount ?? "", r.payAmount != null ? r.payStatus : ""];
    });
    return { body: "﻿" + [head, ...lines].map((l) => l.map(cell).join(",")).join("\r\n"), filename: `${picked ? slugify(picked.title) : "form"}-responses.csv` };
  }
  async checkPayment(ctx: BusinessContext, id: string, raw: unknown) {
    this.refuseReadOnly(ctx);
    this.access(ctx);
    const { pay } = z.object({ pay: z.enum(["confirmed", "rejected", "to_confirm"]) }).parse(raw);
    const r = await this.forms.response(ctx, this.inView(ctx), id);
    if (!r) throw notFound("Response not found.");
    if (r.payAmount == null) throw badRequest("This response has no payment.");
    await this.write(ctx, async (tx) => {
      await this.forms.setPayment(tx, r.id, pay);
      if (r.leadId && pay === "confirmed") await this.forms.leadValue(tx, r.leadId, BigInt(r.payAmount!));
    }, () => ({ audit: { action: `form.payment_${pay}`, target: `${r.name}: Rs. ${r.payAmount}` }, event: { name: "workspace.response.checked", payload: { id: r.id, pay } } }));
    return { message: pay === "confirmed" ? "Payment confirmed." : pay === "rejected" ? "Payment rejected." : "Marked to confirm." };
  }
  async file(ctx: BusinessContext, id: string, name: string) {
    this.access(ctx);
    const r = await this.forms.response(ctx, this.inView(ctx), id);
    const a = (r?.answers as unknown as Answer[] | undefined)?.find((x) => (x.value as { file?: string } | null)?.file === name);
    const file = a ? await this.x.readFile(name) : null;
    if (!file) throw notFound("File not found.");
    return { ...file, shown: ((a!.value as { name?: string }).name ?? "file").replace(/[^\w .()-]/g, "") };
  }
}
