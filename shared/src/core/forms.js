// Online forms: field types, templates per business type, plan limits and links.
// Data: db.forms[tenantId] = [{ id, slug, title, desc, fields, dest, places, style, thanks, pay, status, tpl, created }]
//       db.formResponses[tenantId] = [{ id, formId, formTitle, dest, at, name, phone, answers, pay, summary }]
// Until a business saves its first form, sampleForms() fills the list so the page isn't empty in the demo.
import { TODAY } from "./format";

export const FIELD_TYPES = {
  short: { icon: "pen-line", label: "Short answer", ph: "Your answer" },
  long: { icon: "text", label: "Paragraph", ph: "Write here" },
  phone: { icon: "phone", label: "Phone", ph: "98XXXXXXXX" },
  email: { icon: "mail", label: "Email", ph: "you@example.com" },
  number: { icon: "calculator", label: "Number", ph: "0" },
  money: { icon: "banknote", label: "Amount (Rs.)", ph: "Rs." },
  date: { icon: "calendar", label: "Date" },
  time: { icon: "clock", label: "Time" },
  single: { icon: "circle-check", label: "Single choice" },
  multi: { icon: "list-checks", label: "Checkboxes" },
  dropdown: { icon: "chevron-down", label: "Dropdown" },
  rating: { icon: "star", label: "Rating" },
  file: { icon: "upload", label: "File upload" },
  location: { icon: "map-pin", label: "Location" },
  payment: { icon: "qr-code", label: "Payment" },
  section: { icon: "type", label: "Section heading", noAnswer: true },
  page: { icon: "file-plus", label: "Page break", noAnswer: true },
};
export const PALETTE = [
  ["Text", ["short", "long", "phone", "email"]],
  ["Numbers and time", ["number", "money", "date", "time"]],
  ["Choices", ["single", "multi", "dropdown", "rating"]],
  ["More", ["file", "location", "payment", "section", "page"]],
];
export const CHOICE = ["single", "multi", "dropdown"];
export const DESTS = [["leads", "Leads"], ["jobs", "Jobs"], ["requirements", "Requirements"]];
export const DEST_LABEL = { leads: "Leads", jobs: "Job applicants", requirements: "Requirements" };
export const PLACES = [
  ["profile", "Business public profile", "In the Forms block on your public page"],
  ["listing", "Listing and room pages", "As a button next to Book or Enquire"],
  ["job", "Job posts", "Apply button on your job posts"],
  ["link", "Link and QR only", "Share it anywhere, e.g. Facebook"],
];
export const FONTS = [["brand", "Poppins", "Poppins, system-ui, sans-serif"], ["serif", "Serif", "Georgia, 'Times New Roman', serif"], ["system", "System", "system-ui, -apple-system, 'Segoe UI', sans-serif"]];
export const SWATCHES = ["#A3171F", "#1F5FAD", "#1F7A4D", "#6B3FA0", "#C26A12"];

let n = 0;
export const fieldId = () => `f${Date.now().toString(36)}${(n++).toString(36)}`;
export function makeField(type, label, extra = {}) {
  return { id: fieldId(), type, label: label ?? (type === "short" ? "Untitled question" : FIELD_TYPES[type].label), required: false, ph: FIELD_TYPES[type].ph || "", help: "", half: false, min: "", max: "",
    opts: CHOICE.includes(type) ? ["Option 1", "Option 2", "Option 3"] : [], amount: type === "payment" ? 500 : 0, ...extra };
}
const F = makeField;
const R = { required: true };

