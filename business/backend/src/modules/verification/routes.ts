import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { badRequest, forbidden, notFound } from "@sheetal/backend-core/lib/errors";
import { readPrivateFile, savePrivateFile } from "@sheetal/backend-core/lib/files";
import { notifyStaff } from "@sheetal/backend-core/lib/notify";
import { workspaceOf, type Workspace } from "../access.js";

// Business verification: the business sends its company registration and PAN/VAT certificate (and, if it likes, the
// owner's ID); Sheetal checks them and marks the business verified (a badge on the website) or sends it back with
// a reason. People who manage settings handle it. Documents are private files: only they and Sheetal staff open them.
// While a check is pending, or once verified, the documents are locked (Sheetal support can reopen).

export const DOC_KINDS = ["registration", "pan", "owner_id", "other"] as const;
const REQUIRED = ["registration", "pan"] as const;
const MAX_DOCS = 10;

export async function verificationRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const manage = (ws: Workspace) => { if (!ws.can("settings.business")) throw forbidden("Your role can't handle business verification."); };
  const status = async (ws: Workspace) => db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, select: { name: true, verification: true, verificationNote: true, verifiedAt: true } });
  const editable = (s: string) => { if (s === "pending") throw badRequest("Your documents are being checked. Wait for the result, or ask Sheetal support."); if (s === "verified") throw badRequest("Your business is verified. Ask Sheetal support to change documents."); };

  app.get("/verification", async (request) => {
    const ws = workspaceOf(request);
    manage(ws);
    const [t, docs] = await Promise.all([status(ws), db().verificationDoc.findMany({ where: { tenantId: ws.tenantId }, orderBy: { createdAt: "asc" } })]);
    return {
      data: {
        status: t.verification, note: t.verificationNote, verifiedAt: t.verifiedAt, required: REQUIRED,
        docs: docs.map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, size: d.size, at: d.createdAt })),
      },
    };
  });

  app.post("/verification/docs", { bodyLimit: 15 * 1024 * 1024, config: { rateLimit: { max: 40, timeWindow: "1 hour" } } }, async (request) => {
    const ws = workspaceOf(request);
    manage(ws);
    const b = z.object({ kind: z.enum(DOC_KINDS), filename: z.string().trim().max(120).optional(), data: z.string().min(16).max(14 * 1024 * 1024) }).parse(request.body);
    editable((await status(ws)).verification);
    if ((await db().verificationDoc.count({ where: { tenantId: ws.tenantId } })) >= MAX_DOCS) throw badRequest(`Up to ${MAX_DOCS} documents. Remove one first.`);
    const data = Buffer.from(b.data, "base64");
    const file = await savePrivateFile(app.config.MEDIA_DIR, "kyc", data);
    const d = await db().verificationDoc.create({ data: { tenantId: ws.tenantId, kind: b.kind, file, filename: b.filename?.replace(/[^\w .()-]/g, "_"), size: data.length, uploadedBy: ws.user.id } });
    return { message: "Document added.", data: { id: d.id } };
  });

  app.delete<{ Params: { id: string } }>("/verification/docs/:id", async (request) => {
    const ws = workspaceOf(request);
    manage(ws);
    editable((await status(ws)).verification);
    const r = await db().verificationDoc.deleteMany({ where: { id: request.params.id, tenantId: ws.tenantId } });
    if (!r.count) throw notFound("Document not found.");
    return { message: "Document removed." };
  });

  app.get<{ Params: { id: string } }>("/verification/docs/:id/file", async (request, reply) => {
    const ws = workspaceOf(request);
    manage(ws);
    const d = await db().verificationDoc.findFirst({ where: { id: request.params.id, tenantId: ws.tenantId } });
    const f = d ? await readPrivateFile(app.config.MEDIA_DIR, "kyc", d.file) : null;
    if (!f) throw notFound("Document not found.");
    return reply.header("content-type", f.type).header("cache-control", "private, no-store").send(f.data);
  });

  app.post("/verification/submit", async (request) => {
    const ws = workspaceOf(request);
    manage(ws);
    const t = await status(ws);
    editable(t.verification);
    const kinds = new Set((await db().verificationDoc.findMany({ where: { tenantId: ws.tenantId }, select: { kind: true } })).map((d) => d.kind));
    const missing = REQUIRED.filter((k) => !kinds.has(k));
    if (missing.length) throw badRequest(`Add the ${missing.map((k) => (k === "pan" ? "PAN/VAT certificate" : "company registration certificate")).join(" and ")} first.`);
    await db().tenant.update({ where: { id: ws.tenantId }, data: { verification: "pending", verificationNote: null } });
    await db().auditLog.create({ data: { actorId: ws.user.id, tenantId: ws.tenantId, action: "verification.submitted", target: t.name, ip: request.ip } });
    await notifyStaff(db(), "moderation.kyc", { type: "verification", title: "Business to verify", message: t.name, link: "/admin/moderation" });
    return { message: "Sent to Sheetal. We usually check documents within a working day." };
  });
}
