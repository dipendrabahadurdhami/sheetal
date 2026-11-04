// One error format for every API: { message, code, errors?, requestId }.
// Where it fits: routes throw badRequest, forbidden, notFound, conflict or AppError; the base app turns them into replies.
// How it works: expected problems keep their status and message; invalid input (zod) becomes 422 with field errors;
// anything else becomes a 500 with a safe message and is logged in full with its request id.

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly errors?: Record<string, string[]>,
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
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({ message: error.message, code: error.code, errors: error.errors, requestId });
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
