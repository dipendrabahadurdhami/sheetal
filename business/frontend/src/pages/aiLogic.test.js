// Tests for the business AI page (P3-FE-6): every body the page sends passes the API's own rules (business/backend/src/modules/aicredits/bodies.ts),
// a Sheetal AI plan goes into the cart as the API's item, the meter equals the server's numbers, and key fields are write-only.
// Where it fits: the root front-end test run (npx vitest run business/frontend).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AiSettingsBody, OWN_AI_IDS, OwnKeyPause, OwnKeySave } from "../../../../business/backend/src/modules/aicredits/bodies.ts";
import { Cart } from "../../../../business/backend/src/modules/marketplace/bodies.ts";
import { OWN_AI, SHEETAL_AI_APP, connText, meterOf, ownKeyBody, pauseBody, planItem, settingsBody, stateOf } from "./aiLogic.js";
import { addToCart, quoteBody } from "./marketplaceLogic.js";

const src = readFileSync(new URL("./AiPlan.jsx", import.meta.url), "utf8");

describe("bodies the AI page sends", () => {
  it("own key save (only filled fields; an empty key keeps the saved one), pause, settings", () => {
    expect(ownKeyBody({ apiKey: "  sk-ant-x  ", model: "" }, 3)).toEqual({ values: { apiKey: "sk-ant-x" }, version: 3 });
    expect(() => OwnKeySave.parse(ownKeyBody({ apiKey: "sk-ant-x" }, 0))).not.toThrow();
    expect(() => OwnKeySave.parse(ownKeyBody({ voiceId: "abc" }))).not.toThrow();
    expect(() => OwnKeyPause.parse(pauseBody("Paused by the business"))).not.toThrow();
    expect(AiSettingsBody.parse(settingsBody("ai.openai", 1))).toEqual({ preferred: "ai.openai", fallbackToSheetal: true });
    expect(settingsBody("voice.elevenlabs", false).preferred).toBe("auto"); // voice is never the text provider
    expect(OWN_AI.map((p) => p.id)).toEqual([...OWN_AI_IDS]);
  });
  it("a Sheetal AI plan is the API's own cart item (subscribe, or change when already paid)", () => {
    const item = planItem("lite", 12);
    expect(item).toEqual({ kind: "subscribe", appId: SHEETAL_AI_APP, editionId: "lite", periodMonths: 12 });
    expect(planItem("plus", 1, { installed: true, periodMonths: 1 }).kind).toBe("change");
    expect(() => Cart.parse(quoteBody(addToCart({ items: [] }, item)))).not.toThrow();
  });
});

describe("the meter and the state equal the server's", () => {
  it("credits left, used this month, share left, first expiry", () => {
    const credits = { balance: 750, grants: [{ credits: 100, remaining: 50, expiresAt: "2026-12-01T00:00:00Z" }, { credits: 1000, remaining: 700, expiresAt: "2027-01-01T00:00:00Z" }], thisMonth: { sheetalCredits: 350 } };
    expect(meterOf(credits)).toEqual({ left: 750, total: 1100, usedThisMonth: 350, pctLeft: 68, nextExpiry: "2026-12-01T00:00:00Z" });
    expect(meterOf({})).toEqual({ left: 0, total: 0, usedThisMonth: 0, pctLeft: 0, nextExpiry: null });
    expect([stateOf("locked").title, stateOf("sheetal").title, stateOf("own_key").title, stateOf(undefined).title]).toEqual(["AI is off", "Sheetal AI is on", "Your own AI account is on", "AI is off"]);
    expect(connText("live")).toEqual(["On", "done"]);
  });
});

describe("key fields are write-only", () => {
  it("password inputs with no autocomplete, cleared after saving, never filled from the server", () => {
    expect(src).toContain('type={f.secret ? "password" : "text"} autoComplete="off"');
    expect(src).toContain('value={values[f.key] ?? ""}');
    expect(src).toContain(".then(() => setValues({}))");
    expect(src).not.toMatch(/connection\.config|apiKey:\s*c\./);
  });
  it("the page is shown only on per-app billing; today's page stays for plans", () => {
    const app = readFileSync(new URL("./BusinessApp.jsx", import.meta.url), "utf8");
    expect(app).toContain("{onApps ? <AiPlan key={tenant.id} tenant={tenant} /> : <LiveAiAccounts key={tenant.id} tenant={tenant} />}");
  });
});
