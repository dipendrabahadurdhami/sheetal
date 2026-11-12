// Signing an agreement on the website (/sign/<token>): read it, get a 6-digit code by email, type it and your name.
// Where it fits: businesses send agreements from Business → Agreements (business/backend/src/modules/agreements);
// each person signing gets a private link. The page is website/frontend/src/pages/SignAgreement.jsx.
// How it works: the link's token is looked up by its SHA-256. GET shows the frozen texts, who has signed, and the
// signing record once everyone has. POST /code emails a new code (only its hash is kept). POST checks the code and
// records the signature: the typed name, the time, the address and browser. When the last person signs, the
// agreement becomes signed, everyone gets an email with their link to the signed copy, and the business is notified.
// Rules: codes last 10 minutes and allow 5 tries; 5 codes per link, at least a minute apart (the business can send a
// new link); cancelled agreements can't be signed; the texts never change after sending.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { AppError, badRequest, notFound } from "@sheetal/platform/core/errors";
import { safeEqual, sha256 } from "@sheetal/platform/auth/secrets";
import { notify, teamWith } from "@sheetal/platform/notify/index";
import { AGREEMENT_PERM, OTP_GAP_SECONDS, OTP_MINUTES, OTP_SENDS, OTP_TRIES, agreementNo, maskEmail, nepalTime, otpHash, roleLabel, type Kind } from "@sheetal/backend-core/domain/agreements";

