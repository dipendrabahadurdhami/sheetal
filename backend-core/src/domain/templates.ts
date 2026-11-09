// The messages the system sends (emails today; text and WhatsApp wording can be stored too) and their wording.
// Where it fits: Mailer.send() looks up a template when an email names one (lib/mailer.ts); Admin → Messages edits them.
// How it works: TEMPLATE_DEFS is the built-in wording, exactly what the senders used before. A saved MessageTemplate row
// (key + channel + language, active) replaces it; no row, or switched off, means the built-in text is sent. {{placeholders}}
// are filled from the values the sender gives; a template may only use the placeholders listed for its key.
// Rules: keep the placeholders; never put a password in a message; "reset to default" deletes the row.

import type { Db } from "../lib/db.js";

export type TplChannel = "email" | "sms" | "whatsapp";
export const TPL_CHANNELS: TplChannel[] = ["email", "sms", "whatsapp"];
export const TPL_LANGS = ["en", "ne"] as const;

export interface TemplateDef { key: string; name: string; when: string; subject: string; body: string; vars: Record<string, string> }
const sign = "\n\nSheetal Property";
const V = {
  name: "Person's name", business: "Business name", link: "Link", amount: "Amount in rupees", number: "Invoice number", until: "Paid-until date",
  plan: "Plan name", days: "Days", in: "Days left, e.g. 3 days", what: "What was paid for", channel: "Site name", status: "Status", message: "The update",
  inviter: "Who added them", role: "Role", count: "How many", list: "List of titles", date: "Date",
};
const pick = (...k: (keyof typeof V)[]) => Object.fromEntries(k.map((x) => [x, V[x]]));

export const TEMPLATE_DEFS: TemplateDef[] = [
  { key: "verify_email", name: "Confirm your email", when: "After sign-up", subject: "Confirm your email", vars: pick("name", "link"),
    body: `Namaste {{name}},\n\nPlease confirm your email address by opening this link:\n{{link}}\n\nThe link works for 48 hours. If you didn't create an account, ignore this email.\n\nSheetal Property\nhttps://sheetalproperty.com` },
  { key: "reset_password", name: "Set a new password", when: "Forgot password", subject: "Set a new password", vars: pick("name", "link"),
    body: `Namaste {{name}},\n\nOpen this link to set a new password:\n{{link}}\n\nThe link works for 1 hour. If you didn't ask for this, you can ignore this email; your password stays the same.\n\nSheetal Property\nhttps://sheetalproperty.com` },
  { key: "welcome_back", name: "Welcome to the new site", when: "People moved from the old site", subject: "Welcome to the new Sheetal Property", vars: pick("name", "link"),
    body: `Namaste {{name}},\n\nSheetal Property has a new website. Your account and saved listings moved with you; please set a new password to log in:\n{{link}}\n\nThe link works for 1 hour.\n\nSheetal Property\nhttps://sheetalproperty.com` },
  { key: "tenant_ready_new", name: "Business set up (new owner)", when: "Staff create a business for a new person", subject: "{{business}} is ready on Sheetal Property", vars: pick("name", "business", "link"),
    body: `Namaste {{name}},\n\nSheetal Property has set up {{business}} for you on the free Starter plan.\n\nSet your password within 48 hours:\n{{link}}\n\nThen open your business panel at {{panel}}${sign}`.replace("{{panel}}", "{{site}}/business") },
  { key: "tenant_ready_existing", name: "Business set up (existing person)", when: "Staff create a business for someone who has an account", subject: "{{business}} is ready on Sheetal Property", vars: pick("name", "business", "link"),
    body: `Namaste {{name}},\n\nSheetal Property has set up {{business}} for you on the free Starter plan. Sign in as usual and pick it in your business panel:\n{{link}}${sign}` },
  { key: "staff_added", name: "Added to the staff", when: "Staff add a team member", subject: "You've been added to the Sheetal Property team", vars: pick("inviter", "role", "link"),
    body: `{{inviter}} added you to Sheetal Property's staff as {{role}}.\n\nSet your password within 48 hours:\n{{link}}\n\nThen sign in at {{site}}/admin` },
  { key: "payment_plan", name: "Payment received (plan)", when: "A plan or add-on invoice is paid", subject: "Payment received: {{number}}", vars: pick("name", "amount", "what", "business", "until", "number", "link"),
    body: `Namaste {{name}},\n\nWe received Rs. {{amount}} for {{what}}. {{business}} is paid until {{until}}.\n\nInvoice {{number}}: {{link}}${sign}` },
  { key: "payment_banner", name: "Payment received (banner)", when: "A home page banner is paid", subject: "Payment received: {{number}}", vars: pick("name", "amount", "number", "link"),
    body: `Namaste {{name}},\n\nWe received Rs. {{amount}} for your home page banner. Sheetal checks the picture (usually within a working day); it then shows on its dates by itself.\n\n{{link}}${sign}` },
  { key: "payment_boost", name: "Payment received (boost)", when: "A boost is paid", subject: "Payment received: {{number}}", vars: pick("name", "amount", "number", "link"),
    body: `Namaste {{name}},\n\nWe received Rs. {{amount}} for your boost. It runs on its dates by itself; see how it does in Business → Promote.\n\n{{link}}${sign}` },
  { key: "plan_renews", name: "Plan renews soon (billing)", when: "Billing reminder days before the plan ends", subject: "{{business}}: {{plan}} renews in {{in}}", vars: pick("name", "business", "plan", "in", "until", "link"),
    body: `Namaste {{name}},\n\n{{business}}'s {{plan}} plan is paid until {{until}}. The renewal invoice is ready; pay it by eSewa, Khalti, Fonepay or bank transfer to keep everything running.\n\n{{link}}${sign}` },
  { key: "plan_past_due", name: "Plan payment due", when: "The plan ended; grace days start", subject: "{{business}}: payment due", vars: pick("name", "business", "plan", "until", "date", "link"),
    body: `Namaste {{name}},\n\n{{business}}'s {{plan}} plan ended on {{until}}. Everything keeps working until {{date}}; after that the business moves to the free Starter plan.\n\n{{link}}${sign}` },
  { key: "plan_to_starter", name: "Moved to Starter", when: "Grace days ended without payment", subject: "{{business}} is now on Starter", vars: pick("name", "business", "plan", "link"),
    body: `Namaste {{name}},\n\nThe {{plan}} plan wasn't renewed, so {{business}} is on the free Starter plan now. Your listings and data stay; Starter's limits apply to anything new. Pay for a plan any time to get everything back.\n\n{{link}}${sign}` },
  { key: "ota_update", name: "Other-sites update", when: "The channel team moves a request on", subject: "Your listing on {{channel}}: {{status}}", vars: pick("name", "channel", "status", "message", "link"),
    body: `Namaste {{name}},\n\n{{message}}\n\n{{link}}${sign}` },
  { key: "reminder_plan", name: "Reminder: plan renews", when: "Days before the plan ends, no auto-pay", subject: "{{business}}: {{plan}} renews in {{in}}", vars: pick("name", "business", "plan", "in", "until", "link"),
    body: `Namaste {{name}},\n\n{{business}}'s {{plan}} plan is paid until {{until}} and will not renew by itself. Pay the renewal invoice to keep everything running.\n\n{{link}}${sign}` },
  { key: "reminder_listings", name: "Reminder: listings not updated", when: "Listings not updated for a long time", subject: "{{count}} listing(s) need a look", vars: pick("name", "business", "count", "days", "list", "link"),
    body: `Namaste {{name}},\n\n{{count}} of {{business}}'s listings haven't been updated for {{days}} days:\n{{list}}\n\nOpen each one and check the price and status so visitors see the truth.\n\n{{link}}${sign}` },
  { key: "reminder_boost", name: "Reminder: boost ends tomorrow", when: "The day before a boost ends", subject: "Your boost ends tomorrow", vars: pick("name", "business", "list", "date", "link"),
    body: `Namaste {{name}},\n\nYour boost for {{list}} ends on {{date}}. Book another one to stay at the top.\n\n{{link}}${sign}` },
  { key: "reminder_banner", name: "Reminder: banner ends tomorrow", when: "The day before a banner ends", subject: "Your banner ends tomorrow", vars: pick("name", "business", "list", "date", "link"),
    body: `Namaste {{name}},\n\nYour home page banner "{{list}}" ends on {{date}}. Book new dates to keep it showing.\n\n{{link}}${sign}` },
];
export const defOf = (key: string) => TEMPLATE_DEFS.find((d) => d.key === key);

