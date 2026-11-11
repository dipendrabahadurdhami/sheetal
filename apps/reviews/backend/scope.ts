// The data scope Reviews uses in Phase 1, and the old refusal messages.
// Where it fits: the controller wraps the request context with `phaseOneContext()` once per request.
// How it works: the cap itself (every Reviews permission is no wider than "branch" for now) now lives in platform (core/scope-cap.ts, P1-BE-7), shared with
// Expenses. This file only adds what is Reviews': the old refusal messages, so the screens show the same text.
// Rules: change the cap in PHASE_ONE_CAPS (platform), not here.

import type { BusinessContext, DataScope, PermissionId, PermissionSet } from "@sheetal/platform/core/context";
import { capContext, capPermissions, phaseOneCap } from "@sheetal/platform/core/scope-cap";

const CAP: DataScope = phaseOneCap("reviews") ?? "branch";

const message = (perm: PermissionId): string => (/\.reply$/.test(perm) ? "Your role can't reply to reviews." : "Your role can't see reviews.");

export const cappedPermissions = (p: PermissionSet, cap: DataScope = CAP): PermissionSet => capPermissions(p, cap, message);

/** The same context with the capped permissions. (A transaction opened from it hands out the original context; the service passes the scope it computed here.) */
export const phaseOneContext = (ctx: BusinessContext): BusinessContext => capContext(ctx, "reviews", message);
