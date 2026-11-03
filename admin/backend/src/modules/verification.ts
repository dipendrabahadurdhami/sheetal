import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, notFound } from "@sheetal/backend-core/lib/errors";
import { readPrivateFile } from "@sheetal/backend-core/lib/files";
import { notify, teamWith } from "@sheetal/backend-core/lib/notify";
import { staffOf } from "./routes.js";

// Business verification for staff with "moderation.kyc": the businesses that sent documents, each document opened
// here only, and the decision: verified (a badge on the website), sent back with a reason, or reopened so the
// business can change its documents. The business's settings people are told in their bell; the owner by email.

export async function adminVerificationRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);

  app.get("/admin/verifications", async (request) => {
    staffOf(request, "moderation.kyc");
    const q = z.object({ status: z.enum(["pending", "verified", "rejected", "all"]).default("pending") }).parse(request.query);
    const rows = await db().tenant.findMany({
      where: q.status === "all" ? { verification: { not: "none" } } : { verification: q.status },
      include: { verificationDocs: { orderBy: { createdAt: "asc" } }, memberships: { where: { role: { key: "owner" }, status: "active" }, include: { user: { select: { email: true, userName: true } } }, take: 1 } },
      orderBy: { updatedAt: "desc" }, take: 200,
    });
    const sent = new Map((await db().auditLog.findMany({ where: { action: "verification.submitted", tenantId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "desc" }, select: { tenantId: true, createdAt: true } })).reverse().map((a) => [a.tenantId, a.createdAt]));
    return {
      data: rows.map((t) => ({
        id: t.id, name: t.name, type: t.type, city: t.city, pan: t.pan, address: t.address, status: t.verification, note: t.verificationNote, verifiedAt: t.verifiedAt, sentAt: sent.get(t.id) ?? null,
        owner: t.memberships[0] ? { name: t.memberships[0].user.userName, email: t.memberships[0].user.email } : null,
        docs: t.verificationDocs.map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, size: d.size, at: d.createdAt })),
      })),
    };
  });

  app.get<{ Params: { id: string } }>("/admin/verifications/docs/:id/file", async (request, reply) => {
    staffOf(request, "moderation.kyc");
    const d = await db().verificationDoc.findUnique({ where: { id: request.params.id } });
    const f = d ? await readPrivateFile(app.config.MEDIA_DIR, "kyc", d.file) : null;
    if (!f) throw notFound("Document not found.");
    return reply.header("content-type", f.type).header("cache-control", "private, no-store").send(f.data);
  });

  app.post<{ Params: { tenantId: string } }>("/admin/verifications/:tenantId/review", async (request) => {
    const s = staffOf(request, "moderation.kyc");
    const b = z.object({ decision: z.enum(["verify", "reject", "reopen"]), note: z.string().trim().max(500).optional() }).parse(request.body);
    const t = await db().tenant.findUnique({ where: { id: request.params.tenantId }, include: { memberships: { where: { role: { key: "owner" }, status: "active" }, include: { user: { select: { email: true, userName: true } } }, take: 1 } } });
    if (!t) throw notFound("Business not found.");
    if (b.decision === "verify" && t.verification !== "pending") throw badRequest("This business hasn't sent documents to check.");
    if (b.decision === "reject" && !b.note) throw badRequest("Say what's wrong, so the business can fix it.");
    const data = b.decision === "verify" ? { verification: "verified", verificationNote: null, verifiedAt: new Date() }
      : b.decision === "reject" ? { verification: "rejected", verificationNote: b.note!, verifiedAt: null }
      : { verification: "none", verificationNote: b.note ?? null, verifiedAt: null };
    await db().tenant.update({ where: { id: t.id }, data });
    await db().auditLog.create({ data: { actorId: s.user.id, tenantId: t.id, action: `verification.${b.decision === "verify" ? "verified" : b.decision === "reject" ? "rejected" : "reopened"}`, target: t.name, ip: request.ip, meta: b.note ? { note: b.note } : undefined } });
    const title = b.decision === "verify" ? `${t.name} is verified` : b.decision === "reject" ? "Verification needs changes" : "You can change your verification documents";
    const message = b.decision === "verify" ? "A Verified badge now shows on your website listings and agency page." : b.note ?? "";
    await notify(db(), await teamWith(db(), t.id, ["settings.business"]), { tenantId: t.id, type: "verification", title, message, link: "/business/settings/verification" });
    const owner = t.memberships[0]?.user;
    if (owner) {
      const site = app.config.SITE_URL.replace(/\/$/, "");
      await app.mailer.send({ to: owner.email, subject: title, text: `Namaste ${owner.userName},\n\n${b.decision === "verify" ? `${t.name} is now verified on Sheetal Property. ${message}` : `${title}: ${message}\n\nOpen Settings, Verification in your business panel to update your documents:\n${site}/business/settings/verification`}\n\nSheetal Property` });
    }
    return { message: b.decision === "verify" ? `${t.name} is verified.` : b.decision === "reject" ? "Sent back with your note." : "Reopened: the business can change its documents." };
  });
}
