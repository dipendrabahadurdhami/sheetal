// eSewa, Khalti and Fonepay as integrations: their fields, and a read-only test that proves the saved details work (INTEGRATIONS.md section 13, rows 1-3).
// Where it fits: registry.ts lists them for the platform (Sheetal's own merchant accounts) and for a business (its own, after a document check).
// The checkout and verify functions the billing code uses stay where they are (backend-core/src/lib/payments.ts, unchanged); they read the keys through
// the old settings row, which legacy.ts keeps in step with the connection.
// How it works: each test asks the provider about a payment that does not exist. A proper "not found" answer proves the account and the key; a "not allowed"
// answer means the key is wrong. No test ever starts or moves a payment.
// Rules: hosts are fixed here (test and live apart). eSewa's public test merchant may be used outside production only.

import { createHmac } from "node:crypto";
import { check, safeMessage } from "../fields.js";
import type { IntegrationContext, IntegrationSpec, TestResult } from "../types.js";
import { BaseIntegration, REVIEWED_STEPS, probe } from "./base.js";

const DOCS = [
  { key: "company_registration", label: { en: "Company registration" }, required: true, filledBy: "owner", fileTypes: ["pdf", "jpg", "png"], maxMB: 8 },
  { key: "tax_certificate", label: { en: "Tax registration certificate" }, required: true, filledBy: "owner", fileTypes: ["pdf", "jpg", "png"], maxMB: 8 },
  { key: "bank_proof", label: { en: "Bank account proof (cancelled cheque or bank letter)" }, required: true, filledBy: "owner", fileTypes: ["pdf", "jpg", "png"], maxMB: 8 },
  { key: "merchant_letter", label: { en: "Merchant agreement or merchant id letter from the provider" }, required: true, filledBy: "owner", fileTypes: ["pdf", "jpg", "png"], maxMB: 8 },
] as const;

const common = { group: "payments", scopes: ["platform", "business"], capabilities: ["payments.checkout"], modes: ["test", "live"], documents: DOCS, steps: REVIEWED_STEPS, fallback: "none", built: true } as const;
const SECRET = { key: "secretKey", label: { en: "Secret key" }, required: true, secret: true, maxLength: 300 } as const;

export const ESEWA_HOST = { test: "https://rc.esewa.com.np/api/epay/transaction/status/", live: "https://epay.esewa.com.np/api/epay/transaction/status/" } as const;
export const KHALTI_HOST = { test: "https://dev.khalti.com/api/v2/", live: "https://khalti.com/api/v2/" } as const;
export const FONEPAY_HOST = { test: "https://dev-clientapi.fonepay.com/api/merchantRequest/verificationMerchant", live: "https://clientapi.fonepay.com/api/merchantRequest/verificationMerchant" } as const;
/** eSewa's public test merchant: allowed outside production only. */
export const ESEWA_PUBLIC_TEST_CODE = "EPAYTEST";

export class EsewaIntegration extends BaseIntegration {
  readonly spec: IntegrationSpec = {
    ...common, id: "esewa", name: { en: "eSewa", ne: "इसेवा" }, icon: "wallet", review: { before: "credentials", by: "sheetal" },
    fields: [
      { key: "productCode", label: { en: "Product code (merchant code)" }, required: true, pattern: "[A-Za-z0-9_-]{3,40}", message: "A product code is 3 to 40 letters and digits." },
      SECRET,
    ],
    guide: [
      { title: "Get a merchant account", body: "Ask eSewa for an ePay merchant account for your business. They give you a product code and a secret key.", links: [{ label: "eSewa for merchants", url: "https://merchant.esewa.com.np" }] },
      { title: "Enter the test details first", body: "Save the test product code and secret key, then press Test." },
      { title: "Go live", body: "After a passing test, save the live key and press Go live." },
    ],
  };
  async test(ctx: IntegrationContext): Promise<TestResult> {
    const code = ctx.config.productCode ?? "";
    if (code === ESEWA_PUBLIC_TEST_CODE && (ctx.env === "production" || ctx.mode === "live")) {
      return { ok: false, checks: [check("Product code", false, "EPAYTEST is eSewa's public test merchant. Enter your own product code.")] };
    }
    return probe(async () => {
      const ref = `sheetal-check-${ctx.now.getTime()}`;
      const res = await ctx.fetch(`${ESEWA_HOST[ctx.mode]}?product_code=${encodeURIComponent(code)}&total_amount=1&transaction_uuid=${encodeURIComponent(ref)}`);
      const j = (await res.json().catch(() => null)) as { status?: string; code?: number; error_message?: string } | null;
      // eSewa answers a made-up payment of a real merchant with status NOT_FOUND; an unknown product code gets an error.
      const found = !!j && (j.status === "NOT_FOUND" || j.status === "PENDING" || j.status === "COMPLETE");
      return [
        check("Product code", found, found ? "eSewa knows this product code." : safeMessage(j?.error_message ?? `eSewa answered ${res.status}.`)),
        check("Secret key", ctx.secrets.has("secretKey"), ctx.secrets.has("secretKey") ? "Saved. eSewa checks it on the first payment; a test payment proves it." : "Save the secret key."),
      ];
    });
  }
}

