// Tests for the moved config (platform/src/core/config.ts): the .env lookup must still end at backend-core/.env.
// Run with: npm run test -w @sheetal/platform
import { basename, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { backendCoreEnvPath, envFilePaths, loadConfig } from "../src/core/config.js";

describe("config", () => {
  it("looks in the current folder first, then in backend-core/.env", () => {
    const paths = envFilePaths();
    expect(paths[0]).toBe(".env");
    expect(basename(paths[1]!)).toBe(".env");
    expect(basename(dirname(paths[1]!))).toBe("backend-core");
  });
  it("finds the same file the old backend-core/src/config.ts found", () => {
    expect(backendCoreEnvPath().replaceAll("\\", "/")).toMatch(/\/backend-core\/\.env$/);
  });
  it("loadConfig still reads the environment it is given", () => {
    const c = loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv, "website");
    expect(c.SERVICE).toBeDefined();
  });
});
