// Tests for the reason rule of "Open as support" (the same limits as the server).
import { describe, expect, it, vi } from "vitest";

vi.mock("@sheetal/shared/core/ui", () => ({}));
vi.mock("@sheetal/shared/core/icons", () => ({ Icon: () => null }));
vi.mock("../api", () => ({ adminApi: () => Promise.resolve({}) }));

const { reasonProblem } = await import("./OpenAsSupport.jsx");

describe("open as support", () => {
  it("asks for a reason of 10 to 300 characters", () => {
    expect(reasonProblem("short")).toMatch(/at least 10/);
    expect(reasonProblem("   Ticket 1042: owner cannot see the rent bill   ")).toBeNull();
    expect(reasonProblem("x".repeat(301))).toMatch(/under 300/);
  });
});
