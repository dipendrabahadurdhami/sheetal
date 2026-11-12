// The table and the tool of stage 1.5: old permission names -> new names at the places that CHECK a permission (ACCESS.md section 6.3, step 3).
// Where it fits: `node scripts/perm-names.mjs --report` lists every use of an old name that is left, by file; `--apply <area>` rewrites the uses of one area
// that are in a known, safe shape. packages/config/src/new-names.test.js proves the replacements give the same answers for every role.
// How it works: an old name becomes its new names joined with "+" (all of them are needed; hasPerm understands "+"). Which map applies depends on the area:
// Sheetal staff checks (admin/…) use the staff map, business checks use the business map ("roles.manage" is in both, with different meanings).
// Only string literals that sit in a permission-check position are touched: staffOf(request, "x"), ws.can("x"), can(role, "x"), guard("x" / ["x", …]),
// perm: "x", permAny: ["x", …]. Anything else (an audit action or a translation key that happens to look like a permission) is reported, never changed.
// Rules: never run --apply on tests (old tests keep proving the old names still work while the alias layer is on). The role templates and the scripts that
// rewrite stored roles keep old names on purpose until the alias layer is removed.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LEGACY_ALIASES, LEGACY_PLATFORM_ALIASES } from "../packages/config/src/permissions.generated.js";

const MAPS = { business: LEGACY_ALIASES, platform: LEGACY_PLATFORM_ALIASES };

/** The replacement for an old name in one kind of place, or null when it is not an old name there. */
export function newNameFor(old, kind) {
  const news = Object.hasOwn(MAPS[kind], old) ? MAPS[kind][old] : null;
  return news && news.length ? news.join("+") : null;
}

/** Which map a file's checks use. null = both kinds live there, so it is never rewritten automatically. */
export function kindOf(file) {
  if (file.startsWith("admin/")) return "platform";
  if (file.startsWith("business/") || file.startsWith("apps/")) return "business";
  return null;
}

const SKIP = /(\.test\.|\/test\/|generated|node_modules|^docs\/|^handovers\/|legacy-v1|^scripts\/|backend-core\/scripts\/|domain\/permissions\.ts$|core\/rbac\.js$)/;
const Q = `["']`;
const NAME = `[a-z_]+\\.[a-z_]+`;
// The shapes that are permission checks. Group 1 = everything before the names, group 2 = one literal or a [list] of literals.
const ONE = `${Q}${NAME}${Q}`;
const LIST = `\\[\\s*${ONE}(?:\\s*,\\s*${ONE})*\\s*\\]`;
const SHAPES = [
  new RegExp(`(\\bstaffOf\\(\\s*\\w+\\s*,\\s*)(${ONE})`, "g"),
  new RegExp(`(\\b(?:ws|s|w|workspace|staff)\\.can\\(\\s*)(${ONE})`, "g"),
  new RegExp(`(\\bcan\\(\\s*\\w+\\s*,\\s*)(${ONE})`, "g"),
  new RegExp(`(\\bcanAny\\(\\s*\\w+\\s*,\\s*)(${LIST})`, "g"),
  new RegExp(`(\\bguard\\(\\s*)(${ONE}|${LIST})`, "g"),
  new RegExp(`(\\bperm:\\s*)(${ONE})`, "g"),
  new RegExp(`(\\bpermAny:\\s*)(${LIST})`, "g"),
  new RegExp(`(\\bnotifyStaff\\(\\s*[\\w()]+\\s*,\\s*)(${ONE})`, "g"),
];

/** Rewrites the known shapes of one file's text. Returns the new text and how many names changed. */
export function rewrite(text, kind) {
  let changed = 0;
  const swap = (lit) => lit.replace(new RegExp(`(${Q})(${NAME})\\1`, "g"), (m, q, name) => { const n = newNameFor(name, kind); if (!n) return m; changed++; return `${q}${n}${q}`; });
  let out = text;
  for (const re of SHAPES) out = out.replace(re, (m, pre, names) => pre + swap(names));
  return { text: out, changed };
}

/** Every old name still written as a string literal in a file (for the report). */
export function leftIn(text, kind) {
  const names = new Set([...(kind ? Object.keys(MAPS[kind]) : [...Object.keys(LEGACY_ALIASES), ...Object.keys(LEGACY_PLATFORM_ALIASES)])]);
  const out = [];
  for (const m of text.matchAll(new RegExp(`${Q}(${NAME})${Q}`, "g"))) if (names.has(m[1])) out.push(m[1]);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const area = args.includes("--apply") ? args[args.indexOf("--apply") + 1] : null;
  const files = execSync("git ls-files '*.ts' '*.tsx' '*.js' '*.jsx'", { encoding: "utf8" }).split("\n").filter((f) => f && !SKIP.test(f));
  let total = 0; let done = 0;
  const left = [];
  for (const f of files) {
    const kind = kindOf(f);
    const text = readFileSync(f, "utf8");
    if (area && kind && f.startsWith(area)) {
      const r = rewrite(text, kind);
      if (r.changed) { writeFileSync(f, r.text); done += r.changed; }
      const rest = leftIn(r.text, kind);
      if (rest.length) left.push([f, rest.length]);
      total += rest.length;
    } else {
      const rest = leftIn(text, kind);
      if (rest.length) left.push([f, rest.length]);
      total += rest.length;
    }
  }
  if (area) console.log(`perm-names: ${done} check(s) rewritten under ${area}`);
  for (const [f, n] of left.sort((a, b) => b[1] - a[1])) if (args.includes("--report") || (area && f.startsWith(area))) console.log(`${String(n).padStart(4)}  ${f}`);
  console.log(`perm-names: ${total} use(s) of an old name left in ${left.length} file(s)`);
}
