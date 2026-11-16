// Tests for scripts/check-money-columns.mjs, using small fixture schemas written as strings, plus one run over the real schema.
// Where it fits: the root Vitest run (`npm test`) picks it up, because it is a *.test.js file outside the excluded folders.
// Rules: no database; the checker is a pure function of the schema text.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkMoneyColumns } from "./check-money-columns.mjs";

const model = (...fields) => ["/// @app platform", "model Thing {", "  id String @id", ...fields.map((f) => `  ${f}`), "}"].join("\n");

describe("check-money-columns", () => {
  it("passes BigInt and BigInt? paisa columns, with or without a default", () => {
    const r = checkMoneyColumns(model('totalPaisa BigInt? @map("total_paisa")', 'refundedPaisa BigInt @default(0) @map("refunded_paisa")', "total Int"));
    expect(r).toEqual({ fields: 2, problems: [] });
  });

  it("reports an Int, a Float and a Decimal paisa column with the model, the field and the line", () => {
    const r = checkMoneyColumns(model('aPaisa Int @map("a_paisa")', 'bPaisa Float? @map("b_paisa")', 'cPaisa Decimal @map("c_paisa")'));
    expect(r.fields).toBe(3);
    expect(r.problems.map((p) => `${p.model}.${p.field}:${p.line}`)).toEqual(["Thing.aPaisa:4", "Thing.bPaisa:5", "Thing.cPaisa:6"]);
    expect(r.problems[0].message).toContain("must be BigInt");
  });

  it("reports a paisa field whose column name does not end in _paisa", () => {
    const r = checkMoneyColumns(model('pricePaisa BigInt @map("price")'));
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].message).toContain("_paisa");
  });

  it("ignores comments, rupee columns and anything outside a model", () => {
    const text = ["// totalPaisa Int", "enum X {", "  aPaisa", "}", model("/// totalPaisa Int would be wrong", "amount Int", "// oldPaisa Int")].join("\n");
    expect(checkMoneyColumns(text)).toEqual({ fields: 0, problems: [] });
  });

  it("the real schema has paisa columns and every one is BigInt", () => {
    const schema = readFileSync(fileURLToPath(new URL("../backend-core/prisma/schema.prisma", import.meta.url)), "utf8");
    const r = checkMoneyColumns(schema);
    expect(r.problems).toEqual([]);
    expect(r.fields).toBeGreaterThan(30);
  });
});
