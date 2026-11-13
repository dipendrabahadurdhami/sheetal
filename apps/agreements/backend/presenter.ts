// How an agreement is shown to the business panel: the list row, and the detail with the filled texts (a draft is rendered live).
// Where it fits: AgreementService answers with these. Moved unchanged from business/backend/src/modules/agreements/routes.ts (P2-W1 stage 3); rows now carry `version`.
// Rules: a signer's private link and code are never shown; only whether a code was sent.

import { KINDS, TEMPLATES, agreementNo, nepalTime, render, roleLabel, sendProblem, type Kind } from "@sheetal/backend-core/domain/agreements";
import type { Full } from "./types.js";

export function present(a: Full, detail = false) {
  const ref = agreementNo(a.seq);
  const base = {
    id: a.id, ref, kind: a.kind, title: a.title, lang: a.lang, status: a.status, branchId: a.branchId, version: a.version,
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
}

export const templates = () => KINDS.map((k) => { const t = TEMPLATES[k]; return { kind: k, label: t.label, roles: t.roles, fields: t.fields, businessSide: t.businessSide ?? null, bodyEn: t.body.en, bodyNe: t.body.ne }; });
