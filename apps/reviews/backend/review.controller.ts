// The HTTP side of Reviews: the two routes, exactly as the page calls them (KERNEL.md 10.7).
// Where it fits: reviewRoutes() (routes.ts) registers this controller; each handler builds the context, calls ONE service method and shapes the answer.
// How it works: GET /reviews answers { data: [reviews], meta: { count, unanswered, average, stars, canReply } }; POST /reviews/:id/reply answers { message }.
// Rules: no business logic and no Prisma here. The standard routes of BaseController are off (standardRoutes: []) because reviews are written by the website.
// A route does nothing until app.ts registers reviewRoutes (it does, with { prefix: "/v1" }).

import type { FastifyInstance, FastifyRequest } from "fastify";
import { BaseController } from "@sheetal/platform/core/controller";
import type { BusinessContext } from "@sheetal/platform/core/context";
import type { ReviewService } from "./review.service.js";
import type { ReviewChange, ReviewRow } from "./types.js";

type ContextOf = (req: FastifyRequest) => Promise<BusinessContext>;

export class ReviewController extends BaseController<ReviewRow, never, ReviewChange> {
  constructor(private readonly reviews: ReviewService, contextOf: ContextOf) {
    super(reviews, { basePath: "/reviews", standardRoutes: [], contextOf, createStatus: 200, updateMethod: "PUT" });
  }

  /** An id longer than 40 characters is cut, so it is "not found" (404) as before. */
  protected override idOf(req: FastifyRequest): string { return ((req.params as { id?: string }).id ?? "").slice(0, 40); }

  protected override routes(app: FastifyInstance): void {
    const base = this.cfg.basePath;

    app.get(base, async (req) => {
      const { rows, meta } = await this.reviews.overview(await this.ctxOf(req), req.query);
      return { data: rows, meta };
    });
    app.post<{ Params: { id: string } }>(`${base}/:id/reply`, async (req) => {
      const done = await this.reviews.reply(await this.ctxOf(req), this.idOf(req), req.body);
      return { message: done.posted ? "Reply posted. It shows under the review on the website." : "Reply removed." };
    });
  }
}
