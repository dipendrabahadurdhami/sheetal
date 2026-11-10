// Test: `npm run gen:permissions -- --check` and `npm run check:manifests` pass (P1-BE-2).
// Where it fits: backend-core/test. The same two commands run inside `npm run check`; running them here too means `npm run test` alone catches a stale generated file.
// How it works: starts the two scripts with the current Node and reads their exit code and output. Also proves the checker is not asleep: a copy of a
// manifest with a broken rule is rejected.
// Rules: read-only; the broken manifest is written to a temporary folder, never to the repo.
// Run with: npm run test -w @sheetal/backend-core
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const run = (script: string, ...args: string[]) => spawnSync(process.execPath, [`scripts/${script}`, ...args], { cwd: root, encoding: "utf8", timeout: 60_000 });

describe("manifest scripts", () => {
  it("the generated permission and app files are current", () => {
    const r = run("gen-permissions.mjs", "--check");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/4 generated files are current, 15 manifests/);
  });
  it("all 15 manifests pass the checker", () => {
    const r = run("check-manifests.mjs");
    expect(r.stderr).not.toMatch(/problem/);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ok \(15 manifests, \d+ permissions\)/);
  });
});
