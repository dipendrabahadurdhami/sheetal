// Tests for scripts/check-schema-ownership.mjs, using small fixture schemas written as strings.
// Where it fits: the root Vitest run (`npm test`) picks it up, because it is a *.test.js file outside the excluded folders.
// Rules: no files, no database; the checker is a pure function of the schema text and the list of valid app ids.
import { describe, expect, it } from "vitest";
import { APP_IDS, checkSchema } from "./check-schema-ownership.mjs";

const kinds = (r) => r.problems.map((p) => `${p.kind}:${p.model}`);

describe("check-schema-ownership", () => {
  it("passes when every model has exactly one known tag, with or without other doc lines", () => {
    const r = checkSchema([
      "/// A business workspace.",
      "/// @app workspace",
      "model Tenant {",
      "  id String @id",
      "}",
      "",
      "/// @app expenses",
      "model Expense {",
      "  id String @id",
      "}",
    ].join("\n"));
    expect(r).toEqual({ models: 2, problems: [] });
  });

  it("reports a model with no tag, and says so when the line above uses // instead of ///", () => {
    const r = checkSchema("/// A user.\nmodel User {\n  id String @id\n}\n\n// @app platform\nmodel Session {\n}\n");
    expect(kinds(r)).toEqual(["untagged:User", "untagged:Session"]);
    expect(r.problems[1].message).toContain("uses // and not ///");
  });

  it("reports a model with two tags (even the same id twice)", () => {
    const r = checkSchema("/// @app crm\n/// @app hotel\nmodel Lead {\n}\n/// @app crm\n/// @app crm\nmodel LeadMessage {\n}\n");
    expect(kinds(r)).toEqual(["double:Lead", "double:LeadMessage"]);
    expect(r.problems[0].message).toContain("line 1: crm, line 2: hotel");
  });

  it("reports an unknown app id and an empty one", () => {
    const r = checkSchema("/// @app expense\nmodel Expense {\n}\n/// @app\nmodel Review {\n}\n");
    expect(kinds(r)).toEqual(["unknown:Expense", "empty:Review"]);
    expect(r.problems[0].message).toContain('unknown app id "expense"');
  });

  it("accepts an id the manifests add, and rejects it when the list does not have it", () => {
    const schema = "/// @app newapp\nmodel Thing {\n}\n";
    expect(checkSchema(schema, [...APP_IDS, "newapp"]).problems).toEqual([]);
    expect(kinds(checkSchema(schema))).toEqual(["unknown:Thing"]);
  });

  it("reports a tag that is separated from its model by a blank line", () => {
    const r = checkSchema("/// @app people\n\nmodel Attendance {\n}\n");
    expect(kinds(r)).toEqual(["stray:", "untagged:Attendance"]);
    expect(r.problems.find((p) => p.kind === "stray").message).toContain("not directly above a model");
  });

  it("lists all problems together, in file order, and copes with Windows line endings", () => {
    const r = checkSchema("model A {\r\n}\r\n/// @app nope\r\nmodel B {\r\n}\r\n/// @app pos\r\nmodel C {\r\n}\r\n");
    expect(r.models).toBe(3);
    expect(kinds(r)).toEqual(["untagged:A", "unknown:B"]);
  });

  it("knows the 15 app ids of MODEL-OWNERS.md", () => {
    expect(APP_IDS).toHaveLength(15);
    expect(new Set(APP_IDS).size).toBe(15);
  });
});
