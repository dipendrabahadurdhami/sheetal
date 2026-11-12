// Developer keys: the keys a business's developer uses to call Sheetal's public API (Business → Website and API).
// Where it fits: LiveDevelopers.jsx; the keys are checked by website/backend/src/modules/public/routes.ts (/v1/public).
// How it works: a key looks like sk_live_<32 characters>; it is shown once when made, only its SHA-256 and the first 8
// characters after "sk_live_" (the prefix, to recognise it) are kept. A key has scopes (listings.read, leads.write,
// bookings.read), a last-used time, and can be revoked.
// Rules: only people who can change business settings; at most 20 active keys; creating and revoking are audited
// (never the key itself).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, forbidden, notFound } from "@sheetal/platform/core/errors";
import { newToken, sha256 } from "@sheetal/platform/auth/secrets";
import { workspaceOf, type Workspace } from "../access.js";

export const KEY_SCOPES = ["listings.read", "leads.write", "bookings.read"] as const;
const MAX_ACTIVE = 20;

export async function devKeyRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const need = (ws: Workspace) => { if (!ws.can("workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete")) throw forbidden("Your role can't manage developer keys."); };
  const audit = (ws: Workspace, ip: string, action: string, target?: string, meta?: object) =>
    db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action, target, ip, meta: meta as object | undefined } });

  app.get("/developers/keys", async (request) => {
    const ws = workspaceOf(request); need(ws);
    const rows = await db().apiKey.findMany({ where: { tenantId: ws.tenantId }, orderBy: { createdAt: "desc" }, take: 100 });
    return { data: rows.map((k) => ({ id: k.id, name: k.name, shown: `sk_live_${k.prefix}…`, scopes: k.scopes, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt, revoked: !!k.revokedAt })) };
  });

  app.post("/developers/keys", async (request) => {
    const ws = workspaceOf(request); need(ws);
    const b = z.object({ name: z.string().trim().min(2, "Give the key a name.").max(60), scopes: z.array(z.enum(KEY_SCOPES)).min(1, "Pick what the key may do.").max(3) }).parse(request.body);
    if ((await db().apiKey.count({ where: { tenantId: ws.tenantId, revokedAt: null } })) >= MAX_ACTIVE) throw badRequest(`You can have ${MAX_ACTIVE} keys at once. Revoke one you don't use.`);
    const secret = newToken(24);
    const key = `sk_live_${secret}`;
    const row = await db().apiKey.create({ data: { tenantId: ws.tenantId, name: b.name, prefix: secret.slice(0, 8), hash: sha256(key), scopes: [...new Set(b.scopes)], createdBy: ws.user.id } });
    await audit(ws, request.ip, "developers.key_create", row.id, { name: b.name, scopes: row.scopes });
    // The only time the key is shown.
    return { status: 201, message: "Key made. Copy it now: it is shown only once.", data: { id: row.id, key } };
  });

  app.delete("/developers/keys/:id", async (request) => {
    const ws = workspaceOf(request); need(ws);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const k = await db().apiKey.findFirst({ where: { id, tenantId: ws.tenantId } });
    if (!k) throw notFound("That key isn't here.");
    if (!k.revokedAt) {
      await db().apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      await audit(ws, request.ip, "developers.key_revoke", id, { name: k.name });
    }
    return { status: 200, message: "Key revoked. It stops working now." };
  });
}
