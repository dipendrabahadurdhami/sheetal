// Online forms: the fields a form may have, checking answers against them, plan limits, and matching requirement
// answers to the business's listings.
// Where it fits: the business API saves and publishes forms (business/backend/src/modules/forms); the website API
// shows a live form and takes responses (website/backend/src/modules/forms).
// How it works: `fields` is the builder's list (shared/src/core/forms.js makes them). checkAnswers() reads what a
// visitor sent, field by field, with the same rules the form page shows; files arrive as { name, data } (base64) and
// are saved by the route afterwards.
// Rules: free plans (and trials) get 2 forms and 100 responses a month unless the plan sets limits.forms /
// limits.formResponses; -1 = no limit.

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { Db } from "../lib/db.js";
import { dayOf, ymd } from "./money.js";
import { nepalDay } from "./payouts.js";

type Tx = Db | Prisma.TransactionClient;

export const FIELD_TYPES = ["short", "long", "phone", "email", "number", "money", "date", "time", "single", "multi", "dropdown", "rating", "file", "location", "payment", "section", "page"] as const;
export const NO_ANSWER = ["section", "page"];
export const CHOICE = ["single", "multi", "dropdown"];
export const FILE_TYPES = ["file", "payment"];
export const DESTS = ["leads", "jobs", "requirements"] as const;
export const DEST_LABEL: Record<string, string> = { leads: "Lead", jobs: "Job application", requirements: "Requirement" };
/** Largest file a visitor can send in a form (a CV, an ID, a payment screenshot). */
export const FORM_FILE_MAX = 5 * 1024 * 1024;

const numText = z.union([z.string().trim().regex(/^\d{0,12}$/, "Use whole numbers."), z.number().int().min(0).max(1e12).transform(String)]).optional().default("");
export const FieldSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Bad field id."),
  type: z.enum(FIELD_TYPES),
  label: z.string().trim().max(200).default(""),
  required: z.boolean().default(false),
  ph: z.string().max(200).default(""),
  help: z.string().max(500).default(""),
  half: z.boolean().default(false),
  min: numText,
  max: numText,
  opts: z.array(z.string().trim().max(120)).max(50).default([]),
  amount: z.number().int().min(0).max(10_000_000).default(0),
});
export type FormField = z.infer<typeof FieldSchema>;
export const FieldsSchema = z.array(FieldSchema).max(100, "A form can have up to 100 fields.")
  .refine((a) => new Set(a.map((f) => f.id)).size === a.length, "Two fields have the same id.");

export const slugify = (s: string) => String(s || "form").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "form";

/** What stops a form going live (null when it can). */
export function publishProblem(fields: FormField[], pay: { qrUrl?: string; esewa?: string; bank?: string }): string | null {
  const asked = fields.filter((f) => !NO_ANSWER.includes(f.type));
  if (!asked.length) return "Add at least one question before publishing.";
  const blank = asked.find((f) => !f.label.trim());
  if (blank) return "Every question needs a label.";
  const noOpts = fields.find((f) => CHOICE.includes(f.type) && (!f.opts.length || f.opts.some((o) => !o)));
  if (noOpts) return `Fill in every option of "${noOpts.label}".`;
  const payF = fields.find((f) => f.type === "payment");
  if (payF && payF.amount < 1) return `Set the amount for "${payF.label}".`;
  if (payF && !pay.qrUrl && !pay.esewa?.trim() && !pay.bank?.trim()) return "Add your QR, eSewa ID or bank details in Form settings (Payment details).";
  return null;
}

export interface Answer { id: string; label: string; type: string; value: unknown; text: string }
/** A file a visitor sent, still to be saved: the field, the file name they picked and the bytes. */
export interface PendingFile { fieldId: string; name: string; data: Buffer }

const rs = (n: number) => `Rs. ${n.toLocaleString("en-IN")}`;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const isBlank = (v: unknown) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.values(v as object).some(Boolean));
const fileOf = (v: unknown) => {
  const o = (v ?? {}) as { name?: unknown; data?: unknown };
  return typeof o.data === "string" && o.data.length > 10 ? { name: typeof o.name === "string" ? o.name.replace(/[^\w .()-]/g, "").slice(0, 120) || "file" : "file", data: o.data } : null;
};

/** Checks every answer against its field. Returns field errors (keyed by field id), the answers as stored, and the
 *  files to save. Answers to fields the form doesn't have are ignored. */
