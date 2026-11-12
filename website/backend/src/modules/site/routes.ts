// Public site settings: the few platform values the website needs before it draws anything.
// Where it fits: the website calls GET /v1/site once when it opens (SiteGate in website/frontend).
// How it works: returns the site name, languages, the Google Analytics id, the Search Console token and the
// maintenance message (only while maintenance is on). If the caller is signed-in Sheetal staff, `staff` is true so the
// site stays open for them while everyone else sees the maintenance page.
// Rules: nothing secret ever goes out here; keys and tokens (Maps, WhatsApp, Cloudflare) are not part of this answer.

import type { FastifyInstance } from "fastify";
import { dbOf } from "@sheetal/platform/db/client";
import { publicSite } from "@sheetal/backend-core/domain/platform";
import { PLATFORM_ROLES } from "@sheetal/backend-core/domain/permissions";
import { requireUser } from "@sheetal/backend-core/modules/auth/sessions";

export async function siteRoutes(app: FastifyInstance) {
  app.get("/site", async (request, reply) => {
    let staff = false;
    try { const role = requireUser(request).platformRole; staff = !!role && !!PLATFORM_ROLES[role]; } catch { /* not signed in */ }
    reply.header("cache-control", "private, no-store"); // the answer differs for staff and changes with maintenance mode
    return { data: { ...(await publicSite(dbOf(app))), staff } };
  });
}
