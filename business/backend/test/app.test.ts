import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "@sheetal/backend-core/config";
import { buildApp } from "../src/app.js";

const app = await buildApp(loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }, "business"));
afterAll(async () => { await app.close(); });

describe("business API", () => {
  it("runs on its own port and says which API it is", async () => {
    expect(app.config.PORT).toBe(4001);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok", service: "business" });
  });
});
