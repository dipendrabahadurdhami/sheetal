import { describe, expect, it } from "vitest";
import { buildBaseApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

describe("CORS", () => {
  it("lets the panels edit and delete from the browser", async () => {
    const app = await buildBaseApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", CORS_ORIGINS: "http://localhost:5173" }, "business"));
    const r = await app.inject({ method: "OPTIONS", url: "/health", headers: { origin: "http://localhost:5173", "access-control-request-method": "PATCH" } });
    expect(r.headers["access-control-allow-methods"]).toBe("GET, HEAD, POST, PUT, PATCH, DELETE");
    await app.close();
  });
});