export async function signRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const find = async (token: string) => {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound("This signing link isn't right. Ask the business to send it again.");
    const s = await db().agreementSigner.findUnique({ where: { tokenHash: sha256(token) }, include: { agreement: { include: { signers: { orderBy: { sort: "asc" } }, tenant: { select: { id: true, name: true, email: true, phone: true } } } } } });
    if (!s || s.agreement.status === "draft") throw notFound("This signing link isn't right, or a newer one was sent. Check your latest email from the business.");
    return s;
  };
  type Found = Awaited<ReturnType<typeof find>>;
  const view = (s: Found) => {
    const a = s.agreement;
    const kind = a.kind as Kind;
    const done = a.status === "signed";
    return {
      ref: agreementNo(a.seq), title: a.title, kind, lang: a.lang, status: a.status, hash: a.hash, sentAt: a.sentAt, signedAt: a.signedAt, cancelNote: a.status === "cancelled" ? a.cancelNote : null,
      business: { name: a.tenant.name },
      texts: { ...(a.textEn != null ? { en: a.textEn } : {}), ...(a.textNe != null ? { ne: a.textNe } : {}) },
      signers: a.signers.map((x) => ({
        role: x.role, roleLabel: roleLabel(kind, x.role), name: x.name, nameNe: x.nameNe, status: x.status, signedAt: x.signedAt,
        // The signing record shows on the signed copy for everyone.
        ...(done ? { email: maskEmail(x.email), signedName: x.signedName, signedTime: x.signedAt ? nepalTime(x.signedAt) : null, ip: x.ip, channel: x.channel } : {}),
      })),
      me: { role: s.role, name: s.name, email: maskEmail(s.email), signed: s.status === "signed", signedAt: s.signedAt, codeSent: !!(s.otpHash && s.otpExpires && s.otpExpires > new Date()), codesLeft: Math.max(0, OTP_SENDS - s.otpSends) },
    };
  };
  const open = (s: Found) => {
    if (s.agreement.status === "cancelled") throw new AppError(410, "cancelled", `${s.agreement.tenant.name} cancelled this agreement. You don't need to sign it.`);
    if (s.status === "signed") throw badRequest("You have already signed this agreement.");
  };
  const ua = (request: FastifyRequest) => String(request.headers["user-agent"] ?? "").slice(0, 300);

  app.get<{ Params: { token: string } }>("/sign/:token", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    return { status: 200, data: view(await find(request.params.token)) };
  });

  app.post<{ Params: { token: string } }>("/sign/:token/code", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (request) => {
    const s = await find(request.params.token);
    open(s);
    if (s.otpSends >= OTP_SENDS) throw badRequest(`That's the most codes for this link. Ask ${s.agreement.tenant.name} to send you the link again.`);
    if (s.otpSentAt && Date.now() - s.otpSentAt.getTime() < OTP_GAP_SECONDS * 1000) throw badRequest("A code was just sent. Wait a minute before asking for another.");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await db().agreementSigner.update({ where: { id: s.id }, data: { otpHash: otpHash(s.id, code), otpExpires: new Date(Date.now() + OTP_MINUTES * 60_000), otpTries: 0, otpSends: { increment: 1 }, otpSentAt: new Date() } });
    const a = s.agreement;
    const en = `Your code to sign "${a.title}" (${agreementNo(a.seq)}) is ${code}.\n\nIt works for ${OTP_MINUTES} minutes. Nobody from ${a.tenant.name} or Sheetal will ask you for it. If you didn't ask for it, ignore this email.`;
    const ne = `"${a.title}" (${agreementNo(a.seq)}) मा हस्ताक्षर गर्ने तपाईंको कोड ${code} हो।\n\nयो कोड ${OTP_MINUTES} मिनेटसम्म मात्र चल्छ। ${a.tenant.name} वा शीतलका कसैले पनि यो कोड माग्दैनन्। तपाईंले नमागेको भए यो इमेल बेवास्ता गर्नुहोस्।`;
    const text = a.lang === "ne" ? ne : a.lang === "both" ? `${en}\n\n———\n\n${ne}` : en;
    await app.mailer.send({ to: s.email, subject: `${code} is your signing code`, text: `${text}\n\nSheetal Property` });
    return { status: 200, message: `Code sent to ${maskEmail(s.email)}. It works for ${OTP_MINUTES} minutes.` };
  });

  app.post<{ Params: { token: string } }>("/sign/:token", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request) => {
    const b = z.object({
      code: z.string().trim().regex(/^\d{6}$/, "Type the 6-digit code from the email."),
      name: z.string().trim().min(2, "Type your full name.").max(120),
      agree: z.literal(true, { error: "Tick the box to say you agree." }),
    }).parse(request.body);
    const s = await find(request.params.token);
    open(s);
    if (!s.otpHash || !s.otpExpires || s.otpExpires < new Date() || s.otpTries >= OTP_TRIES) throw badRequest("That code has expired. Ask for a new one.", { code: ["Ask for a new code."] });
    if (!safeEqual(otpHash(s.id, b.code), s.otpHash)) {
      const left = OTP_TRIES - s.otpTries - 1;
      await db().agreementSigner.update({ where: { id: s.id }, data: { otpTries: { increment: 1 }, ...(left <= 0 ? { otpHash: null } : {}) } });
      throw badRequest(left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn't right, and it can't be used again. Ask for a new one.", { code: ["Check the code."] });
    }
    const a = s.agreement;
    const now = new Date();
    const result = await db().$transaction(async (tx) => {
      const n = await tx.agreementSigner.updateMany({ where: { id: s.id, status: "pending", otpHash: s.otpHash }, data: { status: "signed", signedAt: now, signedName: b.name, channel: "email", ip: request.ip, userAgent: ua(request), otpHash: null, otpExpires: null } });
      if (!n.count) return "again" as const;
      const left = await tx.agreementSigner.count({ where: { agreementId: a.id, status: "pending" } });
      if (left) return "signed" as const;
      const done = await tx.agreement.updateMany({ where: { id: a.id, status: "sent" }, data: { status: "signed", signedAt: now } });
      return done.count ? ("complete" as const) : ("signed" as const);
    });
    if (result === "again") throw badRequest("You have already signed this agreement.");

    const ref = agreementNo(a.seq);
    const branchPeople = await teamWith(db(), a.tenantId, [AGREEMENT_PERM], a.branchId);
    if (result === "complete") {
      // Everyone has signed: each person's own link now shows the signed copy (they can print it or save it as a PDF).
      const signers = await db().agreementSigner.findMany({ where: { agreementId: a.id } });
      for (const x of signers) {
        const en = `Namaste ${x.name},\n\nEveryone has signed "${a.title}" (${ref}) with ${a.tenant.name}.\n\nOpen the signing link from your earlier email to see the signed copy with the signing record. You can print it or save it as a PDF from there.\n\nFingerprint of the signed text (SHA-256): ${a.hash}`;
        const ne = `"${a.title}" (${ref}) मा सबैले हस्ताक्षर गरिसक्नुभएको छ।\n\nहस्ताक्षर भएको प्रति र हस्ताक्षर विवरण हेर्न पहिलेको इमेलमा आएको लिंक खोल्नुहोस्। त्यहाँबाट प्रिन्ट गर्न वा PDF बनाउन सकिन्छ।`;
        const text = a.lang === "ne" ? ne : a.lang === "both" ? `${en}\n\n———\n\n${ne}` : en;
        await app.mailer.send({ to: x.email, subject: `Signed by everyone: ${a.title} (${ref})`, text: `${text}\n\nSheetal Property` });
      }
      if (a.tenant.email) await app.mailer.send({ to: a.tenant.email, subject: `Signed by everyone: ${a.title} (${ref})`, text: `Everyone has signed "${a.title}" (${ref}).\n\nOpen it in Business → Agreements to print it or save it as a PDF.\n\nSheetal Property` });
      await notify(db(), [...branchPeople, a.createdBy], { tenantId: a.tenantId, type: "agreement", title: `Signed by everyone: ${a.title}`, message: ref, link: "/business/agreements" });
      return { status: 200, message: "Signed. Everyone has now signed: you can print the signed copy or save it as a PDF.", data: { complete: true } };
    }
    await notify(db(), [...branchPeople, a.createdBy], { tenantId: a.tenantId, type: "agreement", title: `${s.name} signed ${a.title}`, message: ref, link: "/business/agreements" });
    return { status: 200, message: "Signed. You'll get an email when everyone has signed.", data: { complete: false } };
  });
}
