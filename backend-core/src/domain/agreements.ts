// Agreements: the built-in templates (rent, sale token, management, booking, blank), their fields, and turning a
// template plus the filled-in values into the final English and Nepali texts.
// Where it fits: the business API makes, edits and sends agreements (business/backend/src/modules/agreements); the
// website API shows them to the people signing (website/backend/src/modules/sign).
// How it works: a body is plain text with {{placeholders}}; "# " starts the heading. The English and the Nepali copy
// are two separate, complete documents: each is filled with values written for that language (names and text fields
// have an English and a Nepali value), and the Nepali copy shows numbers in Devanagari digits. A placeholder with no
// value shows as ⟦label⟧ in previews and stops the agreement being sent.
// Rules: the wording is a starting point; the business should have a lawyer check it before first use. Dates are AD
// (written in Nepali in the Nepali copy) until an official BS calendar table is added.

import { createHash } from "node:crypto";
import { z } from "zod";
import { dayOf, ymd } from "./money.js";

export const KINDS = ["rent", "sale", "management", "booking", "blank"] as const;
export type Kind = (typeof KINDS)[number];
export const LANGS = ["en", "ne", "both"] as const;
export type Lang = (typeof LANGS)[number];
export const ROLES = ["p1", "p2", "witness"] as const;
export const STATUSES = ["draft", "sent", "signed", "cancelled"] as const;
export const AGREEMENT_PERM = "agreements.manage";

type Two = { en: string; ne: string };
type FieldType = "text" | "money" | "date" | "number" | "pct" | "time";
export interface FieldDef { key: string; type: FieldType; label: Two; default?: string | number }

const F = (key: string, type: FieldType, en: string, ne: string, def?: string | number): FieldDef => ({ key, type, label: { en, ne }, ...(def !== undefined ? { default: def } : {}) });
const DATE = F("date", "date", "Agreement date", "सम्झौता मिति");
const PROPERTY = F("property", "text", "Property", "सम्पत्ति");
const ADDRESS = F("address", "text", "Property address", "सम्पत्तिको ठेगाना");
const BUSINESS = F("business", "text", "Business name", "व्यवसायको नाम");

const DISPUTES: Two = {
  en: "Disputes. The parties will first try to settle any dispute by talking to each other. If they cannot, it will be settled under the laws of Nepal.",
  ne: "विवाद: कुनै विवाद उत्पन्न भएमा दुवै पक्षले पहिले आपसी छलफलबाट समाधान गर्नेछन्। समाधान हुन नसकेमा नेपाल कानुनबमोजिम हुनेछ।",
};
const CLOSE: Two = {
  en: "Both parties have read and understood this agreement and sign it of their own free will.",
  ne: "यो सम्झौता दुवै पक्षले पढी, बुझी, आफ्नो राजीखुसीले हस्ताक्षर गरेका छन्।",
};
const NE_NUM = ["१", "२", "३", "४", "५", "६", "७", "८", "९", "१०", "११", "१२"];
const clauses = (lang: "en" | "ne", list: string[]) => list.map((c, i) => `${lang === "en" ? i + 1 : NE_NUM[i]}. ${c}`).join("\n\n");
const doc = (lang: "en" | "ne", head: string, intro: string, list: string[]) => `# ${head}\n\n${intro}\n\n${clauses(lang, [...list, DISPUTES[lang]])}\n\n${CLOSE[lang]}`;

export interface Template { kind: Kind; label: Two; roles: { p1: Two; p2: Two }; fields: FieldDef[]; body: Two; /** p1 or p2 is the business itself (its person signs for it). */ businessSide?: "p1" | "p2" }

