// Object storage for photos: this file only re-exports platform/src/files/storage (moved there in P1-BE-4), so every import path keeps working.
// Where it fits: backend-core/src/app.ts calls configureStorage(); photos.ts and scripts/resize-photos.ts call putObject().
// Rules: no new code imports this path (new code uses @sheetal/platform/files/storage); it is deleted at the end of Phase 2.
export { configureStorage, storageOn, putObject } from "@sheetal/platform/files/storage";
