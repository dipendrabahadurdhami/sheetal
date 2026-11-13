// Tests for the Inbox on the kit: it uses the kit and the SDK (never the old panel store, the old UI file or a Business page), sends the version
// with every lead change (a stale page gets 409 and reloads), and the old Inbox hands real businesses to it with the lead finder passed in.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { editBody, STAGES } from "./InboxPage.jsx";

const src = readFileSync(new URL("./InboxPage.jsx", import.meta.url), "utf8");
const old = readFileSync(new URL("../../../../business/frontend/src/pages/Inbox.jsx", import.meta.url), "utf8");

describe("Inbox on the kit", () => {
  it("imports the kit and the SDK only", () => {
    expect(src).toContain('from "@sheetal/ui/primitives"');
    expect(src).toContain('from "@sheetal/sdk/hooks"');
    expect(src).not.toContain("@sheetal/shared/core/ui");
    expect(src).not.toContain("@sheetal/shared/core/store");
    expect(src).not.toMatch(/from "\.\.\/\.\.\/\.\.\/\.\.\/business/);
  });
  it("sends the version with a lead change and reloads on 409", () => {
    expect(editBody({ id: "l1", version: 4 }, { stage: "won" })).toEqual({ stage: "won", version: 4 });
    expect(src).toMatch(/bizApi\("PATCH", `\/leads\/\$\{c\.id\}`, editBody\(c, patch\)\)/);
    expect(src).toMatch(/e\.status === 409/);
  });
  it("keeps the six pipeline stages the server knows", () => {
    expect(STAGES).toEqual(["new", "contacted", "viewing", "negotiating", "won", "lost"]);
  });
  it("is what the old Inbox renders (a shim since the sample workspace went), with the lead finder passed in", () => {
    expect(old).toContain('import { InboxPage } from "@sheetal/app-crm/frontend";');
    expect(old).toMatch(/return <InboxPage tenant=\{tenant\} Finder=\{AIStudio\} onChanged=\{workRefresh\} \/>/);
  });
});
