import { createHmac, timingSafeEqual } from "node:crypto";

// Nepal payment gateways. Each one sends the payer to the gateway's own page (we never see card, wallet or bank
// details), then the gateway sends them back with a result that is checked here: its signature, and again with the
// gateway's own status API, before anything is marked paid.
//
//   eSewa ePay v2     https://developer.esewa.com.np  (test merchant EPAYTEST works without an account)
//   Khalti KPG-2      https://docs.khalti.com          (test keys from a Khalti merchant account)
//   Fonepay web pay   merchant integration guide from Fonepay (merchant code and secret from them)

export type Fetch = typeof fetch;
export type Mode = "test" | "live";
export type Provider = "esewa" | "khalti" | "fonepay";

/** What the browser does next: post a form (eSewa), or go to a URL (Khalti, Fonepay). */
export type Checkout = { method: "form"; action: string; fields: Record<string, string> } | { method: "redirect"; url: string; providerRef?: string };
export type Verified = { ok: true; providerRef: string; raw: unknown } | { ok: false; reason: string; raw?: unknown };

const hmac = (algo: "sha256" | "sha512", secret: string, msg: string, enc: "base64" | "hex") => createHmac(algo, secret).update(msg).digest(enc);
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const rupees = (v: unknown) => Number(String(v ?? "").replace(/,/g, ""));

// ───── eSewa ─────
export const ESEWA_TEST = { productCode: "EPAYTEST", secretKey: "8gBm/:&EnhH.1/q" };
const ESEWA = {
  test: { form: "https://rc-epay.esewa.com.np/api/epay/main/v2/form", status: "https://rc.esewa.com.np/api/epay/transaction/status/" },
  live: { form: "https://epay.esewa.com.np/api/epay/main/v2/form", status: "https://epay.esewa.com.np/api/epay/transaction/status/" },
};
export const esewaSign = (secret: string, message: string) => hmac("sha256", secret, message, "base64");

export function esewaCheckout(o: { mode: Mode; productCode: string; secretKey: string; amount: number; ref: string; successUrl: string; failureUrl: string }): Checkout {
  const total = String(o.amount);
  return {
    method: "form", action: ESEWA[o.mode].form,
    fields: {
      amount: total, tax_amount: "0", total_amount: total, transaction_uuid: o.ref, product_code: o.productCode,
      product_service_charge: "0", product_delivery_charge: "0", success_url: o.successUrl, failure_url: o.failureUrl,
      signed_field_names: "total_amount,transaction_uuid,product_code",
      signature: esewaSign(o.secretKey, `total_amount=${total},transaction_uuid=${o.ref},product_code=${o.productCode}`),
    },
  };
}

/** `data` is the base64 JSON eSewa adds to the success URL. */
export async function esewaVerify(o: { mode: Mode; productCode: string; secretKey: string; data: string; ref: string; amount: number; fetch?: Fetch }): Promise<Verified> {
  let d: Record<string, string>;
  try { d = JSON.parse(Buffer.from(o.data, "base64").toString("utf8")); } catch { return { ok: false, reason: "The answer from eSewa couldn't be read." }; }
  const names = String(d.signed_field_names ?? "").split(",").filter(Boolean);
  if (!names.length || !d.signature) return { ok: false, reason: "The answer from eSewa isn't signed.", raw: d };
  const expected = esewaSign(o.secretKey, names.map((n) => `${n}=${d[n] ?? ""}`).join(","));
  if (!same(expected, String(d.signature))) return { ok: false, reason: "The eSewa signature doesn't match.", raw: d };
  if (d.transaction_uuid !== o.ref || d.product_code !== o.productCode) return { ok: false, reason: "This eSewa answer is for another payment.", raw: d };
  if (d.status !== "COMPLETE") return { ok: false, reason: `eSewa says the payment is ${String(d.status).toLowerCase()}.`, raw: d };
  if (rupees(d.total_amount) !== o.amount) return { ok: false, reason: "The amount paid doesn't match the invoice.", raw: d };
  // Ask eSewa directly as well; the redirect alone could be replayed.
  const url = `${ESEWA[o.mode].status}?product_code=${encodeURIComponent(o.productCode)}&total_amount=${o.amount}&transaction_uuid=${encodeURIComponent(o.ref)}`;
  const s = (await (o.fetch ?? fetch)(url).then((r) => r.json()).catch(() => null)) as { status?: string; ref_id?: string } | null;
  if (s?.status !== "COMPLETE") return { ok: false, reason: "eSewa hasn't confirmed this payment.", raw: { redirect: d, status: s } };
  return { ok: true, providerRef: s.ref_id ?? d.transaction_code ?? o.ref, raw: { redirect: d, status: s } };
}

// ───── Khalti ─────
const KHALTI = { test: "https://dev.khalti.com/api/v2/", live: "https://khalti.com/api/v2/" };

