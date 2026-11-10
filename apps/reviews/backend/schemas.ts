// What the Reviews screen sends.
// Where it fits: parsed by ReviewService (the one place input is checked). Same rules and messages as the old route file.
// How it works: the list takes ?show=all|unanswered|low; a reply takes { text } (empty text = take the reply down) and may carry `version`.
// Rules: not .strict() (as before). `version` is optional while the page does not send it (P1-FE-3 turns it on): a stale one answers 409.

import { z } from "zod";
import { badRequest } from "@sheetal/platform/core/errors";

export const ListQuery = z.object({ show: z.enum(["all", "unanswered", "low"]).default("all") });
export const ReplyBody = z.object({ text: z.string().trim().max(1500) });

/** The `version` a screen says it loaded: absent is fine, a bad one is refused. */
export function versionIn(raw: unknown): number | undefined {
  const v = raw && typeof raw === "object" ? (raw as { version?: unknown }).version : undefined;
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw badRequest("This page is out of date. Reload and try again.");
  return n;
}