// [key, icon, name, description, dest, business types (null = every type), fields]
export const TEMPLATES = [
  ["job", "briefcase", "Job application", "Name, role, experience, CV upload and availability.", "jobs", null, (tn) => [F("short", "Full name", R), F("phone", "Phone", R), F("email", "Email"),
    F("dropdown", "Position", { ...R, opts: tn === "hotel" || tn === "host" ? ["Front desk", "Housekeeping", "Chef", "Waiter"] : ["Sales", "Site engineer", "Accounts", "Office assistant"] }),
    F("number", "Years of experience", { half: true }), F("date", "Can start from", { half: true }), F("file", "Upload your CV", R), F("long", "Why do you want to work with us?", { max: "600" })]],
  ["req", "house", "Property requirement", "What buyers or tenants want, budget and areas.", "requirements", ["agency", "developer"], () => [F("single", "I want to", { ...R, opts: ["Buy", "Rent", "Invest"] }),
    F("multi", "Property type", { opts: ["House", "Land", "Flat", "Shop"] }), F("location", "Preferred area", R), F("money", "Max budget"), F("short", "Full name", { ...R, half: true }), F("phone", "Phone", { ...R, half: true })]],
  ["book", "hotel", "Booking enquiry", "Dates, guests and room type for a stay.", "leads", ["hotel", "host"], () => [F("short", "Full name", { ...R, half: true }), F("phone", "Phone", { ...R, half: true }),
    F("date", "Check-in", { ...R, half: true }), F("date", "Check-out", { ...R, half: true }), F("number", "Guests", { min: "1", max: "12" }), F("dropdown", "Room type", { opts: ["Deluxe lake view", "Standard twin", "Family suite"] }), F("long", "Special requests")]],
  ["visit", "calendar-check", "Site-visit booking", "Pick a project, date and time for a visit.", "leads", ["developer", "agency"], () => [F("short", "Full name", { ...R, half: true }), F("phone", "Phone", { ...R, half: true }),
    F("dropdown", "Project", { opts: ["Shetal Heights", "Bhaisepati Villas"] }), F("date", "Visit date", { ...R, half: true }), F("time", "Preferred time", { half: true }), F("single", "Interested in", { opts: ["2 BHK", "3 BHK", "Villa"] })]],
  ["inv", "hand-coins", "Investor interest + KYC", "Amount, ID documents and a risk note.", "leads", ["sponsor", "developer"], () => [F("short", "Full name", R), F("phone", "Phone", R), F("money", "Amount you'd like to invest", { ...R, min: "10000" }),
    F("page", "Page break"), F("section", "KYC"), F("file", "Citizenship or passport", R), F("short", "PAN number"), F("multi", "I understand", { ...R, opts: ["Returns are not guaranteed", "I may lose money"] })]],
  ["contact", "message-square", "Contact / enquiry", "A simple message form for any question.", "leads", null, () => [F("short", "Full name", { ...R, half: true }), F("phone", "Phone", { ...R, half: true }), F("email", "Email"), F("long", "Your message", R)]],
  ["event", "party-popper", "Event or offer sign-up", "Register people for an event or a deal.", "leads", null, () => [F("short", "Full name", { ...R, half: true }), F("phone", "Phone", { ...R, half: true }), F("number", "How many people", { min: "1" }),
    F("single", "How did you hear about us?", { opts: ["Facebook", "Friend", "Walk-in"] }), F("page", "Page break"), F("payment", "Booking fee", { ...R, amount: 1000 })]],
  ["fb", "star", "Feedback / review", "Star rating and comments after a stay or visit.", "leads", null, (tn) => [F("rating", tn === "hotel" || tn === "host" ? "How was your stay?" : "How did we do?", R),
    F("multi", "What did you like?", { opts: tn === "hotel" || tn === "host" ? ["Room", "Food", "Staff", "View"] : ["Quick replies", "Clear papers", "Fair price", "Site visit"] }), F("long", "Anything we can do better?"), F("short", "Your name")]],
];
export const templatesFor = (type) => TEMPLATES.filter((x) => !x[5] || x[5].includes(type));

