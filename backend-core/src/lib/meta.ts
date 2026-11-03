import { createHmac, timingSafeEqual } from "node:crypto";
import type { Fetch } from "./payments.js";

// Meta (WhatsApp Cloud API, Messenger, Instagram): checking that a webhook really comes from Meta, reading the
// messages in it, and sending a reply. One Meta app (Sheetal's) serves every business; each business connects
// its own WhatsApp number or page, whose token is stored encrypted.

const GRAPH = "https://graph.facebook.com/v21.0";

/** Meta signs each webhook body with the app secret (header X-Hub-Signature-256: sha256=<hex>). */
export function metaSignatureOk(appSecret: string, rawBody: Buffer | string, header: string | undefined) {
  if (!header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface InboundMessage { channel: "whatsapp" | "messenger" | "instagram"; accountId: string; from: string; name: string; text: string; at: Date; messageId: string }

/** Text messages from a webhook payload (WhatsApp, Messenger or Instagram). Other events (read receipts…) are skipped. */
export function readMetaWebhook(body: unknown): InboundMessage[] {
  const b = body as { object?: string; entry?: unknown[] };
  const out: InboundMessage[] = [];
  for (const entry of (b.entry ?? []) as Record<string, unknown>[]) {
    if (b.object === "whatsapp_business_account") {
      for (const ch of (entry.changes ?? []) as { value?: Record<string, unknown> }[]) {
        const v = ch.value ?? {};
        const accountId = String((v.metadata as { phone_number_id?: string } | undefined)?.phone_number_id ?? "");
        const names = new Map(((v.contacts ?? []) as { wa_id: string; profile?: { name?: string } }[]).map((c) => [c.wa_id, c.profile?.name ?? ""]));
        for (const m of (v.messages ?? []) as { from: string; id: string; timestamp: string; type: string; text?: { body?: string } }[]) {
          const text = m.type === "text" ? m.text?.body ?? "" : `(${m.type} message)`;
          out.push({ channel: "whatsapp", accountId, from: m.from, name: names.get(m.from) || `+${m.from}`, text, at: new Date(Number(m.timestamp) * 1000), messageId: m.id });
        }
      }
    } else if (b.object === "page" || b.object === "instagram") {
      for (const ev of (entry.messaging ?? []) as { sender?: { id: string }; recipient?: { id: string }; timestamp?: number; message?: { mid: string; text?: string; is_echo?: boolean } }[]) {
        if (!ev.message || ev.message.is_echo || !ev.sender) continue;
        out.push({ channel: b.object === "page" ? "messenger" : "instagram", accountId: String(ev.recipient?.id ?? entry.id ?? ""), from: ev.sender.id, name: "", text: ev.message.text ?? "(attachment)", at: new Date(ev.timestamp ?? Date.now()), messageId: ev.message.mid });
      }
    }
  }
  return out;
}

/** Sends a text reply on the channel the person wrote from. */
export async function sendMetaText(o: { channel: string; accountId: string; token: string; to: string; text: string; fetch?: Fetch }) {
  const url = o.channel === "whatsapp" ? `${GRAPH}/${o.accountId}/messages` : `${GRAPH}/me/messages`;
  const body = o.channel === "whatsapp"
    ? { messaging_product: "whatsapp", to: o.to, type: "text", text: { body: o.text.slice(0, 4096) } }
    : { recipient: { id: o.to }, messaging_type: "RESPONSE", message: { text: o.text.slice(0, 2000) } };
  const res = await (o.fetch ?? fetch)(url, { method: "POST", headers: { Authorization: `Bearer ${o.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(e?.error?.message ?? `Meta answered ${res.status}`);
  }
}
