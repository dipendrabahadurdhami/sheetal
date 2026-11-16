// Tests for the pure parts of scripts/scratch-db.mjs: which database the copy is, and that the real one can never be it.
// Where it fits: the root Vitest run (`npm test`). No database is used here; the copy itself is exercised by RUN-P3-STEP-1.cmd.
import { describe, expect, it } from "vitest";
import { SCRATCH_NAME, adminUrl, quoteArg, scratchUrl } from "./scratch-db.mjs";

describe("scratch-db", () => {
  it("the copy is the database sheetal_scratch on the same server, with the same login and options", () => {
    const u = new URL(scratchUrl("postgresql://sheetal:pw%40x@localhost:5433/sheetal?schema=public"));
    expect(u.pathname).toBe(`/${SCRATCH_NAME}`);
    expect([u.hostname, u.port, u.username, u.password, u.search]).toEqual(["localhost", "5433", "sheetal", "pw%40x", "?schema=public"]);
  });

  it("refuses when DATABASE_URL already names the copy, names no database, or is not PostgreSQL", () => {
    expect(() => scratchUrl(`postgresql://a:b@localhost:5433/${SCRATCH_NAME}`)).toThrow(/must differ/);
    expect(() => scratchUrl("postgresql://a:b@localhost:5433/")).toThrow(/names no database/);
    expect(() => scratchUrl("mysql://a:b@localhost/sheetal")).toThrow(/not a PostgreSQL/);
  });

  it("the maintenance address keeps the server and login", () => {
    const u = new URL(adminUrl("postgresql://sheetal:pw@127.0.0.1:5433/sheetal"));
    expect([u.pathname, u.hostname, u.port, u.username]).toEqual(["/postgres", "127.0.0.1", "5433", "sheetal"]);
  });

  it("quotes only the arguments that need it", () => {
    expect(quoteArg("--business=abc,def")).toBe("--business=abc,def");
    expect(quoteArg("C:\\Users\\me\\report.csv")).toBe("C:\\Users\\me\\report.csv");
    expect(quoteArg("two words")).toBe('"two words"');
  });
});
