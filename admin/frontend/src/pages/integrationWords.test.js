// Tests for the Integration Center screen rules.
import { describe, expect, it } from "vitest";
import { actionsOf, badgeOf, hasSecret, saveBody, tabsOf } from "./integrationWords.js";

const spec = { id: "khalti", built: true, modes: ["test", "live"], fields: [{ key: "merchantCode" }, { key: "secretKey", secret: true }] };
const conn = (over = {}) => ({ state: "details_entered", mode: "test", stagedConfig: null, has: { test: [], live: [], staged: [] }, health: { status: "unknown" }, ...over });
const row = (over = {}, extra = {}) => ({ spec, connection: conn(over), stagedTested: false, ...extra });

describe("integration center screen", () => {
  it("shows the state, or the health of a live connection that is not well", () => {
    expect(badgeOf(conn({ state: "none" }))).toEqual({ label: "Not set up", tone: "neutral" });
    expect(badgeOf(conn({ state: "live", health: { status: "healthy" } }))).toEqual({ label: "Live", tone: "ok" });
    expect(badgeOf(conn({ state: "live", health: { status: "down" } })).tone).toBe("danger");
    expect(badgeOf(conn({ state: "paused" })).label).toBe("Paused");
  });
  it("offers only the buttons that make sense for the state", () => {
    expect(actionsOf(row({ state: "none" }), true)).toMatchObject({ save: true, test: false, goLive: false, disconnect: false });
    expect(actionsOf(row({ state: "details_entered" }), true)).toMatchObject({ test: true, goLive: false });
    expect(actionsOf(row({ state: "test_passed" }), true)).toMatchObject({ goLive: true, pause: false });
    expect(actionsOf(row({ state: "live" }), true)).toMatchObject({ pause: true, resume: false, apply: false, testStaged: false });
    expect(actionsOf(row({ state: "live", stagedConfig: {} }), true)).toMatchObject({ testStaged: true, apply: false });
    expect(actionsOf(row({ state: "live", stagedConfig: {} }, { stagedTested: true }), true).apply).toBe(true);
    expect(actionsOf(row({ state: "paused" }), true)).toMatchObject({ resume: true, pause: false });
    expect(Object.values(actionsOf(row({ state: "live" }), false)).every((v) => v === false)).toBe(true);
  });
  it("a shell is never offered Go live", () => {
    expect(actionsOf({ spec: { ...spec, built: false }, connection: conn({ state: "test_passed" }) }, true).goLive).toBe(false);
  });
  it("opens the live details tab only after a passing test", () => {
    expect(tabsOf(row({ state: "details_entered" })).map((t) => t.open)).toEqual([true, false]);
    expect(tabsOf(row({ state: "test_passed" })).map((t) => t.open)).toEqual([true, true]);
    expect(tabsOf(row({ state: "live" })).map((t) => t.open)).toEqual([false, true]);
    expect(tabsOf({ spec: { ...spec, modes: ["live"] }, connection: conn() })).toEqual([{ id: "live", label: "Details", open: true }]);
  });
  it("sends only what was typed and never an empty secret", () => {
    expect(saveBody(spec, { merchantCode: " ABC ", secretKey: "" }, "test", 3)).toEqual({ values: { merchantCode: "ABC" }, mode: "test", version: 3 });
    expect(saveBody(spec, { secretKey: " k1 " }, "live")).toEqual({ values: { secretKey: " k1 " }, mode: "live" });
    expect(saveBody(spec, { merchantCode: "" }, "test").values).toEqual({ merchantCode: "" });   // clearing a plain field is allowed
  });
  it("knows when a secret is already saved", () => {
    expect(hasSecret(conn({ has: { test: ["secretKey"], live: [], staged: [] } }), "secretKey", "test")).toBe(true);
    expect(hasSecret(conn({ has: { test: ["secretKey"], live: [], staged: [] } }), "secretKey", "live")).toBe(false);
    expect(hasSecret(conn({ state: "live", has: { test: [], live: [], staged: ["secretKey"] } }), "secretKey", "live")).toBe(true);
  });
});