export const TEMPLATES: Record<Kind, Template> = {
  rent: {
    kind: "rent", label: { en: "Rent agreement", ne: "घर भाडा सम्झौता" }, roles: { p1: { en: "Landlord", ne: "घरधनी" }, p2: { en: "Tenant", ne: "भाडावाल" } },
    fields: [DATE, PROPERTY, ADDRESS, F("start", "date", "Starts on", "सुरु मिति"), F("end", "date", "Ends on", "अन्त्य मिति"), F("rent", "money", "Monthly rent", "मासिक भाडा"), F("due_day", "number", "Rent due by (day of month)", "भाडा बुझाउने तारिख", 7), F("deposit", "money", "Deposit", "धरौटी"), F("notice", "number", "Notice to end (months)", "अन्त्य गर्न सूचना (महिना)", 1)],
    body: {
      en: doc("en", "Rent Agreement", "This agreement is made on {{date}} between {{p1}}, of {{p1_address}} (citizenship no. {{p1_id}}), the landlord, and {{p2}}, of {{p2_address}} (citizenship no. {{p2_id}}), the tenant.", [
        "Property. The landlord lets to the tenant {{property}}, at {{address}}.",
        "Term. This agreement runs from {{start}} to {{end}}.",
        "Rent. The monthly rent is {{rent}}, to be paid by day {{due_day}} of each month.",
        "Deposit. The tenant has paid a deposit of {{deposit}}. When the tenant leaves, the landlord returns it, less any unpaid rent, unpaid bills and the cost of damage beyond normal wear.",
        "Bills. The tenant pays the electricity, water, internet and other bills for the time they live in the property.",
        "Use. The tenant uses the property only for the agreed purpose, keeps it clean, and does not sublet it without the landlord's written consent.",
        "Repairs. The landlord pays for major repairs. The tenant pays for damage they cause.",
        "Rent tax. The landlord pays the house rent tax required by law.",
        "Notice. Either party may end this agreement by giving {{notice}} months' written notice.",
      ]),
      ne: doc("ne", "घर भाडा सम्झौता", "{{p1_address}} बस्ने ना.प्र.नं. {{p1_id}} भएका {{p1}} (यसपछि \"घरधनी\" भनिएको) र {{p2_address}} बस्ने ना.प्र.नं. {{p2_id}} भएका {{p2}} (यसपछि \"भाडावाल\" भनिएको) बीच मिति {{date}} मा देहायका सर्तहरूमा यो भाडा सम्झौता गरिएको छ।", [
        "सम्पत्ति: घरधनीले {{address}} मा रहेको {{property}} भाडावाललाई भाडामा दिएको छ।",
        "अवधि: यो सम्झौता मिति {{start}} देखि {{end}} सम्म लागू रहनेछ।",
        "भाडा: मासिक भाडा {{rent}} हुनेछ, जुन प्रत्येक महिनाको {{due_day}} तारिखभित्र बुझाउनुपर्नेछ।",
        "धरौटी: भाडावालले {{deposit}} धरौटी बुझाएको छ। भाडावालले घर छाड्दा बाँकी भाडा, नतिरेको बिल र सामान्य प्रयोगभन्दा बढी भएको क्षतिको रकम कटाई बाँकी धरौटी घरधनीले फिर्ता गर्नेछ।",
        "बिल: बसोबास अवधिको बिजुली, पानी, इन्टरनेट लगायतका बिल भाडावालले तिर्नेछ।",
        "प्रयोग: भाडावालले सम्पत्ति तोकिएको प्रयोजनमा मात्र प्रयोग गर्नेछ, सफा राख्नेछ र घरधनीको लिखित सहमतिबिना अरूलाई भाडामा दिने छैन।",
        "मर्मत: ठूला मर्मतको खर्च घरधनीले बेहोर्नेछ। भाडावालबाट भएको क्षतिको खर्च भाडावालले बेहोर्नेछ।",
        "भाडा कर: कानुनबमोजिम लाग्ने घर भाडा कर घरधनीले तिर्नेछ।",
        "सूचना: कुनै पनि पक्षले {{notice}} महिना अगावै लिखित सूचना दिई यो सम्झौता अन्त्य गर्न सक्नेछ।",
      ]),
    },
  },
  sale: {
    kind: "sale", label: { en: "Sale token (bainā) agreement", ne: "बैना सम्झौता" }, roles: { p1: { en: "Seller", ne: "बिक्रेता" }, p2: { en: "Buyer", ne: "खरिदकर्ता" } },
    fields: [DATE, PROPERTY, ADDRESS, F("price", "money", "Full price", "जम्मा मूल्य"), F("token", "money", "Token (bainā)", "बैना रकम"), F("deadline", "date", "Register by", "रजिस्ट्रेसन गर्ने अन्तिम मिति")],
    body: {
      en: doc("en", "Sale Token (Bainā) Agreement", "This agreement is made on {{date}} between {{p1}}, of {{p1_address}} (citizenship no. {{p1_id}}), the seller, and {{p2}}, of {{p2_address}} (citizenship no. {{p2_id}}), the buyer.", [
        "Property. The seller agrees to sell to the buyer {{property}}, at {{address}}.",
        "Price. The full price is {{price}}.",
        "Token. Today the buyer pays the seller {{token}} as a token (bainā). It counts towards the price.",
        "Registration. The parties will register the transfer at the Land Revenue Office by {{deadline}}. The buyer pays the remaining {{balance}} on the day of registration.",
        "Documents. The seller confirms that the property is in their name and free of loans, mortgages and disputes, and will provide the land ownership certificate (lalpurja), map, trace and the latest land tax receipt.",
        "If the buyer backs out. If the buyer does not complete the purchase by the date above, the token belongs to the seller.",
        "If the seller backs out. If the seller does not complete the sale by the date above, the seller pays the buyer double the token.",
        "Costs. Unless the parties agree otherwise in writing, the buyer pays the registration fee and the seller pays the capital gains tax, as the law requires.",
      ]),
      ne: doc("ne", "घरजग्गा खरिद बिक्री बैना सम्झौता", "{{p1_address}} बस्ने ना.प्र.नं. {{p1_id}} भएका {{p1}} (यसपछि \"बिक्रेता\" भनिएको) र {{p2_address}} बस्ने ना.प्र.नं. {{p2_id}} भएका {{p2}} (यसपछि \"खरिदकर्ता\" भनिएको) बीच मिति {{date}} मा देहायका सर्तहरूमा यो बैना सम्झौता गरिएको छ।", [
        "सम्पत्ति: बिक्रेताले {{address}} मा रहेको {{property}} खरिदकर्तालाई बिक्री गर्न मञ्जुर गरेको छ।",
        "मूल्य: जम्मा मूल्य {{price}} हुनेछ।",
        "बैना: आज खरिदकर्ताले बिक्रेतालाई {{token}} बैनाबापत बुझाएको छ। यो रकम जम्मा मूल्यमा गणना हुनेछ।",
        "रजिस्ट्रेसन: दुवै पक्षले मिति {{deadline}} भित्र मालपोत कार्यालयमा रजिस्ट्रेसन पास गर्नेछन्। बाँकी रकम {{balance}} खरिदकर्ताले रजिस्ट्रेसनकै दिन बुझाउनेछ।",
        "कागजात: उक्त सम्पत्ति आफ्नै नाममा रहेको र कुनै ऋण, धितो वा विवादमा नपरेको बिक्रेताले पुष्टि गर्दछ। बिक्रेताले लालपुर्जा, नक्सा, ट्रेस र पछिल्लो मालपोत तिरेको रसिद उपलब्ध गराउनेछ।",
        "खरिदकर्ता पछि हटेमा: माथि तोकिएको मितिभित्र खरिदकर्ताले खरिद नगरेमा बैना रकम बिक्रेताको हुनेछ।",
        "बिक्रेता पछि हटेमा: माथि तोकिएको मितिभित्र बिक्रेताले बिक्री नगरेमा बिक्रेताले बैनाको दोब्बर रकम खरिदकर्तालाई तिर्नेछ।",
        "खर्च: लिखित रूपमा अर्को सहमति नभएसम्म रजिस्ट्रेसन दस्तुर खरिदकर्ताले र पुँजीगत लाभकर बिक्रेताले कानुनबमोजिम तिर्नेछन्।",
      ]),
    },
  },
  management: {
    kind: "management", label: { en: "Management agreement (owner and agency)", ne: "सम्पत्ति व्यवस्थापन सम्झौता" }, roles: { p1: { en: "Owner", ne: "घरधनी" }, p2: { en: "For the agency", ne: "एजेन्सीको तर्फबाट" } }, businessSide: "p2",
    fields: [DATE, BUSINESS, PROPERTY, ADDRESS, F("start", "date", "Starts on", "सुरु मिति"), F("end", "date", "Ends on", "अन्त्य मिति"), F("fee_pct", "pct", "Management fee (% of rent)", "व्यवस्थापन शुल्क (भाडाको प्रतिशत)", 8), F("pay_day", "number", "Owner paid by (day of month)", "घरधनीलाई भुक्तानी गर्ने तारिख", 10), F("bank", "text", "Owner's bank account", "घरधनीको बैंक खाता"), F("repair_limit", "money", "Repairs above this need the owner's consent", "घरधनीको सहमति चाहिने मर्मत रकम", 5000), F("notice", "number", "Notice to end (months)", "अन्त्य गर्न सूचना (महिना)", 2)],
    body: {
      en: doc("en", "Property Management Agreement", "This agreement is made on {{date}} between {{p1}}, of {{p1_address}} (citizenship no. {{p1_id}}), the owner, and {{business}}, represented by {{p2}}, the agency.", [
        "Property. The owner gives the agency the management of {{property}}, at {{address}}.",
        "Term. This agreement runs from {{start}} to {{end}}.",
        "Services. The agency finds and checks tenants, makes rent agreements, collects rent and deposits, arranges repairs, and gives the owner a statement every month.",
        "Fee. The agency keeps a management fee of {{fee_pct}} of the rent it collects.",
        "Payment to the owner. By day {{pay_day}} of the following month, the agency pays the owner the rent collected, less its fee and the cost of repairs, to this account: {{bank}}.",
        "Repairs. Except in an emergency, the agency asks the owner before any repair costing more than {{repair_limit}}.",
        "Deposits. The agency holds tenants' deposits and returns them under the rent agreements. Deposits are not income of either party.",
        "Notice. Either party may end this agreement by giving {{notice}} months' written notice. The agency then hands over all records, keys and money it holds within 15 days.",
      ]),
      ne: doc("ne", "सम्पत्ति व्यवस्थापन सम्झौता", "{{p1_address}} बस्ने ना.प्र.नं. {{p1_id}} भएका {{p1}} (यसपछि \"घरधनी\" भनिएको) र {{p2}} मार्फत प्रतिनिधित्व गरिएको {{business}} (यसपछि \"एजेन्सी\" भनिएको) बीच मिति {{date}} मा देहायका सर्तहरूमा यो सम्झौता गरिएको छ।", [
        "सम्पत्ति: घरधनीले {{address}} मा रहेको {{property}} को व्यवस्थापन एजेन्सीलाई सुम्पेको छ।",
        "अवधि: यो सम्झौता मिति {{start}} देखि {{end}} सम्म लागू रहनेछ।",
        "सेवा: एजेन्सीले भाडावाल खोज्ने र जाँच्ने, भाडा सम्झौता गर्ने, भाडा र धरौटी उठाउने, मर्मत गराउने तथा घरधनीलाई मासिक विवरण दिने काम गर्नेछ।",
        "शुल्क: एजेन्सीले उठाएको भाडाको {{fee_pct}} व्यवस्थापन शुल्क राख्नेछ।",
        "घरधनीलाई भुक्तानी: उठेको भाडाबाट शुल्क र मर्मत खर्च कटाई बाँकी रकम एजेन्सीले अर्को महिनाको {{pay_day}} तारिखभित्र घरधनीको यस खातामा पठाउनेछ: {{bank}}।",
        "मर्मत: आपत्कालीन अवस्थाबाहेक {{repair_limit}} भन्दा बढी लागतको मर्मत गर्नुअघि एजेन्सीले घरधनीको सहमति लिनेछ।",
        "धरौटी: भाडावालको धरौटी एजेन्सीले राख्नेछ र भाडा सम्झौताबमोजिम भाडावाललाई फिर्ता गर्नेछ। धरौटी कुनै पनि पक्षको आम्दानी होइन।",
        "सूचना: कुनै पनि पक्षले {{notice}} महिना अगावै लिखित सूचना दिई यो सम्झौता अन्त्य गर्न सक्नेछ। त्यसपछि १५ दिनभित्र एजेन्सीले सबै अभिलेख, साँचो र आफूसँग रहेको रकम घरधनीलाई बुझाउनेछ।",
      ]),
    },
  },
  booking: {
    kind: "booking", label: { en: "Booking agreement", ne: "बुकिङ सम्झौता" }, roles: { p1: { en: "For the host", ne: "आतिथ्य प्रदायकको तर्फबाट" }, p2: { en: "Guest", ne: "पाहुना" } }, businessSide: "p1",
    fields: [DATE, BUSINESS, PROPERTY, ADDRESS, F("guests", "number", "Guests", "पाहुना संख्या", 2), F("checkin", "date", "Check-in date", "चेक-इन मिति"), F("checkin_time", "time", "Check-in from", "चेक-इन समय", "14:00"), F("checkout", "date", "Check-out date", "चेक-आउट मिति"), F("checkout_time", "time", "Check-out by", "चेक-आउट समय", "12:00"), F("amount", "money", "Total price", "जम्मा मूल्य"), F("advance", "money", "Advance", "अग्रिम रकम"), F("cancel_days", "number", "Free cancellation until (days before)", "निःशुल्क रद्द गर्न सकिने (दिन अघि)", 7)],
    body: {
      en: doc("en", "Booking Agreement", "This agreement is made on {{date}} between {{business}}, represented by {{p1}}, the host, and {{p2}}, of {{p2_address}}, the guest.", [
        "Stay. The host provides {{property}}, at {{address}}, for {{guests}} guests.",
        "Dates. Check-in is on {{checkin}} from {{checkin_time}}. Check-out is on {{checkout}} by {{checkout_time}}.",
        "Price. The total price is {{amount}}. The guest pays {{advance}} in advance to confirm the booking, and the rest at check-in.",
        "Cancellation. If the guest cancels at least {{cancel_days}} days before check-in, the advance is refunded in full. After that, the advance is not refunded.",
        "House rules. The guest follows the host's house rules, keeps noise down at night, and pays for any damage caused during the stay.",
        "Identity. Every guest shows a valid citizenship certificate or passport at check-in.",
      ]),
      ne: doc("ne", "बुकिङ सम्झौता", "{{p1}} मार्फत प्रतिनिधित्व गरिएको {{business}} (यसपछि \"आतिथ्य प्रदायक\" भनिएको) र {{p2_address}} बस्ने {{p2}} (यसपछि \"पाहुना\" भनिएको) बीच मिति {{date}} मा देहायका सर्तहरूमा यो सम्झौता गरिएको छ।", [
        "बसाइ: आतिथ्य प्रदायकले {{address}} मा रहेको {{property}} {{guests}} जना पाहुनाका लागि उपलब्ध गराउनेछ।",
        "मिति: चेक-इन मिति {{checkin}} मा {{checkin_time}} देखि हुनेछ। चेक-आउट मिति {{checkout}} मा {{checkout_time}} भित्र हुनेछ।",
        "मूल्य: जम्मा मूल्य {{amount}} हुनेछ। बुकिङ पक्का गर्न पाहुनाले {{advance}} अग्रिम बुझाउनेछ र बाँकी रकम चेक-इनमा बुझाउनेछ।",
        "रद्द: चेक-इनभन्दा कम्तीमा {{cancel_days}} दिनअघि पाहुनाले बुकिङ रद्द गरेमा अग्रिम रकम पूरै फिर्ता हुनेछ। त्यसपछि रद्द गरेमा अग्रिम रकम फिर्ता हुने छैन।",
        "नियम: पाहुनाले आतिथ्य प्रदायकका नियम पालना गर्नेछ, राति होहल्ला गर्ने छैन र बसाइका क्रममा भएको क्षतिको खर्च बेहोर्नेछ।",
        "परिचय: चेक-इनका बेला प्रत्येक पाहुनाले मान्य नागरिकता प्रमाणपत्र वा राहदानी देखाउनुपर्नेछ।",
      ]),
    },
  },
  blank: {
    kind: "blank", label: { en: "Blank agreement", ne: "खाली सम्झौता" }, roles: { p1: { en: "First party", ne: "पहिलो पक्ष" }, p2: { en: "Second party", ne: "दोस्रो पक्ष" } },
    fields: [DATE],
    body: {
      en: `# Agreement\n\nThis agreement is made on {{date}} between {{p1}} and {{p2}}.\n\n1. \n\n${CLOSE.en}`,
      ne: `# सम्झौता\n\nमिति {{date}} मा {{p1}} र {{p2}} बीच देहायका सर्तहरूमा यो सम्झौता गरिएको छ।\n\n१. \n\n${CLOSE.ne}`,
    },
  },
};
export const WITNESS: Two = { en: "Witness", ne: "साक्षी" };
export const roleLabel = (kind: Kind, role: string): Two => (role === "witness" ? WITNESS : TEMPLATES[kind].roles[role as "p1" | "p2"] ?? { en: role, ne: role });

