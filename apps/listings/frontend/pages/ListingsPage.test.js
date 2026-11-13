// Tests for the Listings screens on the kit (P2-W6): they use the kit and the SDK, never read business data from the panel store (only UI state:
// drafts, the picked branch, and the static catalog and plans), never import a Business page, and the old paths are shims.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const pages = { list: read("./ListingsPage.jsx"), wizard: read("./ListingWizard.jsx"), checkups: read("./CheckupsPage.jsx"), ota: read("./OtaPanel.jsx") };
const api = read("../api.js");
const biz = (f) => read(`../../../../business/frontend/src/pages/${f}`);

describe("Listings screens on the kit", () => {
  it("import the kit and the SDK, never the old UI file or a Business page", () => {
    for (const src of Object.values(pages)) {
      expect(src).toContain('from "@sheetal/ui/primitives"');
      expect(src).not.toContain("@sheetal/shared/core/ui");
      expect(src.split("\n").filter((l) => l.startsWith("import ")).join("\n")).not.toMatch(/business\/frontend|from "\.\.\/\.\.\//);
    }
    expect(api).toContain('from "@sheetal/sdk/client"');
  });
  it("never read business data from the panel store", () => {
    for (const src of Object.values(pages)) {
      expect(src).not.toMatch(/db\.listings|db\.branches|db\.tenantSettings|db\.members/);
    }
    expect(pages.wizard).toContain('useApiGet("/branches")');
  });
  it("every listing action shows the server's message and reloads the open pages and the panel", () => {
    expect(api).toMatch(/const done = \(\) => \{ listingsChanged\(\); onChanged\?\.\(\); \}/);
    expect(api).toContain('bizApi("POST", "/listings/status", { ids, status })');
  });
  it("the old paths are shims that pass in the panel's parts", () => {
    expect(biz("ListingsManager.jsx")).toContain("<Page {...props} onChanged={workRefresh} />");
    expect(biz("ListingWizard.jsx")).toContain("<Wizard {...props} Ai={AIStudio} onChanged={workRefresh} />");
    expect(biz("ListingCheckups.jsx")).toContain('export { LiveCheckups as ListingCheckups } from "@sheetal/app-listings/frontend";');
  });
});
