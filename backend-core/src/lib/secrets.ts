// Moved to platform/src/auth/secrets.ts (Phase 1, P1-BE-1). This file only re-exports it so old imports keep working.
// Rules: no new code imports this path (lint rule for platform/ and apps/); it is deleted at the end of Phase 2.
export * from "@sheetal/platform/auth/secrets";
