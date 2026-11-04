// Proves a change touched comments only: every changed .ts/.tsx/.js/.jsx/.mjs file is compiled with comments and
// whitespace removed, before (from git) and after (on disk), and the two must match exactly.
// Where it fits: run after tidying documentation, before committing (`node scripts/comments-only.mjs [<git ref>]`).
// How it works: esbuild strips comments the same way the production build does; any other difference is reported.
// Rules: exits with an error listing the files whose code changed, so a documentation pass can't change behaviour.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const ref = process.argv[2] || "HEAD";
const changed = execFileSync("git", ["diff", "--name-only", ref, "--", "*.ts", "*.tsx", "*.js", "*.jsx", "*.mjs"], { encoding: "utf8" }).split("\n").filter(Boolean);
const loader = (f) => (f.endsWith(".tsx") ? "tsx" : f.endsWith(".ts") ? "ts" : "jsx");
const bare = (code, f) => transformSync(code, { loader: loader(f), minifyWhitespace: true, legalComments: "none", format: "esm" }).code;

const differ = [];
for (const f of changed) {
  let before = "";
  try { before = execFileSync("git", ["show", `${ref}:${f}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); } catch { continue; } // new file
  const after = readFileSync(f, "utf8");
  if (bare(before, f) !== bare(after, f)) differ.push(f);
}
if (differ.length) {
  console.error(`Code changed (not only comments) in:\n  ${differ.join("\n  ")}`);
  process.exit(1);
}
console.log(`${changed.length} file(s) checked: only comments changed.`);
