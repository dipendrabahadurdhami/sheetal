// Reviews from the website about the business and its listings, with public replies.
// Where it fits: Business → Reviews. business/backend/src/app.ts registers reviewRoutes with { prefix: "/v1", contextOf: businessContextOf };
// business/backend/src/modules/reviews/routes.ts is a one-line shim over this file. (Checkups, the other file of that folder, stays there.)
// How it works: the list shows the published reviews of the business and of its listings in the branches in view, with the average and a star breakdown; a reply
// shows under the review on the website and the reviewer is notified. The code is split by job: review.repository.ts (table and visibility), review.service.ts
// (rules), review.controller.ts (HTTP), presenter.ts (answers). The website API writes the reviews.
// Rules: reviews.review.read / reviews.review.reply (a role that still holds customers.view or reviews.reply passes through the alias layer); hiding a review
// is Sheetal's decision, not the business's.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { BusinessContext } from "@sheetal/platform/core/context";
import { busOf } from "./host.js";
import { ReviewController } from "./review.controller.js";
import { ReviewService } from "./review.service.js";
import { phaseOneContext } from "./scope.js";

export interface ReviewRoutesOptions {
  /** Builds the context of a request (business/backend/src/modules/access.ts businessContextOf). Passed in because an app does not import an API. */
  contextOf: (req: FastifyRequest) => Promise<BusinessContext>;
}

export async function reviewRoutes(app: FastifyInstance, opts: ReviewRoutesOptions) {
  const contextOf = async (req: FastifyRequest) => phaseOneContext(await opts.contextOf(req));
  new ReviewController(new ReviewService({ bus: busOf(app) }), contextOf).register(app);
}
