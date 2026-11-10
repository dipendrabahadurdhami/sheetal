// Tests for the error helpers moved to platform/src/core/errors.ts, and for the shim at backend-core/src/lib/errors.ts.
// Run with: npm run test -w @sheetal/platform
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { AppError, badRequest, errorHandler, notFound, planLimit, versionConflict } from "../src/core/errors.js";

async function answer(thrown: unknown) {
  const app = Fastify();
  app.setErrorHandler(errorHandler);
  app.get("/x", async () => { throw thrown; });
  const res = await app.inject({ method: "GET", url: "/x" });
  await app.close();
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

describe("errors", () => {
  it("versionConflict is 409 version_conflict with a plain message", () => {
    const e = versionConflict("This expense");
    expect(e).toBeInstanceOf(AppError);
    expect(e.statusCode).toBe(409);
    expect(e.code).toBe("version_conflict");
    expect(e.message).toBe("This expense was changed by someone else. Reload and try again.");
  });
  it("planLimit is 402 and carries details", () => {
    const e = planLimit("app_limit", "Upgrade to add more.", { limit: 3 });
    expect(e.statusCode).toBe(402);
    expect(e.code).toBe("app_limit");
    expect(e.details).toEqual({ limit: 3 });
  });
  it("the handler sends details only when there are some (old responses keep their shape)", async () => {
    const plain = await answer(notFound("Nope."));
    expect(plain.status).toBe(404);
    expect("details" in plain.body).toBe(false);
    const limited = await answer(planLimit("seat_limit", "Full.", { limit: 5 }));
    expect(limited.status).toBe(402);
    expect(limited.body.details).toEqual({ limit: 5 });
    expect(limited.body.code).toBe("seat_limit");
  });
  it("badRequest still carries field errors", async () => {
    const r = await answer(badRequest("Bad.", { name: ["Required"] }));
    expect(r.status).toBe(400);
    expect(r.body.errors).toEqual({ name: ["Required"] });
  });
});
