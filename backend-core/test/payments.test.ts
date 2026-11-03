import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { ESEWA_TEST, esewaCheckout, esewaSign, esewaVerify, fonepayCheckout, fonepaySign, fonepayVerify, khaltiVerify } from "../src/lib/payments.js";

const json = (body: unknown) => (async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })) as typeof fetch;

describe("eSewa", () => {
  it("signs as eSewa describes: HMAC-SHA256 of the signed fields, base64", () => {
    const msg = "total_amount=100,transaction_uuid=11-201-13,product_code=EPAYTEST";
    expect(esewaSign(ESEWA_TEST.secretKey, msg)).toBe(createHmac("sha256", "8gBm/:&EnhH.1/q").update(msg).digest("base64"));
  });

  it("builds a signed form and accepts only a signed, confirmed, matching answer", async () => {
    const c = esewaCheckout({ mode: "test", ...ESEWA_TEST, amount: 1500, ref: "PAY-1", successUrl: "https://s.test/ok", failureUrl: "https://s.test/no" });
    expect(c).toMatchObject({ method: "form", action: expect.stringContaining("rc-epay.esewa.com.np"), fields: { total_amount: "1500", transaction_uuid: "PAY-1" } });
    const answer = (o: Record<string, string>) => {
      const d = { transaction_code: "000AWEO", status: "COMPLETE", total_amount: "1,500.0", transaction_uuid: "PAY-1", product_code: "EPAYTEST", signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names", ...o };
      const signature = esewaSign(ESEWA_TEST.secretKey, d.signed_field_names.split(",").map((n) => `${n}=${(d as Record<string, string>)[n]}`).join(","));
      return Buffer.from(JSON.stringify({ ...d, signature: o.signature ?? signature })).toString("base64");
    };
    const base = { mode: "test" as const, ...ESEWA_TEST, ref: "PAY-1", amount: 1500 };
    expect(await esewaVerify({ ...base, data: answer({}), fetch: json({ status: "COMPLETE", ref_id: "R1" }) })).toMatchObject({ ok: true, providerRef: "R1" });
    expect(await esewaVerify({ ...base, data: answer({ signature: "forged" }), fetch: json({ status: "COMPLETE" }) })).toMatchObject({ ok: false, reason: expect.stringContaining("signature") });
    expect(await esewaVerify({ ...base, data: answer({ total_amount: "15.0" }), fetch: json({ status: "COMPLETE" }) })).toMatchObject({ ok: false, reason: expect.stringContaining("amount") });
    expect(await esewaVerify({ ...base, data: answer({}), fetch: json({ status: "PENDING" }) })).toMatchObject({ ok: false, reason: expect.stringContaining("confirmed") });
    expect(await esewaVerify({ ...base, ref: "PAY-2", data: answer({}), fetch: json({ status: "COMPLETE" }) })).toMatchObject({ ok: false });
  });
});

describe("Khalti", () => {
  it("accepts only a completed payment of the right amount (in paisa)", async () => {
    expect(await khaltiVerify({ mode: "test", secretKey: "k", pidx: "P1", amount: 1500, fetch: json({ status: "Completed", total_amount: 150000, transaction_id: "T1" }) })).toMatchObject({ ok: true, providerRef: "T1" });
    expect(await khaltiVerify({ mode: "test", secretKey: "k", pidx: "P1", amount: 1500, fetch: json({ status: "Completed", total_amount: 1500 }) })).toMatchObject({ ok: false });
    expect(await khaltiVerify({ mode: "test", secretKey: "k", pidx: "P1", amount: 1500, fetch: json({ status: "User canceled" }) })).toMatchObject({ ok: false });
  });
});

describe("Fonepay", () => {
  it("signs the request and checks the signed answer and the verification call", async () => {
    const c = fonepayCheckout({ mode: "test", merchantCode: "M1", secretKey: "s", amount: 3000, ref: "PAY-9", returnUrl: "https://s.test/r", remarks: "Pro plan", now: new Date(2026, 10, 3) });
    expect(c.method).toBe("redirect");
    const url = new URL((c as { url: string }).url);
    expect(url.searchParams.get("DT")).toBe("11/03/2026");
    expect(url.searchParams.get("DV")).toBe(fonepaySign("s", ["M1", "P", "PAY-9", "3000", "NPR", "11/03/2026", "Pro plan", "N/A", "https://s.test/r"]));
    const q = { PRN: "PAY-9", PID: "M1", PS: "true", RC: "successful", UID: "U1", BC: "B1", INI: "I", P_AMT: "3000.0", R_AMT: "3000.0" };
    const signed = { ...q, DV: fonepaySign("s", [q.PRN, q.PID, q.PS, q.RC, q.UID, q.BC, q.INI, q.P_AMT, q.R_AMT]) };
    const ok = (async () => new Response("<response><success>true</success></response>")) as typeof fetch;
    expect(await fonepayVerify({ mode: "test", merchantCode: "M1", secretKey: "s", q: signed, ref: "PAY-9", amount: 3000, fetch: ok })).toMatchObject({ ok: true, providerRef: "U1" });
    expect(await fonepayVerify({ mode: "test", merchantCode: "M1", secretKey: "s", q: { ...signed, P_AMT: "30.0" }, ref: "PAY-9", amount: 3000, fetch: ok })).toMatchObject({ ok: false });
  });
});
