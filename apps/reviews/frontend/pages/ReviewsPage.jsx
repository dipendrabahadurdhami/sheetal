// Reviews page: Business → Reviews. What people say about the business and its listings on the website, with a public reply.
// Where it fits: shown at /business/reviews by business/frontend/src/pages/BusinessApp.jsx when the business is live.
// How it works: a CrudPage in card layout, read-only (resources/review.jsx): stat cards and the star breakdown from the server's `meta`, filter chips (All / Waiting for
// a reply / 1 or 2 stars), and one ReviewCard per review. A reply carries the review's `version`; a stale one shows "Someone changed this. Reload to see the latest."
// and reloads. The reply box shows only when `meta.canReply` is true.
// Rules: no business data is kept in the browser; the branch picked at the top reloads the list; no "all branches" choice is added here.

import React, { useCallback } from "react";
import { bizApi } from "@sheetal/sdk/client";
import { useT } from "@sheetal/shared/core/i18n";
import { useToast } from "@sheetal/ui/primitives";
import { CrudPage } from "@sheetal/ui/crud";
import { ReviewCard } from "../components/ReviewCard.jsx";
import { reviewResource, reviewStats, sendReply, starsPanel } from "../resources/review.jsx";

export function ReviewsPage({ tenant, api = bizApi }) {
  const t = useT();
  const toast = useToast();
  const renderCard = useCallback((r, actions) => (
    <ReviewCard review={r} canReply={!!actions.meta?.canReply} onReply={(text) => sendReply(r, text, { api, toast, t, reload: actions.reload })} />
  ), [api, toast, t]);
  return (
    <CrudPage key={tenant?.id} resource={reviewResource} tenant={tenant} api={api} layout="cards" renderCard={renderCard}
      title="Reviews" sub="What people say about your business and listings on the website. Your reply shows under their review, and they are told."
      stats={reviewStats} banner={starsPanel} />
  );
}
