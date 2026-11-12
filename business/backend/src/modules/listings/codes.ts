// Settings → Listings → Property code: the prefix this business's listing codes start with (ER-0123).
// Where it fits: BusinessSettings.jsx (CodePrefix.jsx) reads and saves it; new listings use it (listings/routes.ts).
// How it works: saving a new prefix gives every listing of the business the new code at once; the old code is kept as
// an alias, so it still finds the listing on the website. See backend-core/src/domain/codes.ts.
// Rules: settings.business changes it; anyone in the business can read it.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { badRequest, forbidden } from "@sheetal/platform/core/errors";
import { PREFIX_RE, initialsOf, listingCode, recodeListings } from "@sheetal/backend-core/domain/codes";
import { workspaceOf } from "../access.js";

export async function listingCodeRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);

  app.get("/listings/code-prefix", async (request) => {
    const ws = workspaceOf(request);
    const t = await db().tenant.findUniqueOrThrow({ where: { id: ws.tenantId }, select: { name: true, codePrefix: true } });
    const suggested = initialsOf(t.name);
    const prefix = t.codePrefix || suggested;
    return { data: { prefix, custom: !!t.codePrefix, suggested, sample: listingCode(prefix, 123), canChange: ws.can("workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete") } };
  });

  app.put("/listings/code-prefix", async (request) => {
    const ws = workspaceOf(request);
    if (!ws.can("workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete")) throw forbidden("Your role can't change business settings.");
    const b = z.object({ prefix: z.string().trim().toUpperCase().regex(PREFIX_RE, "Use 2 to 5 letters or numbers, starting with a letter.") }).parse(request.body);
    if (b.prefix === "TMP") throw badRequest("TMP can't be used. Choose another prefix.");
    let changed = 0;
    try {
      changed = await db().$transaction(async (tx) => {
        await tx.tenant.update({ where: { id: ws.tenantId }, data: { codePrefix: b.prefix } });
        return recodeListings(tx, ws.tenantId, b.prefix);
      });
    } catch (e) {
      if ((e as { code?: string; meta?: { code?: string } }).code === "P2010" || /unique/i.test(String((e as Error).message))) throw badRequest("Another listing already uses one of those codes. Choose another prefix.");
      throw e;
    }
    await db().auditLog.create({ data: { tenantId: ws.tenantId, actorId: ws.user.id, action: "listing.code_prefix", target: b.prefix, ip: request.ip, meta: { changed } } });
    return { message: changed ? `Saved. ${changed} listing${changed > 1 ? "s" : ""} now start with ${b.prefix}-. Old codes still find them.` : `Saved. New listings start with ${b.prefix}-.`, data: { prefix: b.prefix, changed } };
  });
}
