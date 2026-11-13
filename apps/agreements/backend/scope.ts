// The data scope Agreements uses in Phase 2, and the old refusal message.
// Where it fits: routes.ts wraps the request context with phaseOneContext() once per request.
// How it works: every Agreements permission is capped at "branch" (PHASE_ONE_CAPS in platform core/scope-cap.ts), so people keep today's view: the branch
// picked at the top, or all of theirs.
// Rules: change the cap in PHASE_ONE_CAPS, not here.

import type { BusinessContext } from "@sheetal/platform/core/context";
import { capContext } from "@sheetal/platform/core/scope-cap";

export const REFUSED = "Your role can't make agreements. Ask the owner.";
export const phaseOneContext = (ctx: BusinessContext): BusinessContext => capContext(ctx, "agreements", () => REFUSED);
