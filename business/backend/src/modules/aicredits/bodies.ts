// The request bodies of Business -> AI (P3-FE-6), in their own file so the AI page's tests parse what it sends with the same rules (TEAM-RULES #12).
// Where it fits: own-keys.ts parses with these; business/frontend/src/pages/aiLogic.test.js builds bodies and parses them here.
// Rules: plain zod only (no server imports); every object is .strict().

import { z } from "zod";

/** The four AI providers a business may connect its own account to (text: Claude, OpenAI, Gemini; voice: ElevenLabs). */
export const OWN_AI_IDS = ["ai.anthropic", "ai.openai", "ai.gemini", "voice.elevenlabs"] as const;

export const OwnKeySave = z.object({ values: z.record(z.string().max(60), z.string().max(4000)), version: z.number().int().min(0).optional() }).strict();
export const OwnKeyPause = z.object({ reason: z.string().trim().max(400).default("") }).strict();
export const AiSettingsBody = z.object({ preferred: z.enum(["auto", "ai.anthropic", "ai.openai", "ai.gemini"]), fallbackToSheetal: z.boolean() }).strict();
