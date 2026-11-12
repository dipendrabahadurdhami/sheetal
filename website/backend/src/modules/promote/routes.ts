// Counting how boosted listings do: the website tells the API when a boosted card was shown and when it was opened.
// Where it fits: PropertyCard on the website sends these for cards marked sponsored; Business → Promote shows the
// numbers (with the leads that came in on the listing, counted from the Inbox).
// How it works: each call adds to the boosts running today for those listings in that place.
// Rules: search engines and bots don't count; at most 50 listings a call; rate limited per address.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dbOf } from "@sheetal/platform/db/client";
import { isBotRequest } from "@sheetal/backend-core/lib/bots";
import { dayOf } from "@sheetal/backend-core/domain/money";
import { PLACES, today } from "@sheetal/backend-core/domain/promote";

export async function promoteRoutes(app: FastifyInstance) {
  const db = () => dbOf(app);
  const count = async (place: string, ids: number[], field: "views" | "clicks", headers: Record<string, unknown>) => {
    if (!ids.length || isBotRequest(headers as { "user-agent"?: string })) return;
    const d = dayOf(today());
    await db().boost.updateMany({ where: { listingId: { in: ids }, place, status: "paid", startOn: { lte: d }, endOn: { gte: d } }, data: { [field]: { increment: 1 } } });
  };

  app.post("/promote/seen", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
    const b = z.object({ place: z.enum(PLACES), ids: z.array(z.number().int().positive()).max(50) }).parse(request.body);
    await count(b.place, [...new Set(b.ids)], "views", request.headers);
    return { status: 200 };
  });

  app.post("/promote/click", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
    const b = z.object({ place: z.enum(PLACES), id: z.number().int().positive() }).parse(request.body);
    await count(b.place, [b.id], "clicks", request.headers);
    return { status: 200 };
  });
}
