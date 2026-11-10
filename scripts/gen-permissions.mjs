// gen-permissions: writes the permission lists (server and screen copy) from the app manifests.
// Where it fits: part of `npm run check` (as `-- --check`). Design: docs/architecture/FOLDERS-AND-MOVE-PLAN.md section 7, step 3.
// How it works today: there are no manifests yet, so there is nothing to generate and it passes. The real
// generator is written in step 3 (task P1-BE-2), which replaces this file.
// Rules: with `--check` it never writes anything; it only fails when the generated files are out of date.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const apps = existsSync(`${root}apps`) ? readdirSync(`${root}apps`, { withFileTypes: true }).filter((d) => d.isDirectory()) : [];
const manifests = apps.filter((d) => existsSync(`${root}apps/${d.name}/app.manifest.ts`));

if (manifests.length > 0) {
  // Safety net: if a manifest shows up before step 3 replaced this file, fail loudly instead of passing silently.
  console.error(`gen-permissions: found ${manifests.length} manifest(s) but this is still the empty placeholder (replaced in task P1-BE-2).`);
  process.exit(1);
}
console.log("gen-permissions: no app manifests yet, nothing to generate.");
