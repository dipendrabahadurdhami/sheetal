// check-manifests: checks every app manifest (apps/<id>/app.manifest.ts) is complete and consistent.
// Where it fits: part of `npm run check`. Design: docs/architecture/APP-MANIFEST.md and FOLDERS-AND-MOVE-PLAN.md step 3.
// How it works today: there are no manifests yet, so it passes. The real checks are written in step 3 (task P1-BE-2),
// which replaces this file.
// Rules: if a manifest appears before step 3 replaced this file, it fails loudly instead of passing silently.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const apps = existsSync(`${root}apps`) ? readdirSync(`${root}apps`, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];
const manifests = apps.filter((d) => existsSync(`${root}apps/${d.name}/app.manifest.ts`));

if (manifests.length > 0) {
  console.error(`check-manifests: found ${manifests.length} manifest(s) but this is still the empty placeholder (replaced in task P1-BE-2).`);
  process.exit(1);
}
console.log("check-manifests: no app manifests yet, nothing to check.");
