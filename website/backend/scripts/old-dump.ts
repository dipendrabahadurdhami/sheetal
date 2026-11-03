import { readFileSync } from "node:fs";

// Reading the old Laravel site's MySQL backup (database-full.sql) without a MySQL server. Shared by the import scripts.

export type Row = Record<string, string | number | null>;

/** Column names of every table, from its CREATE TABLE. */
export function columnsOf(sql: string) {
  const out = new Map<string, string[]>();
  for (const m of sql.matchAll(/CREATE TABLE `(\w+)` \(\n([\s\S]*?)\n\)/g)) {
    out.set(m[1]!, [...m[2]!.matchAll(/^\s+`(\w+)`/gm)].map((c) => c[1]!));
  }
  return out;
}

/** Values of one INSERT statement: (a,'b',NULL),(…) → arrays, handling quotes and backslash escapes. */
export function tuples(values: string): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  let row: (string | number | null)[] = [];
  let i = 0;
  const ESC: Record<string, string> = { n: "\n", r: "\r", t: "\t", "0": "\0", Z: "\x1a" };
  while (i < values.length) {
    const c = values[i]!;
    if (c === "(") { row = []; i++; continue; }
    if (c === ")") { rows.push(row); i++; continue; }
    if (c === "," || c === ";" || c === " " || c === "\n") { i++; continue; }
    if (c === "'") {
      let s = "";
      i++;
      while (i < values.length) {
        const d = values[i]!;
        if (d === "\\") { const e = values[i + 1]!; s += ESC[e] ?? e; i += 2; continue; }
        if (d === "'") { if (values[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; }
        s += d; i++;
      }
      row.push(s);
      continue;
    }
    let j = i;
    while (j < values.length && values[j] !== "," && values[j] !== ")") j++;
    const raw = values.slice(i, j).trim();
    row.push(raw === "NULL" ? null : Number.isFinite(Number(raw)) ? Number(raw) : raw);
    i = j;
  }
  return rows;
}

export function readTables(path: string, wanted: string[]) {
  const sql = readFileSync(path, "utf8");
  const cols = columnsOf(sql);
  const out: Record<string, Row[]> = {};
  for (const t of wanted) {
    const names = cols.get(t);
    if (!names) throw new Error(`Table ${t} is not in the dump`);
    out[t] = [];
    for (const m of sql.matchAll(new RegExp(`^INSERT INTO \`${t}\` VALUES (.*);$`, "gm"))) {
      for (const v of tuples(m[1]!)) out[t]!.push(Object.fromEntries(names.map((n, k) => [n, v[k] ?? null])));
    }
  }
  return out;
}

/** Tables that may be missing from older backups come back empty instead of failing. */
export function readOptionalTables(path: string, wanted: string[]) {
  const sql = readFileSync(path, "utf8");
  const cols = columnsOf(sql);
  return readTables(path, wanted.filter((t) => cols.has(t)));
}
