import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { buildIcal, parseIcal } from "../src/lib/ical.js";
import { metaSignatureOk, readMetaWebhook } from "../src/lib/meta.js";

describe("iCal", () => {
  it("reads folded lines and all-day stays, and writes our busy dates", () => {
    const feed = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:abc123@airbnb.com\r\nDTSTART;VALUE=DATE:20261210\r\nDTEND;VALUE=DATE:20261213\r\nSUMMARY:Reserved\r\n  by guest\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART:20261220T140000Z\r\nDTEND:20261220T140000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
    expect(parseIcal(feed)).toEqual([{ uid: "abc123@airbnb.com", start: "2026-12-10", end: "2026-12-13", summary: "Reserved by guest" }]);
    const out = buildIcal({ name: "Deluxe", events: [{ uid: "x", start: "2026-12-10", end: "2026-12-12" }], now: new Date("2026-11-03T00:00:00Z") });
    expect(out).toContain("DTSTART;VALUE=DATE:20261210\r\nDTEND;VALUE=DATE:20261212");
    expect(out).toContain("SUMMARY:Not available");
    expect(parseIcal(out)).toHaveLength(1);
  });
});

describe("Meta", () => {
  it("checks the webhook signature and reads WhatsApp and Messenger messages", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "111" }, contacts: [{ wa_id: "9779800000001", profile: { name: "Sita" } }], messages: [{ from: "9779800000001", id: "m1", timestamp: "1793680000", type: "text", text: { body: "Is the flat free?" } }] } }] }] });
    const sig = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(metaSignatureOk("app-secret", body, sig)).toBe(true);
    expect(metaSignatureOk("app-secret", `${body} `, sig)).toBe(false);
    expect(metaSignatureOk("app-secret", body, undefined)).toBe(false);
    expect(readMetaWebhook(JSON.parse(body))).toEqual([expect.objectContaining({ channel: "whatsapp", accountId: "111", from: "9779800000001", name: "Sita", text: "Is the flat free?" })]);
    const page = { object: "page", entry: [{ id: "222", messaging: [{ sender: { id: "u1" }, recipient: { id: "222" }, timestamp: 1, message: { mid: "x", text: "Hello" } }, { sender: { id: "222" }, recipient: { id: "u1" }, message: { mid: "y", text: "echo", is_echo: true } }] }] };
    expect(readMetaWebhook(page)).toEqual([expect.objectContaining({ channel: "messenger", accountId: "222", from: "u1", text: "Hello" })]);
  });
});