export async function khaltiCheckout(o: { mode: Mode; secretKey: string; amount: number; ref: string; name: string; returnUrl: string; websiteUrl: string; customer?: { name?: string; email?: string; phone?: string }; fetch?: Fetch }): Promise<Checkout> {
  const res = await (o.fetch ?? fetch)(`${KHALTI[o.mode]}epayment/initiate/`, {
    method: "POST", headers: { Authorization: `Key ${o.secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ return_url: o.returnUrl, website_url: o.websiteUrl, amount: o.amount * 100, purchase_order_id: o.ref, purchase_order_name: o.name, customer_info: o.customer }),
  });
  const d = (await res.json().catch(() => null)) as { pidx?: string; payment_url?: string; detail?: string } | null;
  if (!res.ok || !d?.pidx || !d.payment_url) throw new Error(d?.detail ?? "Khalti couldn't start the payment.");
  return { method: "redirect", url: d.payment_url, providerRef: d.pidx };
}

export async function khaltiVerify(o: { mode: Mode; secretKey: string; pidx: string; amount: number; fetch?: Fetch }): Promise<Verified> {
  const res = await (o.fetch ?? fetch)(`${KHALTI[o.mode]}epayment/lookup/`, {
    method: "POST", headers: { Authorization: `Key ${o.secretKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ pidx: o.pidx }),
  });
  const d = (await res.json().catch(() => null)) as { status?: string; total_amount?: number; transaction_id?: string } | null;
  if (!d) return { ok: false, reason: "Khalti didn't answer." };
  if (d.status !== "Completed") return { ok: false, reason: `Khalti says the payment is ${String(d.status ?? "unknown").toLowerCase()}.`, raw: d };
  if (Number(d.total_amount) !== o.amount * 100) return { ok: false, reason: "The amount paid doesn't match the invoice.", raw: d };
  return { ok: true, providerRef: d.transaction_id ?? o.pidx, raw: d };
}

// ───── Fonepay ─────
const FONEPAY = {
  test: { pay: "https://dev-clientapi.fonepay.com/api/merchantRequest", verify: "https://dev-clientapi.fonepay.com/api/merchantRequest/verificationMerchant" },
  live: { pay: "https://clientapi.fonepay.com/api/merchantRequest", verify: "https://clientapi.fonepay.com/api/merchantRequest/verificationMerchant" },
};
export const fonepaySign = (secret: string, values: (string | number)[]) => hmac("sha512", secret, values.join(","), "hex");

export function fonepayCheckout(o: { mode: Mode; merchantCode: string; secretKey: string; amount: number; ref: string; returnUrl: string; remarks: string; now?: Date }): Checkout {
  const d = o.now ?? new Date();
  const DT = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const R1 = o.remarks.replace(/[^\w .-]/g, "").slice(0, 50) || "Sheetal Property";
  const q = { PID: o.merchantCode, MD: "P", PRN: o.ref, AMT: String(o.amount), CRN: "NPR", DT, R1, R2: "N/A", RU: o.returnUrl };
  const DV = fonepaySign(o.secretKey, [q.PID, q.MD, q.PRN, q.AMT, q.CRN, q.DT, q.R1, q.R2, q.RU]);
  return { method: "redirect", url: `${FONEPAY[o.mode].pay}?${new URLSearchParams({ ...q, DV })}` };
}

/** `q` is the query Fonepay adds to the return URL. */
export async function fonepayVerify(o: { mode: Mode; merchantCode: string; secretKey: string; q: Record<string, string>; ref: string; amount: number; fetch?: Fetch }): Promise<Verified> {
  const q = o.q;
  const expected = fonepaySign(o.secretKey, [q.PRN, q.PID, q.PS, q.RC, q.UID, q.BC, q.INI, q.P_AMT, q.R_AMT].map((v) => v ?? ""));
  if (!q.DV || !same(expected.toLowerCase(), String(q.DV).toLowerCase())) return { ok: false, reason: "The Fonepay signature doesn't match.", raw: q };
  if (q.PRN !== o.ref || q.PID !== o.merchantCode) return { ok: false, reason: "This Fonepay answer is for another payment.", raw: q };
  if (q.PS !== "true") return { ok: false, reason: "Fonepay says the payment didn't go through.", raw: q };
  if (rupees(q.P_AMT) !== o.amount) return { ok: false, reason: "The amount paid doesn't match the invoice.", raw: q };
  const vq = { PRN: o.ref, PID: o.merchantCode, BID: q.BC ?? "", AMT: String(o.amount), UID: q.UID ?? "" };
  const DV = fonepaySign(o.secretKey, [vq.PID, vq.AMT, vq.PRN, vq.BID, vq.UID]);
  const text = await (o.fetch ?? fetch)(`${FONEPAY[o.mode].verify}?${new URLSearchParams({ ...vq, DV })}`).then((r) => r.text()).catch(() => "");
  if (!/<success>\s*true\s*<\/success>/i.test(text)) return { ok: false, reason: "Fonepay hasn't confirmed this payment.", raw: { redirect: q, verify: text.slice(0, 500) } };
  return { ok: true, providerRef: q.UID ?? o.ref, raw: { redirect: q } };
}
