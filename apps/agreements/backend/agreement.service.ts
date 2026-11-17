// The rules of Agreements (business side), on the kernel (KERNEL.md section 7).
// Where it fits: AgreementController calls one method per route. Moved from business/backend/src/modules/agreements/routes.ts (P2-W1 stage 3), every rule and
// message unchanged. The website signing flow (/sign/<token>) is not here and is not changed.
// How it works: a draft is made from a template, filled from a lease (Rentals), a lead or a listing. While a draft, the wording, values and signers can change.
// Sending checks nothing is missing, freezes the texts with their SHA-256, gives each signer a private link (only its hash is kept) and emails it. "Send link
// again" makes a new link. Each change runs in ONE transaction with its audit line (the old action strings) and its event; emails go out after the commit.
// Rules: all four agreements.agreement.* permissions (owners, managers), checked first; then plans with the agreements feature; branch people only see their
// branches'; a sent agreement never changes (cancel it and make a new draft instead); a signed one can't be cancelled; only drafts are removed.

import { z } from "zod";
import { AppError, badRequest, forbidden, notFound, versionConflict } from "@sheetal/platform/core/errors";
import { monthStart, requireRoom } from "@sheetal/platform/billing/room";
import type { BusinessContext, DataScope } from "@sheetal/platform/core/context";
import type { EventBus } from "@sheetal/platform/core/events";
import { BaseService } from "@sheetal/platform/core/service";
import { newToken, sha256 } from "@sheetal/platform/auth/secrets";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { AGREEMENT_PERM, TEMPLATES, agreementNo, hashOf, maskEmail, parseValues, render, sendProblem, type Kind, type SignerIn } from "@sheetal/backend-core/domain/agreements";
import { AgreementRepository, type NewSigner } from "./agreement.repository.js";
import { AGREEMENT_EVENTS } from "./events.js";
import { cancelMail, linkMail, type Mailer } from "./mail.js";
import { present, templates } from "./presenter.js";
import { Body, CancelBody, Create } from "./schemas.js";
import { REFUSED } from "./scope.js";
import type { AgreementRow, Full } from "./types.js";

export interface AgreementServiceDeps { bus: EventBus; mailer: () => Mailer; site: string }

const ORDER: Record<string, number> = { p1: 0, p2: 1, witness: 2 };
const SignerInput = (s: Partial<SignerIn> & { role: SignerIn["role"] }): SignerIn => ({ ...s, name: s.name ?? "", nameNe: s.nameNe ?? "", email: (s.email ?? "").trim().toLowerCase(), phone: s.phone ?? "", address: s.address ?? "", addressNe: s.addressNe ?? "", idNo: s.idNo ?? "" });
const label = (a: { seq: number; title: string }) => `${agreementNo(a.seq)} ${a.title}`;

export class AgreementService extends BaseService<AgreementRow, never, never> {
  readonly agreements = new AgreementRepository();

  constructor(private readonly x: AgreementServiceDeps) {
    super({
      app: "agreements", resource: "agreement", repo: new AgreementRepository(),
      permissions: { read: AGREEMENT_PERM, create: AGREEMENT_PERM, update: AGREEMENT_PERM, delete: AGREEMENT_PERM },
      schemas: { create: z.never(), update: z.never() },
      audit: { entity: "agreement", label },
      bus: x.bus, requireVersion: false,
    });
  }

  /** The two refusals, in the old order: the role first, then the plan. Returns the data scope. */
  private access(ctx: BusinessContext): DataScope {
    const scope = ctx.permissions.require(AGREEMENT_PERM, REFUSED);
    if (!ctx.entitlements.feature("agreements")) throw forbidden("Agreements come with the Business and Pro plans. Upgrade in Billing.");
    return scope;
  }
  private change<R extends { a: { id: string; branchId: string | null; seq: number; title: string } }>(ctx: BusinessContext, name: string, audit: (r: R) => { action: string; target: string }, event: string, run: (tx: BusinessContext, scope: DataScope) => Promise<R>): Promise<R> {
    this.access(ctx);
    return this.action<R & { branchId: string | null }>(ctx, {
      name, permission: AGREEMENT_PERM, audit,
      event: (r) => ({ name: event, payload: { id: r.a.id, ref: agreementNo(r.a.seq) } }),
      run: async (tx, scope) => { const r = await run(tx, scope); return { ...r, branchId: r.a.branchId }; },
    });
  }

