// Field checks and safe words for the Integration Center (INTEGRATIONS.md sections 2 and 6.3).
// Where it fits: every provider's validate() is validateFields(spec.fields, …); adapters build their check messages with safeMessage().
// Rules: pure. A message never carries a value that was typed into a secret field, and never more than 200 characters of what a provider answered.

import type { Check, IntegrationField, IntegrationInput, Mode, ValidationResult } from "./types.js";

/** Checks the SHAPE of what was typed. `partial` = only the fields that were sent (a save may send one field); required-ness is checked by missingFields(). */
export function validateFields(fields: readonly IntegrationField[], input: IntegrationInput): ValidationResult {
  const errors: Record<string, string[]> = {};
  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(input)) if (!known.has(key)) errors[key] = ["This field is not part of this connection."];
  for (const f of fields) {
    const v = input[f.key];
    if (v === undefined || v === "") continue;
    const max = f.maxLength ?? 500;
    if (v.length > max) { errors[f.key] = [`Keep it under ${max} characters.`]; continue; }
    if (f.options && !f.options.some((o) => o.id === v)) { errors[f.key] = ["Choose one of the options."]; continue; }
    if (f.pattern && !new RegExp(`^(?:${f.pattern})$`).test(v)) errors[f.key] = [f.message ?? `${f.label.en} does not look right.`];
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** The required fields still empty, for one mode: plain fields from `config`, secret fields from the names saved for that mode. */
export function missingFields(fields: readonly IntegrationField[], config: Record<string, string>, secretNames: readonly string[], mode: Mode): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    if (f.secret) { if ((!f.modes || f.modes.includes(mode)) && !secretNames.includes(f.key)) out.push(f.key); }
    else if (!config[f.key]) out.push(f.key);
  }
  return out;
}

const LOOKS_LIKE_A_KEY = /[A-Za-z0-9_\-/+=.:&]{20,}/g;
/** A provider's answer made safe to store and show: anything that looks like a key is removed and the text is cut to 200 characters. */
export function safeMessage(text: unknown, secrets: readonly (string | undefined)[] = []): string {
  let s = String(text ?? "").replace(/\s+/g, " ").trim();
  for (const x of secrets) if (x && x.length >= 4) s = s.split(x).join("[hidden]");
  s = s.replace(LOOKS_LIKE_A_KEY, "[hidden]");
  return s.length > 200 ? `${s.slice(0, 197)}...` : s;
}

export const check = (name: string, ok: boolean, message: string): Check => ({ name, ok, message });
export const allOk = (checks: readonly Check[]): boolean => checks.length > 0 && checks.every((c) => c.ok);
