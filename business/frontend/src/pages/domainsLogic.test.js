import { describe, expect, it } from "vitest";
import { shortName } from "./domainsLogic.js";

describe("shortName: what to type in a provider's Name box", () => {
  it("is @ for the domain itself", () => expect(shortName("everestinn.com", "everestinn.com")).toBe("@"));
  it("drops the domain from the end", () => {
    expect(shortName("_sheetal-verify.everestinn.com", "everestinn.com")).toBe("_sheetal-verify");
    expect(shortName("sheetal._domainkey.everestinn.com", "everestinn.com")).toBe("sheetal._domainkey");
    expect(shortName("_dmarc.everestinn.com", "everestinn.com")).toBe("_dmarc");
  });
  it("leaves a name that is not under the domain alone", () => expect(shortName("other.test", "everestinn.com")).toBe("other.test"));
  it("does not cut a name that only ends with the same letters", () => expect(shortName("noteverestinn.com", "everestinn.com")).toBe("noteverestinn.com"));
});