// ───── Values, signers and their checks ─────
const T2 = z.object({ en: z.string().trim().max(400).default(""), ne: z.string().trim().max(400).default("") });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04.").refine((s) => { const d = dayOf(s); return !Number.isNaN(d.getTime()) && ymd(d) === s; }, "That date doesn't exist.");
const FIELD_SCHEMA: Record<FieldType, z.ZodTypeAny> = {
  text: T2,
  money: z.number().int("Use whole rupees.").min(0).max(100_000_000_000),
  number: z.number().int().min(0).max(100_000),
  pct: z.number().min(0).max(100),
  date: Day,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 14:00."),
};
/** Checks the values against the kind's fields: unknown keys are dropped, empty ones may stay empty (the draft). */
export function parseValues(kind: Kind, raw: unknown) {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};
  for (const f of TEMPLATES[kind].fields) {
    const v = o[f.key];
    if (v == null || v === "") continue;
    const r = FIELD_SCHEMA[f.type].safeParse(v);
    if (r.success) out[f.key] = r.data; else errors[f.key] = [r.error.issues[0]?.message ?? "Check this value."];
  }
  return { values: out, errors };
}

export const SignerInput = z.object({
  id: z.string().max(40).optional(),
  role: z.enum(ROLES),
  name: z.string().trim().max(120).default(""),
  nameNe: z.string().trim().max(120).default(""),
  email: z.string().trim().toLowerCase().max(200).default(""),
  phone: z.string().trim().max(30).default(""),
  address: z.string().trim().max(200).default(""),
  addressNe: z.string().trim().max(200).default(""),
  idNo: z.string().trim().max(40).default(""),
});
export type SignerIn = z.infer<typeof SignerInput>;
export const SignersInput = z.array(SignerInput).max(3)
  .refine((a) => a.filter((s) => s.role === "p1").length <= 1 && a.filter((s) => s.role === "p2").length <= 1 && a.filter((s) => s.role === "witness").length <= 1, "Each party can be named once.");

