// The data scope People uses in Phase 2, and the old refusal messages.
// Where it fits: routes.ts wraps the request context with phaseOneContext() once per request.
// How it works: People keeps today's view (the branch picked at the top, or all of the person's branches) by capping every People permission at "branch"
// (PHASE_ONE_CAPS in platform core/scope-cap.ts). An "all branches" grant is switched on there later, with its page.
// Rules: change the cap in PHASE_ONE_CAPS, not here.

import type { BusinessContext, PermissionId } from "@sheetal/platform/core/context";
import { capContext } from "@sheetal/platform/core/scope-cap";

const message = (perm: PermissionId): string => (/\.read$/.test(perm) ? "Your role can't see everyone's attendance." : "Your role can't change attendance.");

export const phaseOneContext = (ctx: BusinessContext): BusinessContext => capContext(ctx, "people", message);
