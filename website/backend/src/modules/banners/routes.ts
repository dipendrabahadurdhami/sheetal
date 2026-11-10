// Home page banners on the website: what shows behind the title and search today, and counting views and clicks.
// Where it fits: the home page hero (website/frontend/src/pages/Home.jsx). Businesses book banners in Business →
// Promote; Sheetal checks the pictures (Admin → Promote). Rules are in backend-core/src/domain/banners.ts.
// Rules: only approved banners on their dates; bots don't count; rate limited per address.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cached } from "@sheetal/backend-core/lib/cache";
import { dbOf } from "@sheetal/backend-core/lib/db";
import { isBotRequest } from "@sheetal/backend-core/lib/bots";
import { mediaBase } from "@sheetal/backend-core/lib/photos";
import { liveBanners } from "@sheetal/backend-core/domain/banners";
import { today } from "@sheetal/backend-core/domain/promote";

export async function bannerRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const media = mediaBase(app.config);
  const pic = (f: string) => `${media}/banner/main/${encodeURIComponent(f)}`;

  app.get("/banners", async () =>
    cached(app.cache, `banners:${today()}`, 60, async () => {
      const rows = await liveBanners(db());
      return { status: 200, data: rows.map((b) => ({ id: b.id, desktop: pic(b.desktop), mobile: pic(b.mobile), link: b.link, title: b.title, button: b.button, sponsored: b.source === "paid" })) };
    }));

  const count = async (ids: string[], field: "views" | "clicks", headers: Record<string, unknown>) => {
    if (!ids.length || isBotRequest(headers as { "user-agent"?: string })) return;
    await db().banner.updateMany({ where: { id: { in: ids }, status: "approved" }, data: { [field]: { increment: 1 } } });
  };
  app.post("/banners/seen", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const b = z.object({ ids: z.array(z.string().max(40)).max(10) }).parse(request.body);
    await count([...new Set(b.ids)], "views", request.headers);
    return { status: 200 };
  });
  app.post("/banners/click", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const b = z.object({ id: z.string().max(40) }).parse(request.body);
    await count([b.id], "clicks", request.headers);
    return { status: 200 };
  });
}
