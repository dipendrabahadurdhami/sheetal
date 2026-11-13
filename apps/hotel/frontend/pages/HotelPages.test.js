// Tests for the hotel screens on the kit: kit and SDK only, and LiveOps.jsx is now only the old names over the apps' pages.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./HotelPages.jsx", import.meta.url), "utf8");
const ops = readFileSync(new URL("../../../../business/frontend/src/pages/LiveOps.jsx", import.meta.url), "utf8");

describe("Hotel screens on the kit", () => {
  it("import the kit and the SDK only", () => {
    expect(src).toContain('from "@sheetal/ui/primitives"');
    expect(src).toContain('from "@sheetal/sdk/hooks"');
    expect(src.split("\n").filter((l) => l.startsWith("import ")).join("\n")).not.toMatch(/@sheetal\/shared\/core\/ui|from "\.\.\//);
    expect(src).not.toMatch(/useApi\([^)]*, \[tenant\.id\]\)/);
  });
  it("LiveOps.jsx keeps the old names and has no screen code left", () => {
    expect(ops).toContain('export { FrontDeskPage as LiveFrontDesk, BookingsPage as LiveBookings, CalendarPage as LiveCalendar } from "@sheetal/app-hotel/frontend";');
    expect(ops).not.toMatch(/^export function /m);
    expect(ops).not.toContain("bizApi");
  });
});