export class KhaltiIntegration extends BaseIntegration {
  readonly spec: IntegrationSpec = {
    ...common, id: "khalti", name: { en: "Khalti", ne: "खल्ती" }, icon: "wallet", review: { before: "credentials", by: "sheetal" },
    fields: [SECRET],
    guide: [
      { title: "Get a merchant account", body: "Create a Khalti merchant account. The secret key is under Keys in the merchant dashboard (test keys on the test dashboard).", links: [{ label: "Khalti merchant dashboard", url: "https://admin.khalti.com" }] },
      { title: "Test, then go live", body: "Save the test key and press Test. After it passes, save the live key and press Go live." },
    ],
  };
  async test(ctx: IntegrationContext): Promise<TestResult> {
    const key = ctx.secrets.get("secretKey");
    if (!key) return { ok: false, checks: [check("Secret key", false, "Save the secret key first.")] };
    return probe(async () => {
      const res = await ctx.fetch(`${KHALTI_HOST[ctx.mode]}epayment/lookup/`, { method: "POST", headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ pidx: "sheetal-check-0000000000" }) });
      const j = (await res.json().catch(() => null)) as { detail?: string; error_key?: string } | null;
      // 401/403 = the key is wrong. Any other answer (a 400 or 404 "not found") means Khalti accepted the key.
      const ok = res.status !== 401 && res.status !== 403;
      return [check("Secret key", ok, ok ? "Khalti accepted the key." : safeMessage(j?.detail ?? "Khalti refused the key.", [key]))];
    });
  }
}

export class FonepayIntegration extends BaseIntegration {
  readonly spec: IntegrationSpec = {
    ...common, id: "fonepay", name: { en: "Fonepay" }, icon: "qr-code", review: { before: "credentials", by: "sheetal" },
    fields: [
      { key: "merchantCode", label: { en: "Merchant code (PID)" }, required: true, pattern: "[A-Za-z0-9_-]{3,40}", message: "A merchant code is 3 to 40 letters and digits." },
      SECRET,
    ],
    guide: [
      { title: "Get a merchant account", body: "Fonepay accounts come through your bank. The bank gives you a merchant code and a secret key." },
      { title: "Test, then go live", body: "Save the test details and press Test. After it passes, save the live key and press Go live." },
    ],
  };
  async test(ctx: IntegrationContext): Promise<TestResult> {
    const key = ctx.secrets.get("secretKey");
    const pid = ctx.config.merchantCode ?? "";
    if (!key || !pid) return { ok: false, checks: [check("Details", false, "Save the merchant code and the secret key first.")] };
    return probe(async () => {
      const q = { PRN: `sheetal-check-${ctx.now.getTime()}`, PID: pid, BID: "", AMT: "1", UID: "0" };
      const DV = createHmac("sha512", key).update([q.PID, q.AMT, q.PRN, q.BID, q.UID].join(",")).digest("hex");
      const res = await ctx.fetch(`${FONEPAY_HOST[ctx.mode]}?${new URLSearchParams({ ...q, DV })}`);
      const text = await res.text().catch(() => "");
      // A signed question about a made-up payment: Fonepay answers with its XML ("success false") when the merchant and signature are accepted.
      const ok = res.ok && /<success>/i.test(text) && !/invalid\s+(merchant|signature|dv)/i.test(text);
      return [check("Merchant code and key", ok, ok ? "Fonepay accepted the merchant code and the signature." : safeMessage(text || `Fonepay answered ${res.status}.`, [key]))];
    });
  }
}