  // ───── Read ─────

  async overview(ctx: BusinessContext) {
    const scope = this.access(ctx);
    return { templates: templates(), rows: (await this.agreements.listFull(ctx, scope)).map((a) => present(a)) };
  }
  async detail(ctx: BusinessContext, id: string) {
    const scope = this.access(ctx);
    return present(await this.agreements.full(ctx, scope, id), true);
  }

  // ───── A new draft from a template, filled from a lease, a lead or a listing ─────

  async makeDraft(ctx: BusinessContext, raw: unknown) {
    this.access(ctx);
    const b = Create.parse(raw);
    // On app subscriptions: the Agreements edition's agreements a month (free 2).
    await requireRoom(ctx, "agreements", "agreements_per_month", () => ctx.db.agreement.count({ where: { tenantId: ctx.business.id, deletedAt: null, createdAt: { gte: monthStart(ctx.now) } } }));
    const t = TEMPLATES[b.kind];
    const { a } = await this.change(ctx, "create", (r) => ({ action: "agreement.created", target: label(r.a) }), AGREEMENT_EVENTS.created, async (tx, scope) => {
      const values: Record<string, unknown> = { date: nepalDay() };
      for (const f of t.fields) if (f.default !== undefined && values[f.key] === undefined) values[f.key] = f.default;
      if (t.fields.some((f) => f.key === "business")) values.business = { en: ctx.business.name, ne: "" };
      const signers: SignerIn[] = [];
      const add = (s: Partial<SignerIn> & { role: SignerIn["role"] }) => signers.push(SignerInput(s));
      let branchId: string | null = null;
      let title = t.label.en;
      let listingId = b.listingId ?? null;
      if (b.leaseId) {
        const l = await this.agreements.lease(tx, scope, b.leaseId);
        if (!l) throw notFound("Lease not found.");
        branchId = l.branchId;
        listingId = listingId ?? l.unit.listingId;
        const o = l.unit.owner;
        add({ role: "p1", name: o.name, email: o.email ?? "", phone: o.phone ?? "" });
        if (t.businessSide !== "p2") add({ role: "p2", name: l.renter, email: l.email ?? "", phone: l.phone ?? "" });
        if (b.kind === "rent") Object.assign(values, { property: { en: `${l.unit.kind} ${l.unit.name}, ${l.unit.property}`, ne: "" }, start: l.startOn.toISOString().slice(0, 10), end: l.endOn.toISOString().slice(0, 10), rent: l.rent, deposit: l.deposit, due_day: l.dueDay });
        if (b.kind === "management") Object.assign(values, { property: { en: l.unit.property, ne: "" }, fee_pct: o.feeBp / 100, bank: { en: o.bank ?? "", ne: "" } });
        title = `${t.label.en}: ${l.renter}, ${l.unit.property} ${l.unit.name}`;
      }
      if (b.leadId) {
        const l = await this.agreements.lead(tx, scope, b.leadId);
        if (!l) throw notFound("Lead not found.");
        branchId = branchId ?? l.branchId;
        listingId = listingId ?? l.listingId;
        const role = b.kind === "management" ? "p1" : "p2";
        if (!signers.some((s) => s.role === role)) add({ role, name: l.name, email: l.email ?? "", phone: l.phone ?? "" });
        title = `${t.label.en}: ${l.name}`;
      }
      if (listingId) {
        const l = await this.agreements.listing(tx, listingId);
        if (l) {
          branchId = branchId ?? l.branchId;
          if (!values.property) values.property = { en: `${l.title} (${l.code})`, ne: "" };
          values.address = { en: [l.street, l.area, l.city, l.district].filter(Boolean).join(", "), ne: "" };
          if (b.kind === "sale" && l.price != null && l.purpose === "sale") values.price = Number(l.price);
          if (b.kind === "rent" && l.price != null && l.purpose === "rent" && values.rent == null) values.rent = Number(l.price);
          if (!b.leaseId && !b.leadId) title = `${t.label.en}: ${l.code}`;
        }
      }
      if (t.businessSide && !signers.some((s) => s.role === t.businessSide)) add({ role: t.businessSide, ...(await this.agreements.me(tx)) });
      const { values: clean } = parseValues(b.kind, values);
      const a = await this.agreements.createWithSigners(tx, {
        branchId: branchId ?? tx.branches.branchForNew(b.branchId), kind: b.kind, title: title.slice(0, 160), lang: b.lang, values: clean as never,
        bodyEn: t.body.en, bodyNe: t.body.ne, leaseId: b.leaseId ?? null, leadId: b.leadId ?? null, listingId,
      }, signers.map((s) => ({ ...s, id: undefined, sort: ORDER[s.role] ?? 3 }) as NewSigner));
      return { a };
    });
    return { id: a.id };
  }