// ───── Writing values in each language ─────
const DEV = "०१२३४५६७८९";
export const neDigits = (s: string) => s.replace(/\d/g, (d) => DEV[Number(d)]!);
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NE_MONTHS = ["जनवरी", "फेब्रुअरी", "मार्च", "अप्रिल", "मे", "जुन", "जुलाई", "अगस्ट", "सेप्टेम्बर", "अक्टोबर", "नोभेम्बर", "डिसेम्बर"];
const group = (n: number) => Math.round(n).toLocaleString("en-IN");

export function formatValue(type: FieldType, v: unknown, lang: "en" | "ne"): string {
  if (v == null || v === "") return "";
  switch (type) {
    case "text": return String((v as Two)[lang] ?? "").trim();
    case "money": return lang === "en" ? `Rs. ${group(Number(v))}` : `रु. ${neDigits(group(Number(v)))}`;
    case "number": return lang === "en" ? String(v) : neDigits(String(v));
    case "pct": return lang === "en" ? `${v}%` : `${neDigits(String(v))} प्रतिशत`;
    case "date": { const [y, m, d] = String(v).split("-").map(Number); return lang === "en" ? `${d} ${EN_MONTHS[m! - 1]} ${y}` : `ई.सं. ${neDigits(String(y))} ${NE_MONTHS[m! - 1]} ${neDigits(String(d))}`; }
    case "time": { const [h, mi] = String(v).split(":").map(Number); return lang === "en" ? `${((h! + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${h! < 12 ? "am" : "pm"}` : `${neDigits(`${h}:${String(mi).padStart(2, "0")}`)} बजे`; }
  }
}

