// The input shapes of People, with the same messages the page shows today.
// Where it fits: PeopleService parses every body and query with these (a ZodError becomes 422 in the error handler).
// How it works: moved unchanged from business/backend/src/modules/people/routes.ts (P2-W1 stage 2); `version` is optional everywhere (a stale one answers 409).
// Rules: no defaults that change an answer; strings are trimmed.

import { z } from "zod";
import { today } from "./time.js";

export const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-07.");
export const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:30.");
const Lat = z.number().min(-90).max(90).optional();
const Lng = z.number().min(-180).max(180).optional();
const Version = z.number().int().min(1).optional();

export const CheckIn = z.object({ branchId: z.string().optional(), lat: Lat, lng: Lng, note: z.string().trim().max(200).optional() });
export const CheckOut = z.object({ lat: Lat, lng: Lng });
export const BoardQuery = z.object({ day: Day.optional() });
export const AddRecord = z.object({ userId: z.string(), day: Day, inTime: Time, outTime: Time.optional(), branchId: z.string().optional(), reason: z.string().trim().min(3, "Say why.").max(300) });
export const FixRecord = z.object({ inTime: Time.optional(), outTime: Time.nullable().optional(), reason: z.string().trim().min(3, "Say why.").max(300), version: Version });
export const TypeBody = z.object({ name: z.string().trim().min(2, "Give it a name.").max(40), daysPerYear: z.number().int().min(0).max(366), paid: z.boolean() });
export const TypeEdit = TypeBody.partial().extend({ active: z.boolean().optional(), version: Version });
export const LeaveQuery = z.object({ status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional() });
export const LeaveAsk = z.object({ typeId: z.string(), from: Day, to: Day, halfDay: z.boolean().default(false), reason: z.string().trim().max(300).optional(), branchId: z.string().optional() });
export const Decide = z.object({ status: z.enum(["approved", "rejected"]), note: z.string().trim().max(300).optional(), version: Version });
export const SummaryQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).transform((q) => ({ month: q.month ?? today().slice(0, 7) }));
export const SettingsBody = z.object({ workStart: Time });
export const IdParam = z.object({ id: z.string() });