  // ───── Change a draft ─────

  async save(ctx: BusinessContext, id: string, raw: unknown) {
    const scope = this.access(ctx);
    const a0 = await this.agreements.full(ctx, scope, id);
    if (a0.status !== "draft") throw badRequest("Sent agreements can't change. Cancel it and make a new draft instead.");
    const b = Body.parse(raw);
    const { values, errors } = parseValues(a0.kind as Kind, b.values);
    if (Object.keys(errors).length) throw new AppError(422, "validation", "Check the highlighted details.", errors);
    await this.change(ctx, "update", (r) => ({ action: "agreement.updated", target: label(r.a) }), AGREEMENT_EVENTS.updated, async (tx, sc) => {
      const a = await this.agreements.full(tx, sc, id);
      if (b.version !== undefined && b.version !== a.version) throw versionConflict("This agreement");
      const ok = await this.agreements.saveDraft(tx, a, { title: b.title, lang: b.lang, values: values as never, bodyEn: b.bodyEn, bodyNe: b.bodyNe },
        b.signers.map((s) => ({ ...s, sort: ORDER[s.role] ?? 3 }) as NewSigner & { id?: string }), b.version);
      if (!ok) throw badRequest("Sent agreements can't change. Cancel it and make a new draft instead.");
      return { a };
    });
    return present(await this.agreements.full(ctx, scope, id), true);
  }

  // ───── Send for signing, send a link again ─────

  async send(ctx: BusinessContext, id: string) {
    const scope = this.access(ctx);
    const a = await this.agreements.full(ctx, scope, id);
    if (a.status !== "draft") throw badRequest("This agreement was already sent.");
    const p = sendProblem(a, a.signers);
    if (p) throw badRequest(p);
    const { texts } = render(a, a.signers);
    const hash = hashOf({ ref: agreementNo(a.seq), title: a.title, lang: a.lang }, texts, a.signers);
    const tokens = new Map(a.signers.map((s) => [s.id, newToken()]));
    await this.change(ctx, "send", (r) => ({ action: "agreement.sent", target: label(r.a) }), AGREEMENT_EVENTS.sent, async (tx) => {
      if (!(await this.agreements.markSent(tx, a, texts, hash, new Map([...tokens].map(([k, v]) => [k, sha256(v)]))))) throw badRequest("This agreement was already sent.");
      return { a };
    });
    const business = await this.agreements.businessName(ctx);
    for (const s of a.signers) await linkMail(this.x.mailer(), this.x.site, a, business, s, tokens.get(s.id)!);
    return { message: `Sent to ${a.signers.length} people. Each gets a link and signs with a code sent to their email.` };
  }