interface SignerLike { role: string; name: string; nameNe?: string | null; address?: string | null; addressNe?: string | null; idNo?: string | null }

/** Every placeholder's value in one language ("" = missing), with its label for the "fill in" list. */
export function placeholderValues(kind: Kind, values: Record<string, unknown>, signers: SignerLike[], lang: "en" | "ne") {
  const t = TEMPLATES[kind];
  const map: Record<string, { value: string; label: string }> = {};
  for (const f of t.fields) map[f.key] = { value: formatValue(f.type, values[f.key], lang), label: f.label[lang] };
  if (kind === "sale") {
    const p = Number(values.price), k = Number(values.token);
    map.balance = { value: values.price != null && values.token != null && p >= k ? formatValue("money", p - k, lang) : "", label: lang === "en" ? "Balance" : "बाँकी रकम" };
  }
  for (const r of ["p1", "p2"] as const) {
    const s = signers.find((x) => x.role === r);
    const role = t.roles[r][lang];
    const pick = (en?: string | null, ne?: string | null) => (lang === "en" ? en ?? "" : ne || "").trim();
    map[r] = { value: pick(s?.name, s?.nameNe), label: lang === "en" ? `${role}'s name` : `${role}को नाम` };
    map[`${r}_address`] = { value: pick(s?.address, s?.addressNe), label: lang === "en" ? `${role}'s address` : `${role}को ठेगाना` };
    map[`${r}_id`] = { value: lang === "en" ? (s?.idNo ?? "").trim() : neDigits((s?.idNo ?? "").trim()), label: lang === "en" ? `${role}'s citizenship no.` : `${role}को ना.प्र.नं.` };
  }
  return map;
}

