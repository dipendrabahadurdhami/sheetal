// Tests for the Email page on the kit: it uses the kit and the SDK (never the old UI file, the panel's api/live files or the panel store),
// and the old path is a shim that passes the top bar's unread re-count.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./MailPage.jsx", import.meta.url), "utf8");
const shim = readFileSync(new URL("../../../../business/frontend/src/pages/Mail.jsx", import.meta.url), "utf8");

describe("Email page on the kit", () => {
  it("imports the kit and the SDK only", () => {
    expect(src).toContain('from "@sheetal/ui/primitives"');
    expect(src).toContain('from "@sheetal/sdk/client"');
    expect(src).not.toContain("@sheetal/shared/core/ui");
    expect(src).not.toContain("@sheetal/shared/core/store");
    expect(src).not.toMatch(/from "\.\.\/(api|live)"/);
  });
  it("tells the panel when an email is read", () => {
    expect(src).toMatch(/if \(onRead\) setTimeout\(onRead, 800\)/);
  });
  it("leaves a shim at the old path", () => {
    expect(shim).toContain('import { MailPage } from "@sheetal/app-workspace/frontend";');
    expect(shim).toContain("<MailPage onRead={mailCountRefresh} />");
  });
});
