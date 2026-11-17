import { describe, expect, it } from "vitest";
import { HELP_GUIDES, guideFor, nextStep, searchGuides, withWords } from "./setupGuide.js";

const ids = ["details", "logo", "first", "team", "email", "verify", "apps"];
const steps = (done = []) => ids.map((id) => ({ id, done: done.includes(id), optional: ["team", "email", "verify", "apps"].includes(id), to: `/x/${id}` }));

describe("setup guide words", () => {
  it("has words for every step the server sends, for every business type", () => {
    for (const type of ["agency", "hotel", "host", "developer", "sponsor"]) {
      for (const id of ids) {
        const g = guideFor(type, id);
        expect(g.title, `${type}/${id}`).toBeTruthy();
        expect(g.how.length).toBeGreaterThanOrEqual(3);
        expect(g.cta).toBeTruthy();
      }
    }
  });
  it("changes the first step for the kind of business", () => {
    expect(guideFor("agency", "first").title).toBe("Add your first listing");
    expect(guideFor("hotel", "first").title).toBe("Add your rooms");
    expect(withWords("hotel", steps()).find((s) => s.id === "first").to).toBe("/business/calendar");
    expect(withWords("agency", steps()).find((s) => s.id === "first").to).toBe("/x/first");
  });
  it("points at the first step still to do, required before optional", () => {
    expect(nextStep(steps()).id).toBe("details");
    expect(nextStep(steps(["details"])).id).toBe("logo");
    expect(nextStep(steps(["details", "logo", "first"])).id).toBe("team");
    expect(nextStep(steps(ids))).toBeNull();
  });
  it("searches the help guides in the question and in the steps", () => {
    expect(searchGuides("").length).toBe(HELP_GUIDES.length);
    expect(searchGuides("cloudflare").map((g) => g.id)).toEqual(["email"]);
    expect(searchGuides("zzzz")).toEqual([]);
  });
});
