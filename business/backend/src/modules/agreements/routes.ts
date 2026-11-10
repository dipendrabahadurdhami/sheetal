// Agreements (Business → Agreements): make an agreement from a template, fill it in, send it for e-signing, follow the
// signatures, cancel, and print the signed copy.
// Where it fits: the panel's live Agreements page (LiveAgreements.jsx); people sign on the website (/sign/<token>,
// website/backend/src/modules/sign). Templates and the filling-in are in backend-core/src/domain/agreements.ts.
// How it works: a draft can be made from a lease (Rentals), a lead (Inbox) or a listing, which fills the parties and
// terms. While a draft, the wording, values and signers can change; the response carries the filled texts as a
// preview. Sending checks nothing is missing, freezes the texts with their SHA-256, gives each signer a private link
// (only its hash is kept) and emails it. "Send link again" makes a new link for someone who hasn't signed.
// Rules: agreements.manage (owners, managers); plans with the agreements feature; branch people only see their
// branches'; a sent agreement never changes (cancel it and make a new draft instead); a signed one can't be cancelled.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Agreement, AgreementSigner, Prisma } from "@prisma/client";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { AppError, badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { newToken, sha256 } from "@sheetal/backend-core/lib/secrets";
import { nepalDay } from "@sheetal/backend-core/domain/payouts";
import { AGREEMENT_PERM, KINDS, LANGS, SignersInput, TEMPLATES, agreementNo, hashOf, maskEmail, nepalTime, parseValues, render, roleLabel, sendProblem, type Kind, type SignerIn } from "@sheetal/backend-core/domain/agreements";
import { branchFor, branchView, inView, workspaceOf, type Workspace } from "../access.js";

type Full = Agreement & { signers: AgreementSigner[] };
const Body = z.object({
  title: z.string().trim().min(1, "Give the agreement a title.").max(160),
  lang: z.enum(LANGS),
  values: z.record(z.string(), z.unknown()).default({}),
  bodyEn: z.string().max(30_000).default(""),
  bodyNe: z.string().max(30_000).default(""),
  signers: SignersInput.default([]),
});
const Create = z.object({
  kind: z.enum(KINDS),
  lang: z.enum(LANGS).default("both"),
  leaseId: z.string().max(40).nullish(),
  leadId: z.string().max(40).nullish(),
  listingId: z.number().int().positive().nullish(),
  branchId: z.string().max(40).nullish(),
});

