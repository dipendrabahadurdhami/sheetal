// One error format for every API: { message, code, errors?, details?, requestId }.
// Where it fits: routes throw badRequest, forbidden, notFound, conflict or AppError; the base app turns them into replies.
// (Moved here from backend-core/src/lib/errors.ts in P1-BE-1; that file now only re-exports this one, so there is one AppError class.)
// How it works: expected problems keep their status and message; invalid input (zod) becomes 422 with field errors;
// anything else becomes a 500 with a safe message and is logged in full with its request id.
// Rules: `details` is sent to the browser, so it holds only safe facts (a limit, a count), never secrets or other people's data.

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly errors?: Record<string, string[]>,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (message: string, errors?: Record<string, string[]>) => new AppError(400, "bad_request", message, errors);
export const unauthorized = (message = "Please log in first.") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You don't have access to this.") => new AppError(403, "forbidden", message);
export const notFound = (message = "Not found.") => new AppError(404, "not_found", message);
export const conflict = (message: string) => new AppError(409, "conflict", message);

/** Someone else saved the row first. The screen shows "Reload" instead of a red error, so it has its own code. */
export const versionConflict = (what: string) => new AppError(409, "version_conflict", `${what} was changed by someone else. Reload and try again.`);
/** The business hit a plan limit or needs another plan: 402, the same codes the team and branding routes use today. */
export const planLimit = (code: "plan_feature" | "seat_limit" | "upgrade_needed" | "app_limit", message: string, details?: Record<string, unknown>) =>
  new AppError(402, code, message, undefined, details);

// Zod issues → { field: [messages] }, the shape forms show next to each field.
export function fieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  const requestId = request.id;
  if (error instanceof AppError && error.statusCode < 300) {
    // A "success that is not done yet" (202 Sent for approval): answered as { message, code, data, requestId }, the shape a success has.
    return reply.status(error.statusCode).send({ message: error.message, code: error.code, data: error.details, requestId });
  }
  if (error instanceof AppError) {
    // undefined fields (no errors, no details) are left out of the JSON, so the wire format of old errors is unchanged.
    return reply.status(error.statusCode).send({ message: error.message, code: error.code, errors: error.errors, details: error.details, requestId });
  }
  if (error instanceof ZodError) {
    return reply.status(422).send({ message: "Please check the highlighted fields.", code: "validation", errors: fieldErrors(error), requestId });
  }
  const fe = error as FastifyError;
  if (fe.validation) {
    return reply.status(422).send({ message: "Please check the highlighted fields.", code: "validation", errors: { _: [fe.message] }, requestId });
  }
  if (fe.statusCode === 429) {
    return reply.status(429).send({ message: "Too many requests. Please wait a moment and try again.", code: "rate_limited", requestId });
  }
  if (fe.statusCode && fe.statusCode >= 400 && fe.statusCode < 500) {
    return reply.status(fe.statusCode).send({ message: fe.message, code: fe.code || "bad_request", requestId });
  }
  request.log.error({ err: error }, "unhandled error");
  return reply.status(500).send({ message: "Something went wrong. Please try again.", code: "server_error", requestId });
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(404).send({ message: "Not found.", code: "not_found", requestId: request.id });
}
