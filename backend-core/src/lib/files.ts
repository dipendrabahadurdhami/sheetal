// Private files people send (payment proofs, CVs, verification documents, receipts, form uploads): the code moved to
// platform/src/files/private.ts in P1-BE-4. This file keeps the old names and the old savePrivateFile() call, so no caller changes.
// Where it fits: still imported by the website, business and admin APIs.
// How it works: savePrivateFile() hands the picture check (photoKind from ./photos.js, which has not moved yet) to the platform function.
// Rules: no new code imports this path (new code uses @sheetal/platform/files/private); it is deleted at the end of Phase 2.

import { CONTENT_TYPES, readPrivateFile, savePrivateFileWith, type PrivateKind } from "@sheetal/platform/files/private";
import { photoKind } from "./photos.js";

export { CONTENT_TYPES, readPrivateFile, type PrivateKind };

export const savePrivateFile = (mediaDir: string | undefined, kind: PrivateKind, data: Buffer): Promise<string> =>
  savePrivateFileWith(photoKind, mediaDir, kind, data);
