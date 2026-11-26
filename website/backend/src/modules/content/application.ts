// The job application form's answers: checked here, stored on the application (JobApplication.answers).
// Where it fits: POST /jobs/:slug/apply (routes.ts). The same questions, labels and steps are in shared/src/data/jobForm.js
// for the screens; change both together.
// Rules: required answers depend on the job's form (portfolio and references off, optional or required; two-wheeler and
// on-camera on or off). Unknown fields are ignored, never stored.

import { z } from "zod";
import { badRequest } from "@sheetal/platform/core/errors";

export type JobForm = { portfolio: "off" | "optional" | "required"; references: "off" | "optional" | "required"; vehicle: boolean; camera: boolean };
export const jobFormOf = (f: unknown): JobForm => {
  const o = (f && typeof f === "object" ? f : {}) as Partial<JobForm>;
  const lvl = (v: unknown, d: JobForm["portfolio"]) => (v === "off" || v === "optional" || v === "required" ? v : d);
  return { portfolio: lvl(o.portfolio, "optional"), references: lvl(o.references, "optional"), vehicle: o.vehicle === true, camera: o.camera === true };
};
export const JobFormSchema = z.object({
  portfolio: z.enum(["off", "optional", "required"]).default("optional"), references: z.enum(["off", "optional", "required"]).default("optional"),
  vehicle: z.boolean().default(false), camera: z.boolean().default(false),
});

/** Labels for the email to whoever hires (the screens show the answers themselves). */
export const LABELS: Record<string, string> = {
  city: "Lives in", linkedin: "LinkedIn", current_company: "Current organisation", current_role: "Designation", total_experience: "Total experience (years)",
  relevant_experience: "Relevant experience (years)", employers_5y: "Employers in last 5 years", achievements: "Achievements", results: "Results",
  reason_change: "Why a change", current_salary: "Current fixed salary (NPR)", current_total: "Current total pay (NPR)", expected_salary: "Expected salary (NPR)",
  performance_pay: "Open to performance pay", notice_period: "Notice period", joining_date: "Earliest joining", commitments: "Other commitments",
  vehicle: "Own two-wheeler and licence", camera: "Comfortable on camera", portfolio: "Portfolio", references: "References",
};

const str = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const num = (max: number) => z.union([z.string(), z.number()]).optional().transform((v, ctx) => {
  if (v === undefined || v === "") return undefined;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > max) { ctx.addIssue({ code: "custom", message: "Enter a number." }); return z.NEVER; }
  return Math.round(n * 10) / 10;
});
const url = z.string().trim().max(500).optional().transform((v) => v || undefined).refine((v) => !v || /^https?:\/\/\S+\.\S+/i.test(v), "Enter a full link starting with https://");
const pick = <T extends string>(ids: readonly [T, ...T[]]) => z.enum(ids).optional();

const Answers = z.object({
  city: str(120), linkedin: url, current_company: str(150), current_role: str(150),
  total_experience: num(60), relevant_experience: num(60), employers_5y: num(30),
  achievements: str(4000), results: str(4000), reason_change: str(2000),
  current_salary: num(10_000_000), current_total: num(10_000_000), expected_salary: num(10_000_000),
  performance_pay: pick(["yes", "depends", "no"]), notice_period: pick(["now", "2w", "1m", "2m", "3m"]),
  joining_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.").optional().or(z.literal("").transform(() => undefined)),
  commitments: str(2000), vehicle: pick(["yes", "no"]), camera: pick(["yes", "no"]), portfolio: url, references: str(3000),
  consent: z.union([z.boolean(), z.string()]).optional().transform((v) => v === true || v === "true" || v === "on" || v === "1"),
});

/** Checks the answers for a job's form; throws a 400 naming every missing required answer. */
export function readAnswers(raw: Record<string, unknown>, form: unknown) {
  const f = jobFormOf(form);
  const a = Answers.parse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v != null)));
  const required: [keyof typeof a, string][] = [
    ["city", "Where you live now"], ["total_experience", "Total experience"], ["relevant_experience", "Relevant experience"], ["achievements", "Your achievements"],
    ["expected_salary", "Expected salary"], ["performance_pay", "Performance-linked pay"], ["notice_period", "Notice period"],
    ...(f.vehicle ? [["vehicle", "Two-wheeler and licence"] as [keyof typeof a, string]] : []),
    ...(f.camera ? [["camera", "Company videos"] as [keyof typeof a, string]] : []),
    ...(f.portfolio === "required" ? [["portfolio", "Portfolio link"] as [keyof typeof a, string]] : []),
    ...(f.references === "required" ? [["references", "References"] as [keyof typeof a, string]] : []),
  ];
  const missing = required.filter(([k]) => a[k] === undefined || a[k] === "");
  const fields: Record<string, string[]> = Object.fromEntries(missing.map(([k]) => [k, ["This is required."]]));
  if (!a.consent) fields.consent = ["Please confirm."];
  if (Object.keys(fields).length) throw badRequest(missing.length ? `Please answer: ${missing.map(([, l]) => l).join(", ")}.` : "Please confirm that the information is true.", fields);
  // What isn't asked for this job is never kept.
  const { consent: _c, ...rest } = a;
  if (f.portfolio === "off") delete rest.portfolio;
  if (f.references === "off") delete rest.references;
  if (!f.vehicle) delete rest.vehicle;
  if (!f.camera) delete rest.camera;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Record<string, string | number>;
}

/** The answers as plain lines for the email. */
export const answerLines = (answers: Record<string, unknown>) =>
  Object.entries(answers).map(([k, v]) => `${LABELS[k] ?? k}: ${String(v).replace(/\s+/g, " ").slice(0, 600)}`).join("\n");
