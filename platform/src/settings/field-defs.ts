// The field builder: the format of a form's fields, the rules for changing a form, and who may see which answer (SETTINGS.md section 5).
// Where it fits: defs.ts stores each form as the setting "platform.fieldDefs.<formId>" (seeded from FORM_SEEDS); the admin Field builder screen edits it;
// the form drawn for a business is the same list (packages/ui FormBuilder understands these fields).
// How it works: checkFormChange(old, next) refuses the changes that would lose answers: a field is ARCHIVED, never deleted; its key and type never change;
// a locked field (one a built-in feature needs) keeps its key, type and "required". projectFields() is the one place visibility is applied.
// Rules: pure. The seeds below are examples for the owner to confirm; nothing here says what Nepali law requires.

import { z } from "zod";

const text = z.object({ en: z.string().trim().min(1).max(120), ne: z.string().trim().max(120).optional() }).strict();
const helpText = z.object({ en: z.string().trim().max(300), ne: z.string().trim().max(300).optional() }).strict();
export const FIELD_TYPES = ["text", "textarea", "number", "money", "date", "select", "multiselect", "checkbox", "phone", "email", "url", "pan", "address", "file", "image"] as const;
export const FILLED_BY = ["business_owner", "business_staff", "platform_staff", "system", "anyone_with_link"] as const;
const READERS = ["platform_staff", "business_owner", "business_staff"] as const;

export const FieldDef = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "Use small letters, digits and _ (for example registration_number)."),
  type: z.enum(FIELD_TYPES),
  label: text,
  help: helpText.optional(),
  options: z.array(z.object({ value: z.string().trim().min(1).max(60), label: text }).strict()).max(60).optional(),
  validation: z.object({ min: z.number().optional(), max: z.number().optional(), minLength: z.number().int().min(0).optional(), maxLength: z.number().int().min(1).max(5000).optional(), pattern: z.string().max(200).optional() }).strict().optional(),
  required: z.boolean(),
  filledBy: z.enum(FILLED_BY),
  visibility: z.enum(["public", "private"]),
  readBy: z.array(z.enum(READERS)).max(3).optional(),
  editableAfter: z.enum(["always", "until_verified", "never"]).default("always"),
  file: z.object({ types: z.array(z.enum(["pdf", "jpg", "png"])).min(1), maxMB: z.number().min(0.1).max(25), expires: z.boolean().optional() }).strict().optional(),
  group: z.string().trim().max(60).optional(),
  order: z.number().int().min(0).max(10_000),
  locked: z.boolean().optional(),
  archivedAt: z.string().datetime().optional(),
}).strict().superRefine((f, ctx) => {
  if ((f.type === "select" || f.type === "multiselect") && !f.options?.length) ctx.addIssue({ code: "custom", message: "A choice field needs at least one option.", path: ["options"] });
  if ((f.type === "file" || f.type === "image") && !f.file) ctx.addIssue({ code: "custom", message: "A file field needs its file types and size.", path: ["file"] });
  if (f.validation?.pattern) { try { new RegExp(f.validation.pattern); } catch { ctx.addIssue({ code: "custom", message: "The pattern is not valid.", path: ["validation", "pattern"] }); } }
});
export type FieldDef = z.infer<typeof FieldDef>;

export const FormDef = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_.]{1,60}$/),
  scope: z.enum(["platform", "business"]),
  label: text,
  fields: z.array(FieldDef).max(80),
  version: z.number().int().min(1),
}).strict().superRefine((f, ctx) => {
  const seen = new Set<string>();
  f.fields.forEach((x, i) => { if (seen.has(x.key)) ctx.addIssue({ code: "custom", message: `The key "${x.key}" is used twice.`, path: ["fields", i, "key"] }); seen.add(x.key); });
});
export type FormDef = z.infer<typeof FormDef>;

/** Why a change to a form is refused, as a plain sentence; null = allowed. */
export function checkFormChange(prev: FormDef, next: FormDef): string | null {
  if (next.id !== prev.id || next.scope !== prev.scope) return "A form's id and scope cannot change.";
  const after = new Map(next.fields.map((f) => [f.key, f]));
  for (const old of prev.fields) {
    const now = after.get(old.key);
    if (!now) return `"${old.label.en}" cannot be deleted because answers may exist. Archive it instead: it disappears from new forms and old answers are kept.`;
    if (now.type !== old.type) return `The type of "${old.label.en}" cannot change. Archive it and add a new field.`;
    if (old.locked) {
      if (!now.locked) return `"${old.label.en}" is needed by Sheetal itself and stays locked.`;
      if (now.archivedAt) return `"${old.label.en}" is needed by Sheetal itself and cannot be archived.`;
      if (old.required && !now.required) return `"${old.label.en}" is needed by Sheetal itself and must stay required.`;
    }
  }
  for (const f of next.fields) if (f.locked && !prev.fields.some((o) => o.key === f.key && o.locked)) return "Only Sheetal's own built-in fields can be locked.";
  return null;
}