export function checkAnswers(fields: FormField[], raw: Record<string, unknown>) {
  const errors: Record<string, string[]> = {};
  const answers: Answer[] = [];
  const files: PendingFile[] = [];
  const fail = (f: FormField, m: string) => { errors[f.id] = [m]; };
  for (const f of fields) {
    if (NO_ANSWER.includes(f.type)) continue;
    const v = raw[f.id];
    const label = f.label || "Question";
    if (f.type === "file" || f.type === "payment") {
      const file = fileOf(v);
      if (!file) { if (f.required) fail(f, f.type === "payment" ? "Upload the payment screenshot" : "Upload a file"); continue; }
      if (file.data.length > Math.ceil(FORM_FILE_MAX / 3) * 4 + 4) { fail(f, "Files can be up to 5 MB."); continue; }
      files.push({ fieldId: f.id, name: file.name, data: Buffer.from(file.data, "base64") });
      answers.push({ id: f.id, label, type: f.type, value: f.type === "payment" ? { amount: f.amount, name: file.name } : { name: file.name }, text: f.type === "payment" ? `${rs(f.amount)} · screenshot ${file.name}` : file.name });
      continue;
    }
    if (isBlank(v)) { if (f.required) fail(f, CHOICE.includes(f.type) || f.type === "rating" ? "Pick an answer" : f.type === "location" ? "Pick a district" : "This question is required"); continue; }
    switch (f.type) {
      case "short": case "long": {
        const s = str(v); const max = Number(f.max) || (f.type === "short" ? 300 : 5000);
        if (!s) { if (f.required) fail(f, "This question is required"); break; }
        if (s.length > max) { fail(f, `Up to ${max} characters`); break; }
        answers.push({ id: f.id, label, type: f.type, value: s, text: s }); break;
      }
      case "phone": {
        const s = str(v).replace(/[^\d+]/g, "");
        const digits = s.replace(/\D/g, "");
        if (digits.length < 7 || digits.length > 15) { fail(f, "Enter a 10-digit mobile number"); break; }
        answers.push({ id: f.id, label, type: f.type, value: s, text: s }); break;
      }
      case "email": {
        const s = str(v).toLowerCase();
        if (!z.email().safeParse(s).success || s.length > 200) { fail(f, "Enter an email like you@example.com"); break; }
        answers.push({ id: f.id, label, type: f.type, value: s, text: s }); break;
      }
      case "number": case "money": {
        const s = str(v).replace(/,/g, "");
        // Money may carry "Rs." or spaces, but must still hold a digit ("lots" is not an amount, not 0).
        const digits = f.type === "money" ? s.replace(/[^\d.]/g, "") : s;
        const n = Number(digits);
        if (!s || !digits || !Number.isFinite(n) || n < 0 || n > 1e13) { fail(f, "Enter a number"); break; }
        if (f.min && n < Number(f.min)) { fail(f, `Minimum is ${f.type === "money" ? rs(Number(f.min)) : f.min}`); break; }
        if (f.max && n > Number(f.max)) { fail(f, `Maximum is ${f.type === "money" ? rs(Number(f.max)) : f.max}`); break; }
        const val = f.type === "money" ? Math.round(n) : n;
        answers.push({ id: f.id, label, type: f.type, value: val, text: f.type === "money" ? rs(val) : String(val) }); break;
      }
      case "date": {
        const s = str(v);
        const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? dayOf(s) : null;
        if (!d || Number.isNaN(d.getTime()) || ymd(d) !== s) { fail(f, "Pick a date"); break; }
        answers.push({ id: f.id, label, type: f.type, value: s, text: s }); break;
      }
      case "time": {
        const s = str(v);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) { fail(f, "Pick a time"); break; }
        answers.push({ id: f.id, label, type: f.type, value: s, text: s }); break;
      }
      case "single": case "dropdown": {
        const s = str(v);
        if (!f.opts.includes(s)) { fail(f, "Pick one of the options"); break; }
        answers.push({ id: f.id, label, type: f.type, value: s, text: s }); break;
      }
      case "multi": {
        const a = (Array.isArray(v) ? v : [v]).map(str).filter(Boolean);
        if (a.some((x) => !f.opts.includes(x))) { fail(f, "Pick from the options"); break; }
        const picked = f.opts.filter((o) => a.includes(o));
        if (!picked.length) { if (f.required) fail(f, "Pick an answer"); break; }
        answers.push({ id: f.id, label, type: f.type, value: picked, text: picked.join(", ") }); break;
      }
      case "rating": {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 5) { fail(f, "Pick 1 to 5 stars"); break; }
        answers.push({ id: f.id, label, type: f.type, value: n, text: `${n} of 5` }); break;
      }
      case "location": {
        const o = (typeof v === "object" && v ? v : {}) as { district?: unknown; area?: unknown };
        const district = str(o.district).slice(0, 60), area = str(o.area).slice(0, 120);
        if (f.required && !district) { fail(f, "Pick a district"); break; }
        if (!district && !area) break;
        answers.push({ id: f.id, label, type: f.type, value: { district, area }, text: [area, district].filter(Boolean).join(", ") }); break;
      }
    }
  }
  return { errors, answers, files };
}

