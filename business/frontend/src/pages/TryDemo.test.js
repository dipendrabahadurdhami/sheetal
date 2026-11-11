// Tests for the demo-visitor rule on the screen (the same rule as platform/src/demo/guard.ts).
import { describe, expect, it, vi } from "vitest";

vi.mock("@sheetal/sdk/client", () => ({ bizApi: () => Promise.resolve({}) }));
vi.mock("@sheetal/shared/core/ui", () => ({ Button: () => null, useToast: () => () => {} }));
vi.mock("@sheetal/shared/core/icons", () => ({ Icon: () => null }));

const { isDemoEmail } = await import("./TryDemo.jsx");

describe("demo visitor", () => {
  it("is known by the reserved email domain only", () => {
    expect(isDemoEmail("owner.abc123@demo.sheetal.invalid")).toBe(true);
    expect(isDemoEmail("Owner.ABC@DEMO.SHEETAL.INVALID")).toBe(true);
    expect(isDemoEmail("owner.agency.business@sheetal.test")).toBe(false);
    expect(isDemoEmail("")).toBe(false);
    expect(isDemoEmail(undefined)).toBe(false);
  });
});
