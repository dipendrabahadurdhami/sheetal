// Sign-in sessions: this file only re-exports platform/src/auth/sessions (moved there in P1-BE-4), so every import path keeps working.
// Where it fits: still imported by the base app (registerAuth), the auth routes and the three APIs.
// How it works: it also gives the platform code the one thing that has not moved, the sessionDays setting (platformSettings in
// ../../domain/platform.ts). Every importer of this path gets that registered, because it happens when this module loads.
// Rules: no new code imports this path (new code uses @sheetal/platform/auth/sessions); it is deleted at the end of Phase 2.

import { setSessionDaysReader } from "@sheetal/platform/auth/sessions";
import { platformSettings } from "../../domain/platform.js";

setSessionDaysReader((db) => platformSettings(db).then((p) => p.sessionDays));

export {
  SESSION_DAYS, createSession, forgetSessionDays, registerAuth, requireUser, revokeAllSessions, revokeSession, userForToken,
  type MemberBranchLink, type SessionUser,
} from "@sheetal/platform/auth/sessions";