/** Fills a body. Missing values show as ⟦label⟧ and are listed. Unknown placeholders are left out and listed too. */
export function fillBody(body: string, map: Record<string, { value: string; label: string }>) {
  const missing = new Set<string>();
  const text = body.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => {
    const e = map[key.toLowerCase()];
    if (!e) { missing.add(`{{${key}}}`); return `⟦${key}⟧`; }
    if (!e.value) { missing.add(e.label); return `⟦${e.label}⟧`; }
    return e.value;
  });
  return { text, missing: [...missing] };
}

export const langsOf = (lang: string): ("en" | "ne")[] => (lang === "both" ? ["en", "ne"] : lang === "ne" ? ["ne"] : ["en"]);

/** The filled texts of an agreement in its languages, and what is still missing (by language). */
export function render(a: { kind: string; lang: string; values: unknown; bodyEn: string; bodyNe: string }, signers: SignerLike[]) {
  const kind = a.kind as Kind;
  const values = (a.values ?? {}) as Record<string, unknown>;
  const texts: Partial<Record<"en" | "ne", string>> = {};
  const missing: Partial<Record<"en" | "ne", string[]>> = {};
  for (const l of langsOf(a.lang)) {
    const r = fillBody(l === "en" ? a.bodyEn : a.bodyNe, placeholderValues(kind, values, signers, l));
    texts[l] = r.text;
    if (r.missing.length) missing[l] = r.missing;
  }
  return { texts, missing };
}

