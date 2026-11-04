// Ask AI on the website, and visit tracking for analytics.
// Where it fits: the Ask AI box and every page view.
// How it works: Ask AI compares listings by their codes using public facts only; visits are counted per person.
// Rules: bots never become page views; they are only counted per day for Admin → System status.

import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { AppError, badRequest } from "@sheetal/backend-core/lib/errors";
import { isBotRequest, isSearchEngine } from "@sheetal/backend-core/lib/bots";
import { Vault } from "@sheetal/backend-core/lib/vault";
import { aiClient, compareListings, type AiClient } from "@sheetal/backend-core/lib/ai";
import { listingCard, mediaBase } from "../catalog/present.js";

const LIVE = { status: { in: ["published" as const, "sold" as const, "rented" as const] } };

export async function insightRoutes(app: FastifyInstance, opts: { ai?: { client: AiClient; model: string } }) {
  const db = () => dbOf(app);
  const vault = new Vault(app.config.SECRETS_KEY, app.config.NODE_ENV === "production");
  const base = mediaBase(app.config);

  app.post("/ask-ai", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request) => {
    const b = z.object({ property_codes: z.array(z.string().trim().max(20)).min(1).max(4), question: z.string().trim().max(500).optional() }).parse(request.body);
    const codes = [...new Set(b.property_codes.map((c) => c.replace(/^#/, "").toUpperCase()).map((c) => (/^\d+$/.test(c) ? `SP-${c.padStart(4, "0")}` : c)))];
    const rows = await db().listing.findMany({ where: { code: { in: codes }, ...LIVE }, include: { photos: { take: 1 } } });
    if (!rows.length) throw badRequest("Add a valid property code, like SP-0006.");
    const ai = opts.ai ?? (await aiClient(db(), vault));
    if (!ai) throw new AppError(503, "ai_off", "Ask AI isn't switched on yet.");
    // Only what the website shows publicly goes to the AI.
    const listings = rows.map((l) => {
      const c = listingCard(l, base);
      return { code: l.code, title: l.title, facts: { purpose: c.purpose, type: c.property_type, price: c.price, price_per: c.price_per, negotiable: c.price_negotiable, location: c.property_location, district: c.district,
        bedrooms: l.bedrooms, bathrooms: l.bathrooms, floors: l.floors, land: l.landArea, built: l.builtArea, road: l.roadAccess, facing: l.facing, furnishing: l.furnishing, facilities: l.facilities, status: c.property_status } };
    });
    const summary = await compareListings(db(), ai, { listings, question: b.question, userId: request.user?.id });
    return { status: 200, summary, data: { summary, codes: rows.map((r) => r.code) } };
  });

  app.post("/track-visit", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const h = request.headers as { "user-agent"?: string; "accept-language"?: string };
    const today = new Date().toISOString().slice(0, 10);
    if (isBotRequest(h)) {
      const kind = isSearchEngine(h["user-agent"]) ? "search_engine" : "bot";
      await db().botDay.upsert({ where: { day_kind: { day: today, kind } }, create: { day: today, kind, count: 1 }, update: { count: { increment: 1 } } });
      return reply.code(204).send();
    }
    const b = z.object({
      session_id: z.string().min(8).max(100), page_url: z.string().max(500), page_type: z.string().max(40).nullable().optional(),
      entity_id: z.union([z.string(), z.number()]).nullable().optional(), referrer: z.string().max(500).nullable().optional(),
    }).safeParse(request.body);
    if (!b.success) return reply.code(204).send();
    const listingId = b.data.page_type === "property" && b.data.entity_id != null && /^\d+$/.test(String(b.data.entity_id)) ? Number(b.data.entity_id) : null;
    const listing = listingId ? await db().listing.findUnique({ where: { id: listingId }, select: { id: true, tenantId: true } }) : null;
    // The referrer keeps only its site (no paths, no query strings that might carry personal data).
    let referrer: string | null = null;
    try { referrer = b.data.referrer ? new URL(b.data.referrer).hostname : null; } catch { referrer = null; }
    await db().pageView.create({ data: {
      session: createHash("sha256").update(b.data.session_id).digest("hex").slice(0, 32), path: b.data.page_url.split("?")[0]!.slice(0, 300), pageType: b.data.page_type ?? null,
      listingId: listing?.id ?? null, tenantId: listing?.tenantId ?? null, referrer, userId: request.user?.id ?? null,
    } });
    return reply.code(204).send();
  });

  app.post("/track-heartbeat", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (_request, reply) => reply.code(204).send());
}
