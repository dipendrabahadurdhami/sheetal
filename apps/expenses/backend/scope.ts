// The data scope Expenses uses in Phase 1, and the old refusal messages.
// Where it fits: the controllers wrap the request context with `phaseOneContext()` once per request.
// How it works: the cap itself (every Expenses permission is no wider than "branch" for now) now lives in platform (core/scope-cap.ts, P1-BE-7), shared with
// Reviews. This file only adds what is Expenses': the old refusal messages, so the screens show the same text.
// Rules: change the cap in PHASE_ONE_CAPS (platform), not here.

import type { BusinessContext, DataScope, PermissionId, PermissionSet } from "@sheetal/platform/core/context";
import { capContext, capPermissions, phaseOneCap } from "@sheetal/platform/core/scope-cap";

const CAP: DataScope = phaseOneCap("expenses") ?? "branch";

const message = (perm: PermissionId): string =>
  /\.(read)$/.test(perm) ? "Your role can't see expenses." : "Your role can't add or change expenses.";

export const cappedPermissions = (p: PermissionSet, cap: DataScope = CAP): PermissionSet => capPermissions(p, cap, message);

/** The same context with the capped permissions. (A transaction opened from it hands out the original context; services pass the scope they computed here.) */
export const phaseOneContext = (ctx: BusinessContext): BusinessContext => capContext(ctx, "expenses", message);