/** What stops an agreement being sent (null when it can be). */
export function sendProblem(a: { kind: string; lang: string; values: unknown; bodyEn: string; bodyNe: string }, s: (SignerLike & { email?: string | null })[]): string | null {
  if (!s.some((x) => x.role === "p1") || !s.some((x) => x.role === "p2")) return "Name both parties before sending.";
  for (const x of s) {
    if (!x.name?.trim()) return "Every person signing needs a name.";
    if (!x.email || !z.email().safeParse(x.email).success) return `Add a working email for ${x.name}: their signing code goes there.`;
  }
  const emails = s.map((x) => x.email!.toLowerCase());
  if (new Set(emails).size !== emails.length) return "Each person signing needs their own email.";
  for (const l of langsOf(a.lang)) {
    const body = (l === "en" ? a.bodyEn : a.bodyNe).trim();
    if (body.replace(/\{\{[^}]*\}\}/g, "").replace(/[#\s\d१-९.]/g, "").length < 20) return l === "en" ? "Write the English text first." : "Write the Nepali text first.";
  }
  const { missing } = render(a, s);
  const m = [...(missing.en ?? []), ...(missing.ne ?? [])];
  if (m.length) return `Fill in: ${[...new Set(m)].slice(0, 6).join(", ")}${m.length > 6 ? "…" : ""}.`;
  const v = (a.values ?? {}) as Record<string, number | string>;
  if (a.kind === "sale" && Number(v.token) > Number(v.price)) return "The token can't be more than the price.";
  if (a.kind === "booking" && Number(v.advance) > Number(v.amount)) return "The advance can't be more than the total price.";
  for (const [from, to, what] of [["start", "end", "The end date"], ["checkin", "checkout", "Check-out"]] as const) {
    if (v[from] && v[to] && String(v[to]) <= String(v[from])) return `${what} must be after the start.`;
  }
  return null;
}

/** The fingerprint of what is signed: the texts and the people, exactly as sent. */
export function hashOf(a: { ref: string; title: string; lang: string }, texts: Partial<Record<"en" | "ne", string>>, signers: { role: string; name: string; email: string }[]) {
  const payload = JSON.stringify({ ref: a.ref, title: a.title, lang: a.lang, en: texts.en ?? null, ne: texts.ne ?? null, signers: signers.map((s) => ({ role: s.role, name: s.name, email: s.email.toLowerCase() })) });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export const agreementNo = (seq: number) => `AG-${String(seq).padStart(4, "0")}`;
/** A Nepal-time stamp for the signing record: 2026-11-05 14:32 (NPT). */
export const nepalTime = (d: Date) => `${new Date(d.getTime() + 5.75 * 3_600_000).toISOString().slice(0, 16).replace("T", " ")} (NPT)`;
export const maskEmail = (e: string) => { const [u, d] = e.split("@"); return `${u!.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, u!.length - 2)))}@${d}`; };

// ───── One-time codes ─────
export const OTP_MINUTES = 10;
export const OTP_TRIES = 5;
export const OTP_SENDS = 5;
export const OTP_GAP_SECONDS = 60;
export const otpHash = (signerId: string, code: string) => createHash("sha256").update(`${signerId}:${code}`).digest("hex");
