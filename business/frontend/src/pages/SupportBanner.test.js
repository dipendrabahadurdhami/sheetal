// Tests for the words of the support-session bar.
import { describe, expect, it, vi } from "vitest";

vi.mock("@sheetal/sdk/client", () => ({ bizApi: () => Promise.resolve({ data: {} }) }));
vi.mock("@sheetal/shared/core/ui", () => ({ Button: () => null, useToast: () => () => {} }));
vi.mock("@sheetal/shared/core/icons", () => ({ Icon: () => null }));

const { supportBannerText } = await import("./SupportBanner.jsx");

describe("support banner", () => {
  it("names the business, the reason, the mode and the time left", () => {
    expect(supportBannerText({ business: "Test Realty", reason: "Ticket 42: rent bill wrong", readOnly: true, minutesLeft: 12 }))
      .toBe("You are viewing Test Realty as Sheetal support · Ticket 42: rent bill wrong · read-only · 12 min left");
    expect(supportBannerText({ business: "X", reason: "r", readOnly: false, minutesLeft: 0 })).toMatch(/changes allowed and recorded · ending now$/);
  });
});
