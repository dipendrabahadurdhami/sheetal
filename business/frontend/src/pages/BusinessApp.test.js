// Tests for the panel shell after the browser-storage sample workspace went (P2-W6): every route renders its page on the server, nobody signed in
// gets the sign-in page with "Try the demo", and the sample screens are gone from the code.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const app = readFileSync(new URL("./BusinessApp.jsx", import.meta.url), "utf8");
const live = readFileSync(new URL("../live.js", import.meta.url), "utf8");
const here = (f) => existsSync(new URL(f, import.meta.url));

describe("the panel works on real data only", () => {
  it("no route picks between a live and a sample screen", () => {
    expect(app).not.toMatch(/isLive\(tenant\.id\) \?/);
    expect(app).not.toContain("offerDemo");
    expect(app).not.toContain("BusinessOverview");
  });
  it("shows sign-in (with the demo), add-a-business, error and loading pages until the businesses are loaded", () => {
    expect(app).toMatch(/!bizApiReady\(\) \|\| !signedIn\(\) \|\| state === "signed-out"\) return <SignedOut \/>/);
    expect(app).toMatch(/state === "empty"\) return <FirstBusiness \/>/);
    expect(app).toMatch(/<TryDemo page="Sheetal Business" \/>/);
    expect(app).toMatch(/state !== "ready" \|\| !open \|\| !isLive\(open\.id\)\) return/);
  });
  it("live.js reports the state, and a 401 means signed out", () => {
    expect(live).toContain('setWsState(e?.status === 401 ? "signed-out" : "error")');
    expect(live).toContain('if (!data.workspaces.length) { setWsState("empty"); return; }');
  });
  it("the sample screens are deleted", () => {
    for (const f of ["./Agreements.jsx", "./Promote.jsx", "./Rentals.jsx", "./POS.jsx", "./Workspace.jsx"]) expect(here(f)).toBe(false);
  });
});
