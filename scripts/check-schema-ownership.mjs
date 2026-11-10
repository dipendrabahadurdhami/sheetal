// check-schema-ownership: checks that every model in backend-core/prisma/schema.prisma says which app owns it.
// Where it fits: part of `npm run check` (script `check:schema`). Design: docs/architecture/FOLDERS-AND-MOVE-PLAN.md
// section 5 and step 4. The table of owners is docs/architecture/MODEL-OWNERS.md.
// How it works: plain Node, no package. For each `model X {` it looks at the `///` doc lines directly above it and reads
// the `/// @app <id>` tag. It reports, in one list, every model that has no tag, has two tags, or names an unknown app id,
// and every `/// @app` line that is not directly above a model (for example a blank line in between).
// Valid app ids: the 15 in APP_IDS below (MODEL-OWNERS.md) plus the ids of any manifest found on disk
// (apps/<id>/app.manifest.ts and platform/src/tenancy/<id>.manifest.ts). Once the manifests exist (task P1-BE-2) they take
// over: a new app only needs its manifest, not an edit here. Comparing the tags with each manifest's `models` list is NOT
// done here; that is check-manifests.mjs (APP-MANIFEST.md section 9, rule 5).
// Rules: read-only, it never edits the schema (TEAM-RULES rule 2). Exit code 0 = all good, 1 = problems.
// Run it: `npm run check:schema`, or `node scripts/check-schema-ownership.mjs [path/to/schema.prisma]`.
// Test: scripts/check-schema-ownership.test.js (Vitest, picked up by the root `npm test`).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// The 15 manifests of APP-MANIFEST.md section 8 (same list as MODEL-OWNERS.md).
export const APP_IDS = [
  "platform", "workspace", "expenses", "reviews", "listings", "crm", "hotel", "pos",
  "projects", "collections", "investments", "invoicing", "rentals", "agreements", "people",
];

// Ids of the manifests that exist on disk. Apps: the folder name is the id (APP-MANIFEST.md rule 2).
export function manifestIds(root = ROOT) {
  const ids = new Set();
  const appsDir = path.join(root, "apps");
  if (existsSync(appsDir)) {
    for (const d of readdirSync(appsDir, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(path.join(appsDir, d.name, "app.manifest.ts"))) ids.add(d.name);
    }
  }
  const tenancyDir = path.join(root, "platform", "src", "tenancy");
  if (existsSync(tenancyDir)) {
    for (const f of readdirSync(tenancyDir)) {
      const m = /^([a-z][a-z0-9-]*)\.manifest\.ts$/.exec(f);
      if (m) ids.add(m[1]);
    }
  }
  return [...ids];
}

// Reads the schema text and returns { models: <count>, problems: [{ kind, model, line, message }] }.
// kind is one of: untagged, double, unknown, empty, stray.
export function checkSchema(text, validIds = APP_IDS) {
  const valid = new Set(validIds);
  const lines = text.split(/\r?\n/);
  const problems = [];
  const used = new Set(); // line numbers of tag lines that sit directly above a model
  let models = 0;

  lines.forEach((line, i) => {
    const m = /^model\s+(\w+)\s*\{/.exec(line);
    if (!m) return;
    models += 1;
    const name = m[1];

    // The block of `///` lines directly above the model (no blank line in between).
    const tags = [];
    let nearbyPlainComment = false;
    for (let j = i - 1; j >= 0; j -= 1) {
      const above = lines[j].trim();
      if (above.startsWith("///")) {
        const t = /^\/\/\/\s*@app\b(.*)$/.exec(above);
        if (t) {
          tags.unshift({ id: t[1].trim(), line: j + 1 });
          used.add(j + 1);
        }
        continue;
      }
      if (/^\/\/\s*@app\b/.test(above)) nearbyPlainComment = true;
      break;
    }

    if (tags.length === 0) {
      const hint = nearbyPlainComment ? " (the line above uses // and not ///)" : "";
      problems.push({ kind: "untagged", model: name, line: i + 1, message: `model ${name} has no "/// @app <id>" tag${hint}` });
      return;
    }
    if (tags.length > 1) {
      const where = tags.map((t) => `line ${t.line}: ${t.id || "(empty)"}`).join(", ");
      problems.push({ kind: "double", model: name, line: i + 1, message: `model ${name} has ${tags.length} @app tags (${where}); it must have exactly one` });
    }
    for (const t of tags) {
      if (t.id === "") {
        problems.push({ kind: "empty", model: name, line: t.line, message: `model ${name}: the "/// @app" tag on line ${t.line} has no app id` });
      } else if (!valid.has(t.id)) {
        problems.push({ kind: "unknown", model: name, line: t.line, message: `model ${name}: unknown app id "${t.id}" on line ${t.line} (valid: ${[...valid].join(", ")})` });
      }
    }
  });

  // A tag that is not directly above a model belongs to nothing.
  lines.forEach((line, i) => {
    if (/^\s*\/\/\/\s*@app\b/.test(line) && !used.has(i + 1)) {
      problems.push({ kind: "stray", model: "", line: i + 1, message: `line ${i + 1}: "${line.trim()}" is not directly above a model (a blank line or another statement is in between)` });
    }
  });

  problems.sort((a, b) => a.line - b.line);
  return { models, problems };
}

function main() {
  const schemaPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "backend-core", "prisma", "schema.prisma");
  if (!existsSync(schemaPath)) {
    console.error(`check-schema-ownership: cannot find ${schemaPath}`);
    process.exit(1);
  }
  const ids = [...new Set([...APP_IDS, ...manifestIds()])];
  const { models, problems } = checkSchema(readFileSync(schemaPath, "utf8"), ids);
  if (problems.length > 0) {
    console.error(`check-schema-ownership: ${problems.length} problem(s) in ${path.relative(ROOT, schemaPath) || schemaPath}:`);
    for (const p of problems) console.error(`  - ${p.message}`);
    console.error("Fix: put exactly one \"/// @app <id>\" line directly above each \"model X {\" (owners: docs/architecture/MODEL-OWNERS.md).");
    process.exit(1);
  }
  console.log(`check-schema-ownership: ${models} models, each has exactly one valid @app tag.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