/** The person who answered: a name (a short answer about a name, else the first short answer), phone and email. */
export function contactOf(answers: Answer[]) {
  const shorts = answers.filter((a) => a.type === "short");
  const name = (shorts.find((a) => /name|नाम/i.test(a.label)) ?? shorts[0])?.text.slice(0, 80) || "Form visitor";
  return { name, phone: answers.find((a) => a.type === "phone")?.text ?? null, email: answers.find((a) => a.type === "email")?.text ?? null };
}

/** The answers as one message for the Inbox and the email: "Question: answer" lines. */
export const answersText = (answers: Answer[]) => answers.map((a) => `${a.label}: ${a.text}`).join("\n").slice(0, 4000);

/** Start of the current month in Nepal. */
export const monthStart = () => new Date(`${nepalDay().slice(0, 7)}-01T00:00:00+05:45`);

export async function formLimits(db: Tx, tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true, plan: { select: { price: true, limits: true } } } });
  const free = !t.plan.price || t.status === "trial";
  const lim = (t.plan.limits ?? {}) as Record<string, number | undefined>;
  return { free, forms: lim.forms ?? (free ? 2 : -1), responses: lim.formResponses ?? (free ? 100 : -1) };
}

// ───── Requirement forms: listings that fit ─────
// A simple filter on what the person asked for: rent or buy, the kind of property, the district and the budget.
const CATEGORY_WORDS: [RegExp, string[]][] = [
  [/flat|apartment/i, ["Apartment", "Flat"]], [/house|home|bungalow|villa/i, ["House", "Bungalow", "Villa"]], [/land|plot/i, ["Land"]],
  [/shop|commercial|office/i, ["Shop", "Shop space", "Office space", "Commercial", "Commercial space"]], [/room/i, ["Room"]],
];
export interface Match { id: number; code: string; title: string; price: number | null }

export async function matchListings(db: Tx, tenantId: string, answers: Answer[]): Promise<Match[]> {
  const words = answers.filter((a) => CHOICE.includes(a.type)).flatMap((a) => (Array.isArray(a.value) ? a.value : [a.value])).map(String);
  const rent = words.some((w) => /rent|lease|भाडा/i.test(w));
  const buy = words.some((w) => /buy|invest|purchase|किन/i.test(w));
  const categories = [...new Set(words.flatMap((w) => CATEGORY_WORDS.filter(([re]) => re.test(w)).flatMap(([, c]) => c)))];
  const loc = answers.find((a) => a.type === "location")?.value as { district?: string; area?: string } | undefined;
  const district = loc?.district?.replace(/\s*\(.*\)\s*$/, "").trim();
  const budget = answers.find((a) => a.type === "money" && /budget|max|price|बजेट/i.test(a.label))?.value ?? answers.find((a) => a.type === "money")?.value;
  const where: Prisma.ListingWhereInput = {
    tenantId, status: "published",
    ...(rent !== buy ? { purpose: rent ? ("rent" as const) : ("sale" as const) } : {}),
    ...(categories.length ? { OR: categories.map((c) => ({ category: { equals: c, mode: "insensitive" as const } })) } : {}),
    ...(district ? { district: { equals: district, mode: "insensitive" as const } } : {}),
    ...(typeof budget === "number" && budget > 0 ? { price: { lte: BigInt(budget) } } : {}),
  };
  const rows = await db.listing.findMany({ where, select: { id: true, code: true, title: true, price: true }, orderBy: { publishedAt: "desc" }, take: 5 });
  return rows.map((l) => ({ id: l.id, code: l.code, title: l.title, price: l.price != null ? Number(l.price) : null }));
}