  async remind(ctx: BusinessContext, id: string, signerId: string) {
    const scope = this.access(ctx);
    const a = await this.agreements.full(ctx, scope, id);
    if (a.status !== "sent") throw badRequest("Only agreements waiting for signatures can be sent again.");
    const s = a.signers.find((x) => x.id === signerId);
    if (!s) throw notFound("That person isn't on this agreement.");
    if (s.status === "signed") throw badRequest(`${s.name} has already signed.`);
    const token = newToken();
    await this.change(ctx, "remind", () => ({ action: "agreement.reminded", target: `${agreementNo(a.seq)} ${s.name}` }), AGREEMENT_EVENTS.reminded, async (tx) => {
      await this.agreements.newLink(tx, s, sha256(token));
      return { a };
    });
    await linkMail(this.x.mailer(), this.x.site, a, await this.agreements.businessName(ctx), s, token, true);
    return { message: `New link sent to ${maskEmail(s.email)}. The old link no longer works.` };
  }

  // ───── Cancel, copy, remove ─────

  async cancel(ctx: BusinessContext, id: string, raw: unknown) {
    const scope = this.access(ctx);
    const a = await this.agreements.full(ctx, scope, id);
    const { note } = CancelBody.parse(raw ?? {});
    if (a.status === "signed") throw badRequest("Everyone has signed this agreement, so it can't be cancelled here. Make a new agreement to change or end it.");
    if (a.status === "cancelled") throw badRequest("Already cancelled.");
    await this.change(ctx, "cancel", (r) => ({ action: "agreement.cancelled", target: label(r.a) }), AGREEMENT_EVENTS.cancelled, async (tx) => {
      if (!(await this.agreements.cancel(tx, a, note))) throw badRequest("Everyone has signed this agreement, so it can't be cancelled here. Make a new agreement to change or end it.");
      return { a };
    });
    if (a.status === "sent") {
      const business = await this.agreements.businessName(ctx);
      for (const s of a.signers.filter((x) => x.email)) await cancelMail(this.x.mailer(), a, business, s, note);
    }
    return { message: "Cancelled. The signing links no longer work." };
  }

  async copy(ctx: BusinessContext, id: string) {
    const scope = this.access(ctx);
    const a = await this.agreements.full(ctx, scope, id);
    const { c } = await this.change<{ a: AgreementRow; c: AgreementRow }>(ctx, "copy", (r) => ({ action: "agreement.copied", target: `${agreementNo(a.seq)} → ${agreementNo(r.a.seq)}` }), AGREEMENT_EVENTS.created, async (tx) => {
      const c = await this.agreements.createWithSigners(tx, {
        branchId: a.branchId, kind: a.kind, title: a.title, lang: a.lang, values: a.values as never, bodyEn: a.bodyEn, bodyNe: a.bodyNe,
        leaseId: a.leaseId, leadId: a.leadId, listingId: a.listingId,
      }, a.signers.map((s) => ({ role: s.role, name: s.name, nameNe: s.nameNe, email: s.email, phone: s.phone, address: s.address, addressNe: s.addressNe, idNo: s.idNo, sort: s.sort })));
      return { a: c, c };
    });
    return { id: c.id };
  }

  async removeDraft(ctx: BusinessContext, id: string) {
    const scope = this.access(ctx);
    const a = await this.agreements.full(ctx, scope, id);
    if (a.status !== "draft") throw badRequest("Only drafts can be removed. Cancel a sent agreement instead; it stays on record.");
    await this.change(ctx, "remove", (r) => ({ action: "agreement.removed", target: label(r.a) }), AGREEMENT_EVENTS.removed, async (tx) => {
      if (!(await this.agreements.removeDraft(tx, a))) throw badRequest("Only drafts can be removed. Cancel a sent agreement instead; it stays on record.");
      return { a };
    });
    return { message: "Draft removed." };
  }
}
