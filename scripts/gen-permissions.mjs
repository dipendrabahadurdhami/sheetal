// gen-permissions: writes the permission lists (server and screen copy) and the app registries from the app manifests.
// Where it fits: `npm run gen:permissions` after editing a manifest; `npm run gen:permissions -- --check` is part of `npm run check`.
// How it works: loads apps/*/app.manifest.ts and platform/src/tenancy/platform.manifest.ts as data (with tsx, already in the repo),
// builds the model (scripts/lib/manifests.mjs) and writes four files (scripts/lib/render.mjs):
//   platform/src/tenancy/permissions.generated.ts   packages/config/src/permissions.generated.js
//   platform/src/tenancy/apps.generated.ts          packages/config/src/apps.generated.js
// Rules: with `--check` it never writes anything; it fails when a generated file is missing or differs from a fresh one.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generate, outOfDate } from "./lib/generate.mjs";
import { ROOT } from "./lib/manifests.mjs";

async function main() {
  const check = process.argv.includes("--check");
  const { files, model } = await generate();
  if (model.problems.length) {
    console.error(`gen-permissions: ${model.problems.length} problem(s) in the manifests:\n  ${model.problems.join("\n  ")}`);
    process.exit(1);
  }
  const stale = outOfDate(files);
  if (check) {
    if (stale.length) {
      console.error(`gen-permissions: out of date: ${stale.join(", ")}\nRun \`npm run gen:permissions\` and commit the result.`);
      process.exit(1);
    }
    console.log(`gen-permissions: ok (${Object.keys(files).length} generated files are current, ${model.sorted.length} manifests).`);
    return;
  }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true });
    writeFileSync(path.join(ROOT, rel), text);
  }
  console.log(`gen-permissions: wrote ${Object.keys(files).length} files from ${model.sorted.length} manifests (${stale.length} changed).`);
}

main().catch((e) => { console.error(`gen-permissions: ${e.message}`); process.exit(1); });
