// generate: builds the text of every generated file from the manifests, and compares it with what is on disk.
// Where it fits: shared by scripts/gen-permissions.mjs (writes) and scripts/check-manifests.mjs (rule 7: files are current).
// How it works: loadInputs -> buildModel -> renderAll, all in memory; outOfDate() only reads the files.
// Rules: never writes anything.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, buildModel, loadInputs } from "./manifests.mjs";
import { renderAll } from "./render.mjs";

/** Returns { files: { repoPath: text }, model, inputs }. */
export async function generate() {
  const inputs = await loadInputs();
  const model = buildModel(inputs);
  model.defs = inputs.businessTypeDefs;
  return { files: renderAll(model, inputs.legacy), model, inputs };
}

const lf = (t) => t.replace(/\r\n/g, "\n");

/** Which generated files differ from what is on disk (a missing file counts as different). */
export function outOfDate(files) {
  return Object.entries(files)
    // Compare without line-ending differences: git on Windows may check the files out with CRLF (QA, P1-BE-2 fix 1).
    .filter(([rel, text]) => !existsSync(path.join(ROOT, rel)) || lf(readFileSync(path.join(ROOT, rel), "utf8")) !== lf(text))
    .map(([rel]) => rel);
}