export async function agreementRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const site = app.config.SITE_URL.replace(/\/+$/, "");
  const access = (request: FastifyRequest) => {
    const ws = workspaceOf(request);
    if (!ws.can(AGREEMENT_PERM)) throw forbidden("Your role can't make agreements. Ask the owner.");
    const features = (ws.member.tenant.plan.features ?? {}) as Record<string, boolean>;
    if (!features.agreements) throw forbidden("Agreements come with the Business and Pro plans. Upgrade in Billing.");
    return ws;
  };
  const scope = async (ws: Workspace, request: FastifyRequest) => ({ tenantId: ws.tenantId, ...inView(await branchView(db(), request, ws)) });
  const one = async (ws: Workspace, request: FastifyRequest, id: string): Promise<Full> => {
    const a = await db().agreement.findFirst({ where: { ...(await scope(ws, request)), id: id.slice(0, 40) }, include: { signers: { orderBy: { sort: "asc" } } } });
    if (!a) throw notFound("Agreement not found.");
    return a;
  };
  const audit = (ws: Workspace, ip: string, action: string, target: string) => db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip } });
  const ORDER = { p1: 0, p2: 1, witness: 2 } as Record<string, number>;

  const present = (a: Full, detail = false) => {
    const ref = agreementNo(a.seq);
    const base = {
      id: a.id, ref, kind: a.kind, title: a.title, lang: a.lang, status: a.status, branchId: a.branchId,
      createdAt: a.createdAt, sentAt: a.sentAt, signedAt: a.signedAt, cancelledAt: a.cancelledAt, leaseId: a.leaseId, leadId: a.leadId,
      signers: a.signers.map((s) => ({
        id: s.id, role: s.role, roleLabel: roleLabel(a.kind as Kind, s.role), name: s.name, status: s.status, signedAt: s.signedAt,
        ...(detail ? { nameNe: s.nameNe, email: s.email, phone: s.phone, address: s.address, addressNe: s.addressNe, idNo: s.idNo, ip: s.ip, channel: s.channel, signedName: s.signedName, signedTime: s.signedAt ? nepalTime(s.signedAt) : null, codeSent: !!s.otpSentAt } : {}),
      })),
    };
    if (!detail) return base;
    const live = a.status === "draft";
    const r = live ? render(a, a.signers) : { texts: { ...(a.textEn != null ? { en: a.textEn } : {}), ...(a.textNe != null ? { ne: a.textNe } : {}) }, missing: {} };
    return { ...base, values: a.values, bodyEn: a.bodyEn, bodyNe: a.bodyNe, hash: a.hash, cancelNote: a.cancelNote, texts: r.texts, missing: r.missing, problem: live ? sendProblem(a, a.signers) : null };
  };

  const templates = () => KINDS.map((k) => { const t = TEMPLATES[k]; return { kind: k, label: t.label, roles: t.roles, fields: t.fields, businessSide: t.businessSide ?? null, bodyEn: t.body.en, bodyNe: t.body.ne }; });

  app.get("/agreements", async (request) => {
    const ws = access(request);
    const rows = await db().agreement.findMany({ where: await scope(ws, request), orderBy: { createdAt: "desc" }, take: 1000, include: { signers: { orderBy: { sort: "asc" } } } });
    return { data: { templates: templates(), rows: rows.map((a) => present(a)) } };
  });

  app.get<{ Params: { id: string } }>("/agreements/:id", async (request) => {
    const ws = access(request);
    return { data: present(await one(ws, request, request.params.id), true) };
  });

  // A new draft from a template, filled from a lease, a lead or a listing when one is given.
  app.post("/agreements", async (request) => {
    const ws = access(request);
    const b = Create.parse(request.body);
    const v = await branchView(db(), request, ws);
    const t = TEMPLATES[b.kind];
    const today = nepalDay();
    const tenant = ws.member.tenant;
    const values: Record<string, unknown> = { date: today };
    for (const f of t.fields) if (f.default !== undefined && values[f.key] === undefined) values[f.key] = f.default;
    if (t.fields.some((f) => f.key === "business")) values.business = { en: tenant.name, ne: "" };
    const signers: SignerIn[] = [];
    const add = (s: Partial<SignerIn> & { role: SignerIn["role"] }) => signers.push(SignerInput(s));
    const me = { name: ws.user.userName ?? "", email: ws.user.email ?? "" };
    let branchId: string | null = null;
    let title = t.label.en;
    let listingId = b.listingId ?? null;

    if (b.leaseId) {
      const l = await db().rentLease.findFirst({ where: { id: b.leaseId, tenantId: ws.tenantId, ...inView(v) }, include: { unit: { include: { owner: true } } } });
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
      const l = await db().lead.findFirst({ where: { id: b.leadId, tenantId: ws.tenantId, ...inView(v) } });
      if (!l) throw notFound("Lead not found.");
      branchId = branchId ?? l.branchId;
      listingId = listingId ?? l.listingId;
      const role = b.kind === "management" ? "p1" : "p2";
      if (!signers.some((s) => s.role === role)) add({ role, name: l.name, email: l.email ?? "", phone: l.phone ?? "" });
      title = `${t.label.en}: ${l.name}`;
    }
    if (listingId) {
      const l = await db().listing.findFirst({ where: { id: listingId, tenantId: ws.tenantId } });
      if (l) {
        branchId = branchId ?? l.branchId;
        if (!values.property) values.property = { en: `${l.title} (${l.code})`, ne: "" };
        values.address = { en: [l.street, l.area, l.city, l.district].filter(Boolean).join(", "), ne: "" };
        if (b.kind === "sale" && l.price != null && l.purpose === "sale") values.price = Number(l.price);
        if (b.kind === "rent" && l.price != null && l.purpose === "rent" && values.rent == null) values.rent = Number(l.price);
        if (!b.leaseId && !b.leadId) title = `${t.label.en}: ${l.code}`;
      }
    }
    if (t.businessSide && !signers.some((s) => s.role === t.businessSide)) add({ role: t.businessSide, ...me });
    const { values: clean } = parseValues(b.kind, values);
    const a = await db().agreement.create({
      data: {
        tenantId: ws.tenantId, branchId: branchId ?? branchFor(v, b.branchId), kind: b.kind, title: title.slice(0, 160), lang: b.lang, values: clean as Prisma.InputJsonValue,
        bodyEn: t.body.en, bodyNe: t.body.ne, leaseId: b.leaseId ?? null, leadId: b.leadId ?? null, listingId, createdBy: ws.user.id,
        signers: { create: signers.map((s) => ({ ...s, id: undefined, sort: ORDER[s.role] ?? 3 })) },
      },
    });
    await audit(ws, request.ip, "agreement.created", `${agreementNo(a.seq)} ${a.title}`);
    return { status: 201, message: "Draft made. Check the details, then send it for signing.", data: { id: a.id } };
  });

  app.put<{ Params: { id: string } }>("/agreements/:id", async (request) => {
    const ws = access(request);
    const a = await one(ws, request, request.params.id);
    if (a.status !== "draft") throw badRequest("Sent agreements can't change. Cancel it and make a new draft instead.");
    const b = Body.parse(request.body);
    const { values, errors } = parseValues(a.kind as Kind, b.values);
    if (Object.keys(errors).length) throw new AppError(422, "validation", "Check the highlighted details.", errors);
    const keep = new Set(b.signers.map((s) => s.id).filter(Boolean));
    await db().$transaction(async (tx) => {
      await tx.agreement.update({ where: { id: a.id }, data: { title: b.title, lang: b.lang, values: values as Prisma.InputJsonValue, bodyEn: b.bodyEn, bodyNe: b.bodyNe } });
      await tx.agreementSigner.deleteMany({ where: { agreementId: a.id, id: { notIn: [...keep] as string[] } } });
      for (const s of b.signers) {
        const { id, ...data } = s;
        const row = { ...data, sort: ORDER[s.role] ?? 3 };
        if (id && a.signers.some((x) => x.id === id)) await tx.agreementSigner.update({ where: { id }, data: row });
        else await tx.agreementSigner.create({ data: { ...row, agreementId: a.id } });
      }
    });
    return { message: "Saved.", data: present(await one(ws, request, a.id), true) };
  });

  const linkMail = (a: Full, business: string, s: { name: string; email: string }, token: string, again = false) => {
    const ref = agreementNo(a.seq);
    const link = `${site}/sign/${token}`;
    const en = `Namaste ${s.name},\n\n${business} ${again ? "has sent you the signing link again for" : "has sent you an agreement to sign"}: ${a.title} (${ref}).\n\nOpen this link to read it and sign. You will get a 6-digit code by email to confirm it is you:\n${link}\n\nThe link is only for you. Don't forward it.`;
    const ne = `नमस्ते,\n\n${business} ले तपाईंलाई हस्ताक्षरका लागि सम्झौता पठाएको छ (${ref})। तलको लिंक खोली सम्झौता पढ्नुहोस् र हस्ताक्षर गर्नुहोस्। तपाईं नै हो भनी पुष्टि गर्न इमेलमा ६ अङ्कको कोड आउनेछ:\n${link}\n\nयो लिंक तपाईंका लागि मात्र हो। अरूलाई नपठाउनुहोस्।`;
    const text = a.lang === "ne" ? ne : a.lang === "both" ? `${en}\n\n———\n\n${ne}` : en;
    return app.mailer.send({ to: s.email, subject: `${again ? "Reminder: sign" : "Please sign"}: ${a.title} (${ref})`, text: `${text}\n\nSheetal Property` });
  };

  app.post<{ Params: { id: string } }>("/agreements/:id/send", async (request) => {
    const ws = access(request);
    const a = await one(ws, request, request.params.id);
    if (a.status !== "draft") throw badRequest("This agreement was already sent.");
    const p = sendProblem(a, a.signers);
    if (p) throw badRequest(p);
    const ref = agreementNo(a.seq);
    const { texts } = render(a, a.signers);
    const hash = hashOf({ ref, title: a.title, lang: a.lang }, texts, a.signers);
    const tokens = new Map(a.signers.map((s) => [s.id, newToken()]));
    const done = await db().$transaction(async (tx) => {
      const n = await tx.agreement.updateMany({ where: { id: a.id, status: "draft" }, data: { status: "sent", sentAt: new Date(), textEn: texts.en ?? null, textNe: texts.ne ?? null, hash } });
      if (!n.count) return false;
      for (const s of a.signers) await tx.agreementSigner.update({ where: { id: s.id }, data: { tokenHash: sha256(tokens.get(s.id)!), status: "pending", otpHash: null, otpSends: 0, otpTries: 0 } });
      return true;
    });
    if (!done) throw badRequest("This agreement was already sent.");
    const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, select: { name: true } });
    for (const s of a.signers) await linkMail(a, tenant.name, s, tokens.get(s.id)!);
    await audit(ws, request.ip, "agreement.sent", `${ref} ${a.title}`);
    return { message: `Sent to ${a.signers.length} people. Each gets a link and signs with a code sent to their email.` };
  });

  app.post<{ Params: { id: string; signerId: string } }>("/agreements/:id/signers/:signerId/remind", async (request) => {
    const ws = access(request);
    const a = await one(ws, request, request.params.id);
    if (a.status !== "sent") throw badRequest("Only agreements waiting for signatures can be sent again.");
    const s = a.signers.find((x) => x.id === request.params.signerId);
    if (!s) throw notFound("That person isn't on this agreement.");
    if (s.status === "signed") throw badRequest(`${s.name} has already signed.`);
    const token = newToken();
    await db().agreementSigner.update({ where: { id: s.id }, data: { tokenHash: sha256(token), otpHash: null, otpSends: 0, otpTries: 0, otpSentAt: null } });
    const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, select: { name: true } });
    await linkMail(a, tenant.name, s, token, true);
    await audit(ws, request.ip, "agreement.reminded", `${agreementNo(a.seq)} ${s.name}`);
    return { message: `New link sent to ${maskEmail(s.email)}. The old link no longer works.` };
  });

  app.post<{ Params: { id: string } }>("/agreements/:id/cancel", async (request) => {
    const ws = access(request);
    const a = await one(ws, request, request.params.id);
    const { note } = z.object({ note: z.string().trim().max(300).default("") }).parse(request.body ?? {});
    if (a.status === "signed") throw badRequest("Everyone has signed this agreement, so it can't be cancelled here. Make a new agreement to change or end it.");
    if (a.status === "cancelled") throw badRequest("Already cancelled.");
    await db().$transaction([
      db().agreement.update({ where: { id: a.id }, data: { status: "cancelled", cancelledAt: new Date(), cancelNote: note || null } }),
      db().agreementSigner.updateMany({ where: { agreementId: a.id }, data: { otpHash: null } }),
    ]);
    if (a.status === "sent") {
      const tenant = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, select: { name: true } });
      for (const s of a.signers.filter((x) => x.email)) {
        await app.mailer.send({ to: s.email, subject: `Cancelled: ${a.title} (${agreementNo(a.seq)})`, text: `Namaste ${s.name},\n\n${tenant.name} cancelled the agreement "${a.title}" (${agreementNo(a.seq)}). You don't need to sign it.${note ? `\n\nNote: ${note}` : ""}\n\nSheetal Property` });
      }
    }
    await audit(ws, request.ip, "agreement.cancelled", `${agreementNo(a.seq)} ${a.title}`);
    return { message: "Cancelled. The signing links no longer work." };
  });

  // A new draft with the same wording, values and people (to fix a sent or cancelled one).
  app.post<{ Params: { id: string } }>("/agreements/:id/copy", async (request) => {
    const ws = access(request);
    const a = await one(ws, request, request.params.id);
    const c = await db().agreement.create({
      data: {
        tenantId: ws.tenantId, branchId: a.branchId, kind: a.kind, title: a.title, lang: a.lang, values: a.values as Prisma.InputJsonValue, bodyEn: a.bodyEn, bodyNe: a.bodyNe,
        leaseId: a.leaseId, leadId: a.leadId, listingId: a.listingId, createdBy: ws.user.id,
        signers: { create: a.signers.map((s) => ({ role: s.role, name: s.name, nameNe: s.nameNe, email: s.email, phone: s.phone, address: s.address, addressNe: s.addressNe, idNo: s.idNo, sort: s.sort })) },
      },
    });
    await audit(ws, request.ip, "agreement.copied", `${agreementNo(a.seq)} → ${agreementNo(c.seq)}`);
    return { status: 201, message: "New draft made from it.", data: { id: c.id } };
  });

  app.delete<{ Params: { id: string } }>("/agreements/:id", async (request) => {
    const ws = access(request);
    const a = await one(ws, request, request.params.id);
    if (a.status !== "draft") throw badRequest("Only drafts can be removed. Cancel a sent agreement instead; it stays on record.");
    await db().agreement.delete({ where: { id: a.id } });
    await audit(ws, request.ip, "agreement.removed", `${agreementNo(a.seq)} ${a.title}`);
    return { message: "Draft removed." };
  });
}

const SignerInput = (s: Partial<SignerIn> & { role: SignerIn["role"] }): SignerIn => ({ ...s, name: s.name ?? "", nameNe: s.nameNe ?? "", email: (s.email ?? "").trim().toLowerCase(), phone: s.phone ?? "", address: s.address ?? "", addressNe: s.addressNe ?? "", idNo: s.idNo ?? "" });
