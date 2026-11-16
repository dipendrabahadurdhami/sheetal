// check-money-columns: checks that every paisa column in backend-core/prisma/schema.prisma is a whole number big enough for money.
// Where it fits: part of `npm run check` (script `check:money`). Design: MARKETPLACE-AND-BILLING.md section 15 ("Money is BigInt paisa")
// and PHASE-3-TASKS.md, task P3-OPS-1.
// How it works: plain Node, no package. Inside every `model X { … }` it reads each field line (`name Type …`). A field whose name ends in
// "Paisa" (totalPaisa, priceGrossPaisa, refundedPaisa, …) must have the type BigInt or BigInt? and its column name (`@map("…")`) must end
// in "_paisa". Anything else (Int, Float, Decimal, String, a list) is reported: an Int tops out near Rs 2.1 crore in paisa, and a Float
// loses paisa.
// Rules: read-only, it never edits the schema. Exit code 0 = all good, 1 = problems.
// Run it: `npm run check:money`, or `node scripts/check-money-columns.mjs [path/to/schema.prisma]`.
// Test: scripts/check-money-columns.test.js (Vitest, picked up by the root `npm test`).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Reads the schema text and returns { fields: <count of paisa fields>, problems: [{ model, field, line, message }] }.
export function checkMoneyColumns(text) {
  const problems = [];
  let fields = 0;
  let model = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const start = /^model\s+(\w+)\s*\{/.exec(line);
    if (start) { model = start[1]; return; }
    if (line.startsWith("}")) { model = null; return; }
    if (!model || line.startsWith("//") || line.startsWith("@@")) return;
    const f = /^(\w+)\s+([\w.]+(?:\[\])?\??)(.*)$/.exec(line);
    if (!f || !/Paisa$/.test(f[1])) return;
    fields += 1;
    const [, name, type, rest] = f;
    if (type !== "BigInt" && type !== "BigInt?") {
      problems.push({ model, field: name, line: i + 1, message: `${model}.${name} is ${type}; a paisa column must be BigInt` });
    }
    const map = /@map\("([^"]+)"\)/.exec(rest);
    if (map && !/_paisa$/.test(map[1])) {
      problems.push({ model, field: name, line: i + 1, message: `${model}.${name} is stored as "${map[1]}"; the column name must end in _paisa` });
    }
  });
  return { fields, problems };
}

function main() {
  const schemaPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "backend-core", "prisma", "schema.prisma");
  if (!existsSync(schemaPath)) {
    console.error(`check-money-columns: cannot find ${schemaPath}`);
    process.exit(1);
  }
  const { fields, problems } = checkMoneyColumns(readFileSync(schemaPath, "utf8"));
  if (problems.length > 0) {
    console.error(`check-money-columns: ${problems.length} problem(s) in ${path.relative(ROOT, schemaPath) || schemaPath}:`);
    for (const p of problems) console.error(`  - line ${p.line}: ${p.message}`);
    process.exit(1);
  }
  console.log(`check-money-columns: ${fields} paisa columns, every one is BigInt.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