/** The form with its version moved on by one (every save of a changed form). */
export const bumped = (prev: FormDef, next: FormDef): FormDef => ({ ...next, version: prev.version + 1 });

export type Viewer = "platform_staff" | "business_owner" | "business_staff" | "public";
/** The fields a viewer may read. Staff and owners never see what `readBy` leaves out; the public only ever sees "public" fields. Archived fields are for staff only. */
export function readableFields(form: FormDef, viewer: Viewer): FieldDef[] {
  return form.fields.filter((f) => {
    if (viewer === "public") return f.visibility === "public" && !f.archivedAt;
    if (f.archivedAt && viewer !== "platform_staff") return false;
    if (f.visibility === "public") return true;
    const readers: readonly string[] = f.readBy ?? ["platform_staff", f.filledBy === "business_staff" ? "business_staff" : "business_owner"];
    return readers.includes(viewer) || (viewer === "business_owner" && readers.includes("business_staff"));
  }).sort((a, b) => a.order - b.order);
}
/** The answers a viewer may read: the one place visibility is applied. */
export function projectFields(form: FormDef, answers: Record<string, unknown>, viewer: Viewer): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of readableFields(form, viewer)) if (Object.hasOwn(answers, f.key)) out[f.key] = answers[f.key];
  return out;
}

type Seed = Omit<FieldDef, "order" | "editableAfter" | "filledBy" | "visibility" | "required"> & Partial<Pick<FieldDef, "editableAfter" | "filledBy" | "visibility" | "required">>;
const fields = (filledBy: FieldDef["filledBy"], list: Seed[]): FieldDef[] => list.map((f, i) => ({ required: false, filledBy, visibility: "private" as const, editableAfter: "always" as const, ...f, order: (i + 1) * 10 }));
const docs = { types: ["pdf", "jpg", "png"] as ("pdf" | "jpg" | "png")[], maxMB: 5 };

/** The forms that exist from the first start. All editable on the Field builder screen. EXAMPLES for the owner to confirm. */
export const FORM_SEEDS: readonly FormDef[] = [
  { id: "company_profile", scope: "platform", label: { en: "Sheetal's company profile" }, version: 1, fields: fields("platform_staff", [
    { key: "legal_name", type: "text", label: { en: "Legal name" }, required: true, locked: true, visibility: "public" },
    { key: "tax_number", type: "pan", label: { en: "Tax registration number" }, required: true, locked: true, visibility: "public" },
    { key: "address", type: "address", label: { en: "Registered address" }, required: true, visibility: "public" },
    { key: "phone", type: "phone", label: { en: "Contact phone" }, visibility: "public" },
    { key: "email", type: "email", label: { en: "Contact email" }, visibility: "public" },
    { key: "signatory", type: "text", label: { en: "Authorised signatory" } },
    { key: "bank_details", type: "textarea", label: { en: "Bank details for manual transfers" } },
  ]) },
  { id: "business_profile", scope: "business", label: { en: "Business profile" }, version: 1, fields: fields("business_owner", [
    { key: "name", type: "text", label: { en: "Business name", ne: "व्यवसायको नाम" }, required: true, locked: true, visibility: "public" },
    { key: "tax_number", type: "pan", label: { en: "Tax registration number" }, editableAfter: "until_verified" },
    { key: "phone", type: "phone", label: { en: "Phone", ne: "फोन" }, visibility: "public" },
    { key: "email", type: "email", label: { en: "Email", ne: "इमेल" }, visibility: "public" },
    { key: "address", type: "address", label: { en: "Address", ne: "ठेगाना" }, visibility: "public" },
    { key: "website", type: "url", label: { en: "Website" }, visibility: "public" },
    { key: "about", type: "textarea", label: { en: "About the business" }, visibility: "public", validation: { maxLength: 1000 } },
  ]) },
  { id: "business_verification", scope: "business", label: { en: "Business verification" }, version: 1, fields: fields("business_owner", [
    { key: "tax_certificate", type: "file", label: { en: "Tax registration certificate" }, required: true, file: docs },
    { key: "company_registration", type: "file", label: { en: "Company registration" }, required: true, file: docs },
    { key: "owner_id_front", type: "image", label: { en: "Owner's citizenship (front)" }, required: true, file: { types: ["jpg", "png"], maxMB: 5 } },
    { key: "owner_id_back", type: "image", label: { en: "Owner's citizenship (back)" }, required: true, file: { types: ["jpg", "png"], maxMB: 5 } },
    { key: "address_proof", type: "file", label: { en: "Address proof" }, file: { types: ["pdf", "jpg"], maxMB: 5 } },
  ]) },
];
