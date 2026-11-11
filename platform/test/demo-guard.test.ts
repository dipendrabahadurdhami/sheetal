// Tests for the fence around a demo business (platform/src/demo/guard.ts). Pure: no database.
import { describe, expect, it } from "vitest";
import { DEMO_EMAIL_DOMAIN, demoRequestAllowed, isDemoEmail } from "../src/demo/guard.js";

const allow = [/^\/v1\/expenses(\/[\w-]+)?$/, /^\/v1\/reviews\/[\w-]+\/reply$/];

describe("demo guard", () => {
  it("knows a demo user by the reserved email domain only", () => {
    expect(isDemoEmail(`owner.abc@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
    expect(isDemoEmail(`OWNER.abc@${DEMO_EMAIL_DOMAIN.toUpperCase()}`)).toBe(true);
    expect(isDemoEmail("someone@gmail.com")).toBe(false);
    expect(isDemoEmail(`x@${DEMO_EMAIL_DOMAIN}.example.com`)).toBe(false);
    expect(isDemoEmail(null)).toBe(false);
  });
  it("lets reads through and only the listed writes", () => {
    expect(demoRequestAllowed("GET", "/v1/team", allow)).toBe(true);
    expect(demoRequestAllowed("POST", "/v1/expenses", allow)).toBe(true);
    expect(demoRequestAllowed("PUT", "/v1/expenses/abc123?x=1", allow)).toBe(true);
    expect(demoRequestAllowed("POST", "/v1/reviews/r1/reply", allow)).toBe(true);
  });
  it("refuses everything that reaches outside: invitations, payments, mail, uploads, listings", () => {
    for (const [m, u] of [["POST", "/v1/team/invites"], ["POST", "/v1/billing/checkout"], ["POST", "/v1/mail/send"], ["POST", "/v1/expenses/abc/receipt"],
      ["POST", "/v1/listings"], ["PUT", "/v1/workspace/branding"], ["DELETE", "/v1/team/members/u1"], ["post", "/v1/workspaces"]] as const) {
      expect(demoRequestAllowed(m, u, allow), `${m} ${u}`).toBe(false);
    }
  });
});