export const slugify = (s) => String(s || "form").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "form";
export const defaultStyle = (ts) => ({ accent: ts?.branding?.color && /^#[0-9a-f]{6}$/i.test(ts.branding.color) ? ts.branding.color : SWATCHES[0], logo: ts?.branding?.logoText || "", logoUrl: "", font: "brand", corners: "rounded", button: "Submit" });
export const placesFor = (key) => ({ profile: true, listing: key === "book" || key === "visit", job: key === "job", link: true });

export function formFromTemplate(key, tenant, ts) {
  const tp = TEMPLATES.find((x) => x[0] === key);
  const base = { id: `fm-${Math.random().toString(36).slice(2, 8)}`, status: "draft", created: TODAY.slice(0, 10), style: defaultStyle(ts), pay: { qrUrl: "", esewa: "", bank: "" } };
  if (!tp) return { ...base, tpl: null, slug: "untitled-form", title: "Untitled form", desc: "Add a short description", fields: [], dest: "leads", places: placesFor(null), thanks: "Thanks! We'll be in touch soon." };
  return { ...base, tpl: key, slug: slugify(tp[2]), title: tp[2], desc: tp[3], fields: tp[6](tenant.type), dest: tp[4], places: placesFor(key),
    thanks: key === "job" ? "Thanks for applying. We'll call you if you're shortlisted." : key === "book" ? "Thanks! Our front desk will call you within an hour." : "Thanks! We'll be in touch soon." };
}

const SAMPLE_KEYS = { hotel: ["book", "event"], host: ["book", "fb"], developer: ["visit", "job"], agency: ["req", "contact"], sponsor: ["inv", "contact"] };
export function sampleForms(tenant, ts) {
  return (SAMPLE_KEYS[tenant.type] || ["contact"]).map((k, i) => ({ ...formFromTemplate(k, tenant, ts), id: `fm-${tenant.id}-${i + 1}`, status: "live", created: "2027-02-1" + (i + 2) }));
}
const SUMS = {
  book: ["12 Mar 2027 · 15 Mar 2027 · 2", "20 Mar 2027 · 22 Mar 2027 · 3"], event: ["4 · Facebook", "2 · Friend"], job: ["Front desk · 3", "Chef · 6"],
  req: ["Buy · Land · Kapan, Kathmandu", "Rent · Flat · Jhamsikhel, Lalitpur"], visit: ["Shetal Heights · 8 Mar 2027", "Bhaisepati Villas · 10 Mar 2027"],
  inv: ["Rs. 5,00,000", "Rs. 2,00,000"], contact: ["Do you have parking for two cars?", "Can I visit this weekend?"], fb: ["5 of 5 · Staff, View", "4 of 5 · Food"],
};
const PEOPLE = [["Sita Gurung", "984-1010101"], ["Ramesh Adhikari", "981-5550011"], ["Anita Rai", "980-7712345"], ["Bikram Shah", "986-0044556"], ["Maya Lama", "984-3322110"]];
export function sampleResponses(tenant, forms) {
  const out = [];
  forms.forEach((f, fi) => [0, 1].forEach((j) => {
    const [name, phone] = PEOPLE[(fi * 2 + j) % PEOPLE.length];
    const payF = f.fields.find((x) => x.type === "payment");
    out.push({ id: `fr-${f.id}-${j}`, formId: f.id, formTitle: f.title, dest: f.dest, at: `2027-03-0${2 - j}T${j ? "15:20" : "08:40"}`, name, phone,
      answers: [["Full name", name], ["Phone", phone], ...((SUMS[f.tpl] || [])[j] || "").split(" · ").filter(Boolean).map((x, k) => [f.fields.filter((y) => !FIELD_TYPES[y.type].noAnswer && y.type !== "email" && !/name|phone/i.test(y.label))[k]?.label || "Answer", x])],
      summary: (SUMS[f.tpl] || [])[j] || f.title,
      pay: payF ? { amount: payF.amount, shot: "payment.jpg", status: j ? "confirmed" : "to_confirm" } : null });
  }));
  return out;
}

export const formsOf = (db, tenant) => db.forms?.[tenant.id] ?? sampleForms(tenant, db.tenantSettings?.[tenant.id]);
export const responsesOf = (db, tenant) => db.formResponses?.[tenant.id] ?? sampleResponses(tenant, formsOf(db, tenant));

// Free plan (and trials): 2 forms, 100 responses a month. Paid plans: no limit unless the plan sets limits.forms / limits.formResponses.
export function formLimits(db, tenant) {
  const plan = (db.plans || []).find((p) => p.id === tenant.planId);
  const free = !plan || !plan.price || tenant.status === "trial";
  return { free, forms: plan?.limits?.forms ?? (free ? 2 : -1), responses: plan?.limits?.formResponses ?? (free ? 100 : -1) };
}
export const monthResponses = (list) => list.filter((r) => String(r.at).slice(0, 7) === TODAY.slice(0, 7)).length;

// Public link on the business's own domain when one is connected, otherwise on the Sheetal business domain.
export function formLink(db, tenant, form) {
  const dom = db.domains?.[tenant.id] ?? (tenant.id === "t1" ? { name: tenant.email.split("@")[1], step: "done" } : null);
  const local = `/business/f/${form.slug}?b=${tenant.id}`;
  const host = dom && dom.step === "done" ? dom.name : null;
  return { local, host: host || (db.platformSettings?.businessDomain || "business.sheetalproperty.com"), url: host ? `https://${host}/f/${form.slug}` : `https://${db.platformSettings?.businessDomain || "business.sheetalproperty.com"}${local.replace("/business", "")}` };
}
export const placeLabels = (form) => PLACES.filter(([k]) => form.places?.[k]).map(([, l]) => l.split(" ")[0] === "Business" ? "Profile" : l.split(" ")[0]).join(" · ");
