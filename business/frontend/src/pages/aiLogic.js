// The plain rules behind the business AI page (P3-FE-6): where the business's AI stands, the credits meter, the Sheetal AI plan in the cart,
// and the exact bodies of the own-key and settings routes.
// Where it fits: AiPlan.jsx uses these; aiLogic.test.js checks them and parses every body with the API's own rules
// (business/backend/src/modules/aicredits/bodies.ts).
// Rules: the meter shows only the server's numbers; a key is sent once and never kept in the page's state after saving.

export const SHEETAL_AI_APP = "sheetal_ai";
export const OWN_AI = [
  { id: "ai.anthropic", name: "Claude (Anthropic)", kind: "text", hint: "Starts with sk-ant-" },
  { id: "ai.openai", name: "OpenAI", kind: "text", hint: "Starts with sk-" },
  { id: "ai.gemini", name: "Google Gemini", kind: "text", hint: "From Google AI Studio" },
  { id: "voice.elevenlabs", name: "ElevenLabs voice", kind: "voice", hint: "From your ElevenLabs profile" },
];

/** The AI state in words: locked (preview only), Sheetal AI (credits), or the business's own key. */
export const STATE_TEXT = {
  locked: { title: "AI is off", text: "Your apps show a preview of what AI would do. Choose a Sheetal AI plan, or connect your own AI account.", tone: "neutral" },
  sheetal: { title: "Sheetal AI is on", text: "Your apps use Sheetal AI and spend credits.", tone: "done" },
  own_key: { title: "Your own AI account is on", text: "Your apps use your own account. Sheetal credits are not spent.", tone: "done" },
};
export const stateOf = (s) => STATE_TEXT[s] || STATE_TEXT.locked;

/** The meter: credits left, used this month, and the share left of everything granted that is still valid. */
export function meterOf(credits) {
  const grants = credits?.grants || [];
  const total = grants.reduce((a, g) => a + (Number(g.credits) || 0), 0);
  const left = Number(credits?.balance) || 0;
  return { left, total, usedThisMonth: Number(credits?.thisMonth?.sheetalCredits) || 0, pctLeft: total > 0 ? Math.floor((left * 100) / total) : 0, nextExpiry: grants[0]?.expiresAt ?? null };
}

/** The cart item for a Sheetal AI plan (sold as a hidden app; a plan already paid for is a change). */
export const planItem = (planKey, periodMonths, mine) =>
  ({ kind: mine?.installed && mine?.periodMonths != null ? "change" : "subscribe", appId: SHEETAL_AI_APP, editionId: planKey, periodMonths: periodMonths === 12 ? 12 : 1 });

/** Saving a connection: only the fields filled in (an empty key keeps the saved one). */
export function ownKeyBody(values, version) {
  const out = {};
  for (const [k, v] of Object.entries(values || {})) { const t = String(v ?? "").trim(); if (t) out[k] = t; }
  return version == null ? { values: out } : { values: out, version };
}
export const settingsBody = (preferred, fallbackToSheetal) => ({ preferred: ["ai.anthropic", "ai.openai", "ai.gemini"].includes(preferred) ? preferred : "auto", fallbackToSheetal: !!fallbackToSheetal });
export const pauseBody = (reason) => ({ reason: String(reason || "").trim() });

/** A connection's state for a badge. */
export const CONN_TEXT = { none: ["Not connected", "neutral"], draft: ["Not connected", "neutral"], details_entered: ["Key saved: test it", "progress"], test_failed: ["Test failed", "problem"], test_passed: ["Test passed: switch it on", "progress"], live: ["On", "done"], paused: ["Paused", "action"] };
export const connText = (state) => CONN_TEXT[state] || [state, "neutral"];
