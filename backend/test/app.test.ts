import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { AppError } from "../src/lib/errors.js";

const config = (extra: Record<string, string> = {}) => loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", ...extra });
let app: FastifyInstance;
afterEach(async () => { await app?.close(); });

describe("health", () => {
  it("answers /health with a request id and security headers", async () => {
    app = await buildApp(config());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("keeps the caller's request id", async () => {
    app = await buildApp(config());
    const res = await app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "abc-123" } });
    expect(res.headers["x-request-id"]).toBe("abc-123");
  });

  it("is not ready without a database, and says why", async () => {
    app = await buildApp(config());
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(503);
    const services = res.json().services;
    expect(services.find((s: { id: string }) => s.id === "db").state).toBe("off");
    expect(services.find((s: { id: string }) => s.id === "cache").state).toBe("up");
  });
});

describe("errors", () => {
  const withRoutes = async () => {
    app = await buildApp(config());
    app.get("/t/app-error", async () => { throw new AppError(409, "conflict", "This email is already registered."); });
    app.get("/t/zod", async () => z.object({ email: z.email() }).parse({ email: "nope" }));
    app.get("/t/crash", async () => { throw new Error("database password is hunter2"); });
    return app;
  };

  it("unknown routes return the standard 404 shape", async () => {
    app = await buildApp(config());
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found", message: "Not found." });
    expect(res.json().requestId).toBeTruthy();
  });

  it("expected errors keep their status and message", async () => {
    await withRoutes();
    const res = await app.inject({ method: "GET", url: "/t/app-error" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "conflict", message: "This email is already registered." });
  });

  it("validation errors list problems per field", async () => {
    await withRoutes();
    const res = await app.inject({ method: "GET", url: "/t/zod" });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors.email).toBeTruthy();
  });

  it("unexpected errors never leak details", async () => {
    await withRoutes();
    const res = await app.inject({ method: "GET", url: "/t/crash" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("hunter2");
    expect(res.json().code).toBe("server_error");
  });
});

describe("protection", () => {
  it("rate limits with a friendly message", async () => {
    app = await buildApp(config({ RATE_LIMIT_PER_MINUTE: "3" }));
    app.get("/t/ping", async () => ({ ok: true }));
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await app.inject({ method: "GET", url: "/t/ping" })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
    const res = await app.inject({ method: "GET", url: "/t/ping" });
    expect(res.json().code).toBe("rate_limited");
  });

  it("allows only the configured browser origins", async () => {
    app = await buildApp(config({ CORS_ORIGINS: "https://sheetalproperty.com" }));
    const ok = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://sheetalproperty.com" } });
    const bad = await app.inject({ method: "GET", url: "/health", headers: { origin: "https://evil.example" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("https://sheetalproperty.com");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("config", () => {
  it("rejects bad values with a clear message", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
  });
  it("requires a database in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/DATABASE_URL/);
  });
});
