// The rules behind FormBuilder, with no React in them: which fields show, which are required, what a form's values must look like.
// Where it fits: FormBuilder and CrudPage call these; they are plain functions so they can be tested without a browser.
// How it works: a field definition (docs/architecture/FRONTEND-KIT.md section 6) may carry visibleWhen / requiredWhen / readOnlyWhen
// rules. A rule is { key, eq } | { key, in: [...] } | { key, notEmpty: true|false } looking at another field's value.
// Rules: client checks are only for speed (required, length, digits, size). The server is the judge and its 422 errors are shown under
// the fields; nothing here decides what may be saved.

/** Empty means "nothing entered": null, undefined, "" (after trimming) or an empty list. false and 0 are real answers. */
export function isEmpty(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Does `rule` hold for these values? No rule = true. Unknown rule shapes are false, so a typo hides a field rather than showing it by mistake. */
export function evalRule(rule, values = {}) {
  if (!rule) return true;
  const v = values[rule.key];
  if ("eq" in rule) return String(v ?? "") === String(rule.eq);
  if ("in" in rule) return Array.isArray(rule.in) && rule.in.map(String).includes(String(v ?? ""));
  if ("notEmpty" in rule) return rule.notEmpty === false ? isEmpty(v) : !isEmpty(v);
  return false;
}

/** { visible, required, readOnly } for one field right now. */
export function fieldState(field, values) {
  return {
    visible: field.visibleWhen ? evalRule(field.visibleWhen, values) : true,
    required: field.required === true || (field.requiredWhen ? evalRule(field.requiredWhen, values) : false),
    readOnly: field.readOnlyWhen ? evalRule(field.readOnlyWhen, values) : false,
  };
}

/** The fields to show for these values (and, with `context`, only branch fields that have choices). */
export function visibleFields(fields, values, context = {}) {
  return fields.filter((f) => fieldState(f, values).visible && !(f.type === "branch" && !(context.branches && context.branches.length)));
}

/** Only digits, as a string ("Rs. 1,250" → "1250"). Used by int and money fields. */
export const digits = (v) => String(v ?? "").replace(/\D/g, "");

/** Starting values for a new record: "" for text-like fields, false for toggles, null for files; `defaults` win. */
export function defaultValues(fields, defaults = {}) {
  const out = {};
  for (const f of fields) out[f.key] = f.type === "toggle" ? false : f.type === "file" ? null : "";
  return { ...out, ...defaults };
}

const MESSAGES = {
  "kit.required": "This is required.",
  "kit.tooLong": "Keep it under {n} characters.",
  "kit.tooSmall": "Must be at least {n}.",
  "kit.tooBig": "Must be at most {n}.",
  "kit.fileTooBig": "That file is over {n} MB.",
  "kit.fileType": "That file type isn't allowed.",
};
const say = (t, key, vars) => {
  if (t) return t(key, vars);
  let s = MESSAGES[key];
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(vars[k]);
  return s;
};

/**
 * Quick checks before sending: required, maxLength, min / max for numbers, file size and type. Returns { fieldKey: [message] }, empty when fine.
 * Hidden fields are never checked. `t` (optional) is the screen's translate function; without it English texts are used.
 */
export function validateFields(fields, values, { t } = {}) {
  const errors = {};
  const push = (key, msg) => { (errors[key] ||= []).push(msg); };
  for (const f of fields) {
    const st = fieldState(f, values);
    if (!st.visible || st.readOnly) continue;
    const v = values[f.key];
    const hasFile = f.type === "file" && (v instanceof Object && (v.existing || (typeof File !== "undefined" && v instanceof File) || v.size != null));
    if (st.required && f.type !== "toggle" && (f.type === "file" ? !hasFile : isEmpty(v))) { push(f.key, say(t, "kit.required")); continue; }
    if (isEmpty(v) && f.type !== "file") continue;
    if (f.maxLength && typeof v === "string" && v.length > f.maxLength) push(f.key, say(t, "kit.tooLong", { n: f.maxLength }));
    if (f.type === "int" || f.type === "money") {
      const n = Number(v);
      if (f.min != null && n < f.min) push(f.key, say(t, "kit.tooSmall", { n: f.min }));
      if (f.max != null && n > f.max) push(f.key, say(t, "kit.tooBig", { n: f.max }));
    }
    if (f.type === "file" && v && typeof v === "object" && !v.existing) {
      if (f.maxMB && v.size > f.maxMB * 1024 * 1024) push(f.key, say(t, "kit.fileTooBig", { n: f.maxMB }));
      if (f.accept && v.type && !f.accept.split(",").map((x) => x.trim()).some((a) => (a.endsWith("/*") ? v.type.startsWith(a.slice(0, -1)) : a === v.type))) push(f.key, say(t, "kit.fileType"));
    }
  }
  return errors;
}

/**
 * A request body from the values: visible, editable fields only. int and money become numbers, text is trimmed and an empty optional
 * text becomes null, toggles stay true/false, files are left out (CrudPage uploads them in a second request), empty branch is left out.
 */
export function buildBody(fields, values) {
  const body = {};
  for (const f of fields) {
    const st = fieldState(f, values);
    if (!st.visible || st.readOnly || f.type === "file") continue;
    const v = values[f.key];
    if (f.type === "int" || f.type === "money") { if (!isEmpty(v)) body[f.key] = Number(v); else if (!st.required) body[f.key] = null; continue; }
    if (f.type === "toggle") { body[f.key] = !!v; continue; }
    if (f.type === "branch") { if (!isEmpty(v)) body[f.key] = v; continue; }
    body[f.key] = isEmpty(v) ? (st.required ? "" : null) : typeof v === "string" ? v.trim() : v;
  }
  return body;
}

/** The first field (in form order) that has an error, so the form can put the cursor there. */
export const firstInvalidKey = (fields, errors) => fields.find((f) => errors?.[f.key]?.length)?.key ?? Object.keys(errors || {})[0] ?? null;
