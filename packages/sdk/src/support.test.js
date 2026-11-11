// Tests for the support-session token in the browser.
import { describe, expect, it } from "vitest";
import { supportLink, supportTokenFromHash, takeSupportTokenFromUrl } from "./support.js";

describe("support token", () => {
  it("reads a token from the address fragment only when it looks like one", () => {
    expect(supportTokenFromHash("#support=sup1.abc.def")).toBe("sup1.abc.def");
    expect(supportTokenFromHash("#x=1&support=sup1.abc")).toBe("sup1.abc");
    expect(supportTokenFromHash("#support=eyJhbGciOi")).toBeNull();       // a normal sign-in token is never taken
    expect(supportTokenFromHash("#notsupport=sup1.abc")).toBeNull();
    expect(supportTokenFromHash("")).toBeNull();
    expect(supportTokenFromHash("#support=%E0%A4%A")).toBeNull();
  });
  it("makes a link that round-trips, with the token in the fragment and not in the query", () => {
    const link = supportLink("sup1.a+b/c=");
    expect(link.startsWith("/business#support=")).toBe(true);
    expect(link.includes("?")).toBe(false);
    expect(supportTokenFromHash(link.slice(link.indexOf("#")))).toBe("sup1.a+b/c=");
  });
  it("removes the token from the address bar once taken", () => {
    const calls = [];
    const win = { location: { hash: "#support=sup1.tok", pathname: "/business", search: "" }, history: { replaceState: (...a) => calls.push(a) } };
    expect(takeSupportTokenFromUrl(win)).toBe(true);
    expect(calls[0][2]).toBe("/business");
    expect(takeSupportTokenFromUrl({ location: { hash: "", pathname: "/business", search: "" } })).toBe(false);
  });
});
