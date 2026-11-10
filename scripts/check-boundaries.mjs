// check-boundaries: who may import whom in the new folders (platform, packages, apps).
// Where it fits: part of `npm run check`. The rules are the table in docs/architecture/FOLDERS-AND-MOVE-PLAN.md section 3.
// How it works: plain Node, no package. It reads the import lines of every source file under platform/, packages/ and
// apps/, works out which folder each one points at (by package name or by relative path) and reports the forbidden pairs.
// Rules enforced now:
//   - packages/*  must not import platform     (packages are browser-safe)
//   - platform    must not import apps         (it learns about apps only through the generated registry)
//   - apps/a      must not import apps/b       (use events, or a dependencies.reads interface)
// Not enforced here: the "old paths" rule (backend-core, shared). The shim steps add that as ESLint rules.
// A comment that contains an import-looking line also counts, so keep such text out of comments.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN = ["platform", "packages", "apps"];
const SOURCE = /\.[cm]?[jt]sx?$/;
const SKIP = new Set(["node_modules", "dist", "coverage", ".vite"]);
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

// Which folder a path (relative to the repo root, forward slashes) belongs to.
function zoneOf(rel) {
  const [top, name] = rel.split("/");
  if (top === "platform") return { zone: "platform" };
  if (top === "packages") return { zone: "packages", name };
  if (top === "apps") return { zone: "apps", name };
  return null;
}

// Which folder an import points at. Only the three new zones matter; everything else returns null.
function targetOf(spec, fromRel) {
  if (spec.startsWith(".")) {
    return zoneOf(path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec)));
  }
  if (spec === "@sheetal/platform" || spec.startsWith("@sheetal/platform/")) return { zone: "platform" };
  const app = /^@sheetal\/app-([^/]+)/.exec(spec);
  if (app) return { zone: "apps", name: app[1] };
  return null;
}

function problem(from, to) {
  if (!to) return null;
  if (from.zone === "packages" && to.zone === "platform") return "packages are browser-safe: they must not import platform";
  if (from.zone === "platform" && to.zone === "apps") return "platform must not import apps (it learns about apps from the generated registry)";
  if (from.zone === "apps" && to.zone === "apps" && from.name !== to.name) return "an app must not import another app (use events or dependencies.reads)";
  return null;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SOURCE.test(entry.name)) yield full;
  }
}

let files = 0;
const found = [];
for (const top of SCAN) {
  const dir = path.join(ROOT, top);
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    files += 1;
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const from = zoneOf(rel);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(IMPORT)) {
      const why = problem(from, targetOf(match[1], rel));
      if (why) found.push(`${rel}: imports "${match[1]}": ${why}`);
    }
  }
}

if (found.length > 0) {
  console.error(`check-boundaries: ${found.length} forbidden import(s):\n  ${found.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-boundaries: ok (${files} files checked).`);