/** Fills {{placeholders}}; one that has no value becomes empty. */
export const renderText = (text: string, vars: Record<string, string>) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
export const placeholdersIn = (text: string) => [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!))];
/** Every template may also use {{site}} (the website address). */
export const allowedVars = (key: string) => [...Object.keys(defOf(key)?.vars ?? {}), "site"];

/** The values shown in a preview. */
export const SAMPLE_VALUES: Record<string, string> = {
  name: "Sita", business: "Lakeside Retreat Hotel", link: "https://sheetalproperty.com/business/billing", amount: "14,916", number: "INV-2083-0042", until: "12 Magh 2083",
  plan: "Business", days: "90", in: "3 days", what: "Business (1 month)", channel: "Booking.com", status: "Live", message: "Your listing is live on Booking.com.",
  inviter: "Ram", role: "operations", count: "3", list: "• Lakeside Deluxe Room\n• Garden Suite\n• Family Room", date: "12 Magh 2083", site: "https://sheetalproperty.com",
};

/** The saved wording for a message, or null when the built-in text should be used. */
export async function activeTemplate(db: Db, key: string, channel: TplChannel = "email", lang = "en") {
  const t = await db.messageTemplate.findUnique({ where: { key_channel_lang: { key, channel, lang } } });
  return t?.active ? t : null;
}

/** The built-in subject and text of a message, filled in (used when a sender has no text of its own). */
export function builtIn(key: string, vars: Record<string, string>) {
  const d = defOf(key);
  if (!d) throw new Error(`no built-in template ${key}`);
  const v = { site: "https://sheetalproperty.com", ...vars };
  return { subject: renderText(d.subject, v), text: renderText(d.body, v) };
}
