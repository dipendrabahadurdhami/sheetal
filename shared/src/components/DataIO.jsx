import React, { useMemo, useState } from "react";
import { Badge, Button, Checkbox, Drawer, Input, useToast } from "../core/ui";
import { Icon } from "../core/icons";
import { useStore } from "../core/store";
import { TODAY } from "../core/format";
import { invoicesOf, invoiceRow, invoiceFromRow } from "../demo/money";
import { emptyOps } from "../demo/ops";

// Import + export for ONE kind of data, placed on the page that shows that data (Bookings, Leads, Invoices …).
// Each kind has its own template, so people only fill in the columns that page needs.
// Columns: [header, required, example, hint, key, type]. type: text | num | date | phone | email | enum | stars
// For enum columns the hint lists the allowed values, comma separated.
export const TEMPLATES = {
  bookings: { label: "Bookings", cols: [["Guest name", 1, "Sita Gurung", "", "guest"], ["Phone", 1, "9841010101", "", "phone", "phone"], ["Room no", 1, "201", "", "room"], ["Check-in", 1, "2027-03-12", "YYYY-MM-DD", "from", "date"], ["Check-out", 1, "2027-03-15", "YYYY-MM-DD", "to", "date"], ["Guests", 0, "2", "", "guests", "num"], ["Amount", 1, "49720", "", "amount", "num"], ["Paid", 0, "14916", "", "paid", "num"], ["Came from", 0, "Walk-in", "Sheetal, Booking.com, Airbnb, Walk-in, Website", "source", "enum"]] },
  guests: { label: "Guests", cols: [["Name", 1, "Sita Gurung", "", "name"], ["Phone", 1, "9841010101", "", "phone", "phone"], ["Email", 0, "sita@gmail.com", "", "email", "email"], ["Nationality", 0, "Nepali", "", "nationality"], ["ID no", 0, "27-01-74-01234", "", "idNo"], ["Birthday", 0, "1994-03-04", "YYYY-MM-DD", "birthday", "date"]] },
  rooms: { label: "Rooms", cols: [["Room no", 1, "201", "", "no"], ["Room type", 1, "Deluxe lake view", "", "type"], ["Beds", 1, "Queen", "", "beds"], ["Max guests", 1, "2", "", "pax", "num"], ["Rate (Rs.)", 1, "6500", "", "rate", "num"], ["Floor", 0, "2", "", "floor"]] },
  leads: { label: "Leads", cols: [["Name", 1, "Rita Maharjan", "", "name"], ["Phone", 1, "9815550011", "", "phone", "phone"], ["Email", 0, "rita@gmail.com", "", "email", "email"], ["Source", 0, "WhatsApp", "WhatsApp, Facebook, Walk-in, Website", "source", "enum"], ["Interested in", 0, "L-1042", "Listing code", "listing"], ["Budget (Rs.)", 0, "30000000", "", "budget", "num"], ["Stage", 0, "New", "New, Talking, Visit, Won, Lost", "stage", "enum"]] },
  invoices: { label: "Invoices", cols: [["Customer", 1, "Sita Gurung", "", "to"], ["Phone", 0, "9841010101", "", "phone", "phone"], ["PAN", 0, "301234567", "", "pan"], ["Date", 1, "2027-03-02", "YYYY-MM-DD", "date", "date"], ["Item", 1, "Room 201, 3 nights", "", "item"], ["Amount", 1, "19500", "Before VAT", "amount", "num"], ["VAT %", 0, "13", "13 or 0", "vat", "num"], ["Paid", 0, "19500", "", "paid", "num"]] },
  listings: { label: "Listings", cols: [["Title", 1, "4 BHK house for sale", "", "title"], ["Purpose", 1, "Sale", "Sale, Rent", "purpose", "enum"], ["Type", 1, "House", "House, Apartment, Land, Commercial", "type"], ["District", 1, "Kathmandu", "", "district"], ["Area", 1, "Budhanilkantha", "", "area"], ["Price (Rs.)", 1, "32000000", "", "price", "num"], ["Land (aana)", 0, "8", "", "land", "num"], ["Bedrooms", 0, "4", "", "beds", "num"]] },
  stock: { label: "Stock items", cols: [["Item", 1, "Mineral water 1L", "", "name"], ["Place", 1, "Bar", "Kitchen, Bar, Minibar, Housekeeping", "place"], ["Unit", 1, "bottle", "", "unit"], ["In stock", 1, "120", "", "qty", "num"], ["Reorder at", 0, "24", "", "min", "num"], ["Cost (Rs.)", 0, "35", "", "cost", "num"]] },
  menu: { label: "Menu items", cols: [["Item", 1, "Chicken momo (10)", "", "item"], ["Category", 1, "Nepali", "", "category"], ["Price", 1, "420", "", "price", "num"], ["VAT", 0, "Yes", "Yes, No", "vat", "enum"], ["Outlet", 0, "Lakeside Café", "", "outlet"]] },
  expenses: { label: "Expenses", cols: [["Date", 1, "2027-03-01", "YYYY-MM-DD", "at", "date"], ["What", 1, "Vegetables", "", "what"], ["Category", 1, "Food", "Salary, Utility, Food, Commission, Repair, Marketing, Rent, Tax, Other", "cat", "enum"], ["Amount", 1, "8400", "", "amount", "num"], ["Paid by", 0, "Cash", "Cash, Bank, Fonepay, Card", "by", "enum"], ["Bill no", 0, "1182", "", "bill"]] },
  buyers: { label: "Buyers", cols: [["Name", 1, "Shyam Adhikari", "", "buyer"], ["Phone", 1, "9841234500", "", "phone", "phone"], ["Unit", 1, "A-1201", "", "no"], ["Price (Rs.)", 1, "8500000", "", "price", "num"], ["Token paid", 0, "200000", "", "token", "num"], ["Citizenship no", 0, "27-01-74-01234", "", "citizenship"]] },
  instalments: { label: "Instalments", cols: [["Buyer", 1, "Shyam Adhikari", "", "who"], ["Unit", 1, "A-1201", "", "unit"], ["For", 0, "Structure 30%", "", "what"], ["Due date", 1, "2027-04-01", "YYYY-MM-DD", "due", "date"], ["Amount", 1, "850000", "", "amount", "num"], ["Status", 0, "Due", "Due, Upcoming, Overdue, Paid", "status", "enum"]] },
  investors: { label: "Investors", cols: [["Name", 1, "Anita Shrestha", "", "name"], ["City", 0, "Kathmandu", "", "city"], ["Amount (Rs.)", 1, "500000", "", "amount", "num"], ["Invested on", 1, "2027-01-20", "YYYY-MM-DD", "since", "date"], ["KYC done", 0, "Yes", "Yes, No", "kyc", "enum"]] },
  contacts: { label: "Contacts", cols: [["Name", 1, "Shyam Adhikari", "", "name"], ["Phone", 1, "9841234500", "", "phone", "phone"], ["Citizenship no", 0, "27-01-74-01234", "", "citizenship"], ["Father's name", 0, "Hari Prasad", "", "father"], ["Address", 0, "Budhanilkantha-3", "", "address"]] },
  customers: { label: "Customers", cols: [["Name", 1, "Shyam Adhikari", "", "name"], ["Phone", 1, "9841234500", "", "phone", "phone"], ["Role", 1, "Buyer", "Buyer, Seller, Landlord, Tenant, Owner, Lessor, Lessee, Guest, Investor", "role", "enum"], ["Citizenship no", 0, "27-01-74-01234", "", "citizenship"], ["District", 0, "Kathmandu", "", "district"], ["Father's name", 0, "Hari Prasad Adhikari", "", "father"], ["Grandfather's name", 0, "Tika Ram Adhikari", "", "grandfather"], ["Address", 0, "Budhanilkantha-3, Kathmandu", "", "address"]] },
  tenants: { label: "Businesses", cols: [["Business name", 1, "Bandipur Heritage Inn", "", "name"], ["Type", 1, "Hotel", "Hotel, Host, Developer, Agency, Sponsor", "type", "enum"], ["City", 1, "Tanahun", "", "city"], ["Owner", 1, "Krishna Shrestha", "", "owner"], ["Phone", 1, "9861122334", "", "phone", "phone"], ["Email", 1, "bandipurinn@gmail.com", "", "email", "email"], ["PAN", 0, "608123456", "", "pan"], ["Plan", 0, "Growth", "", "plan"]] },
  team: { label: "Team members", cols: [["Name", 0, "Sunita Karki", "", "name"], ["Email", 1, "sunita@business.com", "", "email", "email"], ["Phone", 0, "9841000000", "", "phone", "phone"], ["Role", 0, "Front desk", "Role name as shown in Roles", "role"], ["Status", 0, "Active", "Export only", "status"]] },
  agreements: { label: "Agreements", cols: [["Title", 1, "Rent agreement, 2 BHK Jhamsikhel", "", "title"], ["Type", 1, "Rent", "Baina, Rent, Lease, Commission, Reservation, Voucher, Invest", "template", "enum"], ["First party", 1, "Binod Gautam", "Name of a saved customer", "first"], ["Second party", 0, "Ankit Sharma", "Name of a saved customer", "second"], ["Amount", 1, "45000", "Per cent for commission", "amount", "num"], ["Deadline", 1, "2028-03-14", "YYYY-MM-DD", "deadline", "date"], ["Status", 0, "Draft", "Draft, Sent, Signed, Completed", "status", "enum"]] },
  reviews: { label: "Reviews", cols: [["Name", 1, "Hannah W.", "", "who"], ["Stars", 1, "5", "1 to 5", "stars", "stars"], ["Review", 1, "Lovely lake view", "", "text"], ["About", 0, "Deluxe lake view", "", "about"], ["Date", 0, "2027-02-27", "YYYY-MM-DD", "at", "date"], ["Reply", 0, "Thank you!", "", "reply"]] },
  rentals: { label: "Leases", cols: [["Tenant", 1, "Anil Shrestha", "", "tenant"], ["Phone", 1, "9812345678", "", "phone", "phone"], ["Unit", 1, "Flat 1A", "Unit name as shown in Rentals", "unit"], ["Start", 1, "2026-04-15", "YYYY-MM-DD", "start", "date"], ["End", 1, "2027-04-14", "YYYY-MM-DD", "end", "date"], ["Rent (Rs.)", 1, "45000", "", "rent", "num"], ["Deposit (Rs.)", 0, "90000", "", "deposit", "num"]] },
  blog: { label: "Blog posts", cols: [["Title", 1, "How to verify a lal purja", "", "title"], ["Slug", 0, "verify-lal-purja", "Made from the title if empty", "slug"], ["Category", 0, "Buying guide", "", "category"], ["Status", 0, "Draft", "Draft, Scheduled, Published", "status", "enum"], ["Publish on", 0, "2027-03-10", "YYYY-MM-DD", "date", "date"], ["Body", 0, "Paragraphs of the post", "", "body"], ["SEO title", 0, "", "", "seoTitle"], ["SEO description", 0, "", "", "seoDesc"]] },
  careers: { label: "Jobs", cols: [["Job title", 1, "Field photographer", "", "title"], ["Type", 1, "Full-time", "Full-time, Part-time, Contract, Internship", "type", "enum"], ["Closes on", 0, "2027-04-30", "YYYY-MM-DD", "closes", "date"], ["Status", 0, "Open", "Open, Closed", "status", "enum"], ["Applications", 0, "0", "Export only", "apps", "num"]] },
  payouts: { label: "Payouts", cols: [["Payout", 1, "PO-31", "", "id"], ["Date", 1, "2027-03-05", "YYYY-MM-DD", "date", "date"], ["Gross (Rs.)", 1, "535890", "", "gross", "num"], ["Commission (Rs.)", 1, "53590", "", "fee", "num"], ["Net (Rs.)", 1, "482300", "", "net", "num"], ["Status", 0, "Paid", "", "status"]] },
};
TEMPLATES.units = { ...TEMPLATES.rooms, label: "Units" };
TEMPLATES.staff = { ...TEMPLATES.team, label: "Staff" };

const DAY = TODAY.slice(0, 10);
const cap = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : "");
const enumOpts = (hint) => String(hint || "").split(/,\s*/).filter(Boolean);
const head = (c) => c[0];

/* ───────── CSV ───────── */
const cell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCSV = (rows) => rows.map((r) => r.map(cell).join(",")).join("\r\n");
function download(name, body) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// The template opens straight in Excel (the BOM keeps Nepali text readable). `ext` is kept for older callers.
export function downloadTemplate(kind) {
  const T = TEMPLATES[kind];
  download(`shetal-${kind}-template.csv`, toCSV([T.cols.map(([c, req]) => (req ? `${c} *` : c)), T.cols.map(([, , ex]) => ex)]));
}
export function exportCSV(kind, rows) {
  const T = TEMPLATES[kind];
  download(`shetal-${kind}-${DAY}.csv`, toCSV([T.cols.map(head), ...rows.map((r) => T.cols.map((c) => r[c[4]]))]));
}

// RFC 4180 parser. Detects comma, semicolon or tab from the header line.
export function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0] || "";
  const d = [",", ";", "\t"].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"' && f === "") q = true;
    else if (c === d) { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

function checkCell(col, raw) {
  const [h, req, , hint, , type] = col;
  const v = String(raw ?? "").trim();
  if (!v) return req ? [null, `${h} is required`] : ["", null];
  if (type === "num") { const n = Number(v.replace(/^rs\.?\s*/i, "").replace(/[,\s]/g, "")); return Number.isFinite(n) ? [n, null] : [null, `${h} must be a number`]; }
  if (type === "stars") { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? [n, null] : [null, `${h} must be 1 to 5`]; }
  if (type === "date") {
    let s = v; const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (m) s = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z")) ? [s, null] : [null, `${h}: use YYYY-MM-DD`];
  }
  if (type === "phone") return v.replace(/\D/g, "").length >= 7 ? [v, null] : [null, `${h} looks too short`];
  if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? [v.toLowerCase(), null] : [null, `${h} is not an email address`];
  if (type === "enum") { const o = enumOpts(hint).find((x) => x.toLowerCase() === v.toLowerCase()); return o ? [o, null] : [null, `${h}: use ${hint}`]; }
  return [v, null];
}
const validate = (T, raw) => {
  const val = {}, err = {};
  T.cols.forEach((c) => { const [v, e] = checkCell(c, raw[c[4]]); if (e) err[c[4]] = e; else val[c[4]] = v; });
  return { val, err, bad: Object.keys(err).length > 0 };
};

/* ───────── Where each kind lives when the page does not pass rows/onImport ───────── */
const tidOf = (db) => db.session?.tenantId;
const opsOf = (db) => db.ops?.[tidOf(db)] || emptyOps();
const ensureOps = (d) => { const tid = tidOf(d); if (!d.ops[tid]) d.ops[tid] = emptyOps(); return d.ops[tid]; };
const mkId = (p, i) => `${p}-${Date.now().toString(36).slice(-5)}${i}`;
const SRC = { shetal: "Sheetal", booking: "Booking.com", airbnb: "Airbnb", walkin: "Walk-in", direct: "Website" };
const STAGE = { new: "New", contacted: "Talking", negotiating: "Talking", viewing: "Visit", won: "Won", lost: "Lost" };
const CHANNEL = { WhatsApp: "whatsapp", Facebook: "messenger", "Walk-in": "sms", Website: "web" };
const rev = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));
const roomRow = (r) => ({ no: r.no, type: r.type, beds: r.beds || "", pax: r.pax, rate: r.rate, floor: r.floor || String(r.no).replace(/\D.*$/, "").slice(0, 1) });
const roomPut = (d, rows) => { const o = ensureOps(d); rows.forEach((r) => { const x = o.rooms.find((y) => String(y.no) === String(r.no)); if (x) Object.assign(x, { type: r.type, beds: r.beds, pax: r.pax, rate: r.rate, floor: r.floor }); else o.rooms.push({ ...r, status: "vacant", guest: null, folio: [], paid: 0, from: DAY, to: DAY, idOk: true }); }); };
const SOURCES = {
  bookings: {
    get: (db) => (opsOf(db).bookings || []).map((b) => ({ ...b, guests: b.guests || "", source: SRC[b.source] || b.source })),
    put: (d, rows) => { const o = ensureOps(d); const back = rev(SRC); rows.forEach((r, i) => o.bookings.unshift({ id: mkId("BK", i), guest: r.guest, phone: r.phone, room: r.room, type: o.rooms.find((x) => String(x.no) === String(r.room))?.type || "", from: r.from, to: r.to, guests: r.guests || 2, amount: r.amount, paid: r.paid || 0, status: "confirmed", source: back[r.source] || "walkin" })); },
  },
  rooms: { get: (db) => (opsOf(db).rooms || []).map(roomRow), put: roomPut },
  units: { get: (db) => (opsOf(db).rooms || []).map(roomRow), put: roomPut },
  guests: {
    get: (db) => { const o = opsOf(db); const seen = new Set(); return [...(o.guests || []), ...(o.bookings || []).map((b) => ({ name: b.guest, phone: b.phone }))].filter((g) => g.name && !seen.has(g.phone) && seen.add(g.phone)); },
    put: (d, rows) => { const o = ensureOps(d); o.guests = [...rows, ...(o.guests || []).filter((g) => !rows.some((r) => r.phone === g.phone))]; },
  },
  leads: {
    get: (db) => (opsOf(db).conversations || []).map((c) => ({ name: c.name, phone: c.phone || "", email: c.email || "", source: rev(CHANNEL)[c.channel] || cap(c.channel), listing: c.listing || "", budget: c.value || "", stage: STAGE[c.stage] || cap(c.stage) })),
    put: (d, rows) => { const o = ensureOps(d); const st = { New: "new", Talking: "contacted", Visit: "viewing", Won: "won", Lost: "lost" }; rows.forEach((r, i) => o.conversations.unshift({ id: mkId("c", i), channel: CHANNEL[r.source] || "web", name: r.name, phone: r.phone, email: r.email, unread: 0, last: "Imported lead", at: TODAY, stage: st[r.stage] || "new", value: r.budget || 0, listing: r.listing || "", assignee: null, tags: [], msgs: [] })); },
  },
  menu: {
    get: (db) => (opsOf(db).menu || []).flatMap((c) => c.items.map((it) => ({ item: it.name, category: cap(c.cat), price: it.price, vat: it.vat === false ? "No" : "Yes", outlet: it.outlet || "" }))),
    put: (d, rows) => { const o = ensureOps(d); rows.forEach((r, i) => { const key = r.category.toLowerCase(); let c = o.menu.find((x) => x.cat === key); if (!c) { c = { cat: key, items: [] }; o.menu.push(c); } c.items.push({ id: mkId(key, i), name: r.item, price: r.price, vat: r.vat !== "No", outlet: r.outlet }); }); },
  },
  listings: {
    get: (db) => db.listings.filter((l) => l.tenantId === tidOf(db)).map((l) => { const v = l.values || {}; const C = db.catalog; return { title: l.title, purpose: l.kind === "rentout" ? "Rent" : "Sale", type: C.categories.find((x) => x.id === v.category)?.en || "", district: C.districts.find((x) => x.id === v.location?.district)?.en || "", area: v.location?.area || "", price: l.price, land: v.landArea?.aana || "", beds: v.bedrooms || "" }; }),
    put: (d, rows) => {
      const C = d.catalog; let n = Math.max(1100, ...d.listings.map((l) => Number(String(l.id).replace(/\D/g, "")) || 0));
      rows.forEach((r) => {
        const kind = r.purpose === "Rent" ? "rentout" : "sell";
        const category = C.categories.find((x) => x.en.toLowerCase() === r.type.toLowerCase())?.id || "house";
        const district = C.districts.find((x) => x.en.toLowerCase().startsWith(r.district.toLowerCase()))?.id || "";
        const values = { category, location: { district, area: r.area }, [kind === "rentout" ? "rent" : "price"]: r.price, ...(r.beds ? { bedrooms: r.beds } : {}), ...(r.land ? { landArea: { sys: "hill", aana: r.land } } : {}), title: r.title };
        d.listings.unshift({ id: `L-${++n}`, tenantId: tidOf(d), kind, title: r.title, values, status: "draft", price: r.price, views: 0, leads: 0, updated: DAY });
      });
    },
  },
  invoices: {
    get: (db) => invoicesOf(db, tidOf(db)).map(invoiceRow),
    put: (d, rows) => { const tid = tidOf(d); d.money = d.money || {}; d.money[tid] = d.money[tid] || {}; const list = (d.money[tid].invoices = d.money[tid].invoices || invoicesOf(d, tid)); rows.forEach((r) => list.unshift(invoiceFromRow(r, list))); },
  },
  tenants: {
    get: (db) => db.tenants.map((t) => ({ ...t, type: cap(t.type), plan: db.plans.find((p) => p.id === t.planId)?.name || "" })),
    put: (d, rows) => rows.forEach((r, i) => {
      const type = r.type.toLowerCase();
      const plan = d.plans.find((p) => p.type === type && p.name.toLowerCase() === String(r.plan || "").toLowerCase()) || d.plans.find((p) => p.type === type);
      const id = mkId("t", i); const src = d.tenants.find((x) => x.type === type);
      d.tenants.push({ id, name: r.name, type, city: r.city, owner: r.owner, email: r.email, phone: r.phone, pan: r.pan, planId: plan?.id, status: "trial", since: DAY, renews: DAY, usage: { listings: 0, seats: 1, featured: 0, rooms: 0, units: 0, projects: 0, investments: 0 }, scopes: ["Head office"] });
      d.tenantRoles[id] = (src ? d.tenantRoles[src.id] || [] : []).map((x) => ({ ...x, id: `${id}-${x.key}` }));
      const owner = d.tenantRoles[id].find((x) => x.key === "owner");
      d.members[id] = owner ? [{ id: "m1", name: r.owner, email: r.email, phone: r.phone, roleId: owner.id, status: "invited", scopes: "all", twofa: false, lastActive: TODAY }] : [];
      d.invites[id] = []; d.activity[id] = [];
    }),
  },
};

// <DataActions kind="bookings" /> → Import + Export buttons for that page.
// Pages can pass `rows` (objects keyed like the template) and `onImport(rows)`; otherwise the kind's own source is used.
export function DataActions({ kind, size, onlyExport = false, rows, onImport }) {
  const toast = useToast();
  const { db, update } = useStore();
  const [open, setOpen] = useState(false);
  const T = TEMPLATES[kind];
  const src = SOURCES[kind];
  const list = rows || (src ? src.get(db) : []);
  const put = onImport || (src ? (r) => update((d) => src.put(d, r)) : null);
  const exp = () => { if (!list.length) { toast(`No ${T.label.toLowerCase()} to export yet`); return; } exportCSV(kind, list); toast(`${list.length} ${T.label.toLowerCase()} exported`); };
  return (
    <>
      {!onlyExport && put && <Button variant="outline" size={size} icon="upload" onClick={() => setOpen(true)}>Import</Button>}
      <Button variant="outline" size={size} icon="download" onClick={exp} title="CSV, opens in Excel">Export</Button>
      {put && <ImportDrawer kind={kind} open={open} onClose={() => setOpen(false)} onImport={put} />}
    </>
  );
}

const PREVIEW = 20, SHOW_BAD = 50, MAX_ROWS = 10000;
export function ImportDrawer({ kind, open, onClose, onImport }) {
  const toast = useToast();
  const { update } = useStore();
  const T = TEMPLATES[kind];
  const put = onImport || (SOURCES[kind] ? (r) => update((d) => SOURCES[kind].put(d, r)) : null);
  const [file, setFile] = useState(null);
  const [fail, setFail] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [skip, setSkip] = useState({});

  const reset = () => { setFile(null); setFail(null); setParsed(null); setSkip({}); };
  const close = () => { reset(); onClose(); };
  const pick = async (f) => {
    if (!f) return;
    reset(); setFile(f.name);
    const buf = new Uint8Array(await f.arrayBuffer());
    const zip = buf[0] === 0x50 && buf[1] === 0x4b; const ole = buf[0] === 0xd0 && buf[1] === 0xcf;
    if (zip || ole) { setFail({ excel: true }); return; }
    const table = parseCSV(new TextDecoder("utf-8").decode(buf));
    if (table.length < 2) { setFail({ msg: "The file has no rows under the header." }); return; }
    if (table.length - 1 > MAX_ROWS) { setFail({ msg: `The file has ${(table.length - 1).toLocaleString("en-IN")} rows. Split it into files of up to ${MAX_ROWS.toLocaleString("en-IN")} rows.` }); return; }
    const norm = (s) => String(s).replace(/\*/g, "").trim().toLowerCase();
    const idx = Object.fromEntries(T.cols.map((c) => [c[4], table[0].findIndex((h) => norm(h) === norm(c[0]))]));
    const missing = T.cols.filter((c) => c[1] && idx[c[4]] < 0).map(head);
    if (missing.length) { setFail({ msg: `These required columns are missing: ${missing.join(", ")}. Start from the template so the headers match.` }); return; }
    const extra = table[0].filter((h) => h.trim() && !T.cols.some((c) => norm(c[0]) === norm(h)));
    const example = T.cols.map((c) => String(c[2]));
    const body = table.slice(1).map((r, i) => ({ n: i + 2, raw: Object.fromEntries(T.cols.map((c) => [c[4], idx[c[4]] >= 0 ? r[idx[c[4]]] ?? "" : ""])) }))
      .filter((r) => !T.cols.every((c, k) => String(r.raw[c[4]]).trim() === example[k] || (!c[1] && !String(r.raw[c[4]]).trim())));
    if (!body.length) { setFail({ msg: "Only the example row was found. Add your own rows under the header." }); return; }
    setParsed({ rows: body, matched: T.cols.filter((c) => idx[c[4]] >= 0).map(head), absent: T.cols.filter((c) => idx[c[4]] < 0).map(head), extra });
  };

  const checked = useMemo(() => (parsed ? parsed.rows.map((r) => ({ ...r, ...validate(T, r.raw) })) : []), [parsed, T]);
  const bad = checked.filter((r) => r.bad);
  const open_ = bad.filter((r) => !skip[r.n]);
  const ready = checked.filter((r) => !r.bad && !skip[r.n]);
  const fix = (n, key, v) => setParsed((p) => ({ ...p, rows: p.rows.map((r) => (r.n === n ? { ...r, raw: { ...r.raw, [key]: v } } : r)) }));
  const go = () => { put(ready.map((r) => r.val)); toast(`${ready.length} ${T.label.toLowerCase()} imported`); close(); };

  return (
    <Drawer open={open} onClose={close} title={`Import ${T.label.toLowerCase()}`} sub="From a CSV file. Start from the template so the columns match."
      footer={parsed ? <><Button variant="ghost" onClick={reset}>Choose another file</Button>
        <Button icon="upload" disabled={!put || !ready.length || open_.length > 0} onClick={go}>{open_.length ? `Fix or skip ${open_.length} ${open_.length === 1 ? "row" : "rows"}` : `Import ${ready.length} ${ready.length === 1 ? "row" : "rows"}`}</Button></>
        : <Button variant="ghost" onClick={close}>Close</Button>}>
      {!parsed ? <div className="pf-stack">
        <div className="pf-imp-step"><b>1</b><div className="pf-stack tight" style={{ flex: 1, minWidth: 0 }}>
          <span className="pf-strong">Download the {T.label.toLowerCase()} template</span>
          <span className="small muted">One row per {T.label.toLowerCase().replace(/s$/, "")}. Columns with * are required. Keep the first row as it is.</span>
          <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}><Button size="sm" variant="outline" icon="file-spreadsheet" onClick={() => downloadTemplate(kind)}>Download template</Button></div>
        </div></div>
        <div className="pf-imp-cols">
          {T.cols.map(([c, req, ex, hint]) => (
            <div key={c} className="pf-imp-col"><span className="pf-two"><b>{c}{req ? <span className="pf-req" aria-label="required"> *</span> : null}</b><small>{hint || `e.g. ${ex}`}</small></span>{req ? <Badge tone="action">Required</Badge> : <span className="small muted">Optional</span>}</div>
          ))}
        </div>
        <div className="pf-imp-step"><b>2</b><div className="pf-stack tight" style={{ flex: 1, minWidth: 0 }}>
          <span className="pf-strong">Fill it in and upload</span>
          <label className="drop pf-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
            <input type="file" accept=".csv,.txt,.xlsx,.xls" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ""; }} />
            <Icon name="upload" size={24} /><b>Drop the file or click to choose</b><span className="small muted">CSV, up to {MAX_ROWS.toLocaleString("en-IN")} rows</span>
          </label>
          {fail && <div className="pf-note pf-imp-fail"><Icon name="circle-alert" size={16} /><span><b>{file}</b>: {fail.excel ? <>this is an Excel workbook. In Excel choose <b>File › Save as</b>, pick <b>CSV UTF-8 (.csv)</b>, then upload that file.</> : fail.msg}</span></div>}
        </div></div>
      </div> : <div className="pf-stack">
        <div className="pf-note"><Icon name="file-spreadsheet" size={16} /><span><b>{file}</b>: {checked.length} {checked.length === 1 ? "row" : "rows"}. {ready.length} ready{bad.length ? `, ${bad.length} need a fix` : ""}{Object.keys(skip).filter((k) => skip[k]).length ? `, ${Object.keys(skip).filter((k) => skip[k]).length} skipped` : ""}.</span></div>
        <div className="pf-chips pf-imp-chips">
          {parsed.matched.map((c) => <span key={c} className="pf-imp-chip on"><Icon name="check" size={13} />{c}</span>)}
          {parsed.absent.map((c) => <span key={c} className="pf-imp-chip">{c} · not in file</span>)}
          {parsed.extra.map((c) => <span key={c} className="pf-imp-chip off">{c} · ignored</span>)}
        </div>
        <div className="pf-table-wrap pf-imp-preview">
          <table className="table pf-table" style={{ minWidth: Math.max(520, T.cols.length * 120) }}>
            <thead><tr><th style={{ width: 52 }}>Row</th>{T.cols.map((c) => <th key={c[4]}>{c[0]}</th>)}</tr></thead>
            <tbody>{checked.slice(0, PREVIEW).map((r) => (
              <tr key={r.n} className={skip[r.n] ? "pf-imp-skip" : undefined}>
                <td className="tnum">{r.n}</td>
                {T.cols.map((c) => <td key={c[4]} className={r.err[c[4]] ? "pf-imp-bad" : undefined} title={r.err[c[4]] || undefined}>{String(r.raw[c[4]] ?? "") || <span className="muted">—</span>}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
        {checked.length > PREVIEW && <span className="small muted">Showing the first {PREVIEW} of {checked.length} rows.</span>}
        {bad.length > 0 && <section className="pf-stack tight">
          <div className="pf-imp-bad-head"><b>Rows that need a fix</b><Button size="sm" variant="ghost" onClick={() => setSkip(Object.fromEntries(bad.map((r) => [r.n, true])))}>Skip all {bad.length}</Button></div>
          {bad.slice(0, SHOW_BAD).map((r) => (
            <div key={r.n} className={`pf-imp-fix ${skip[r.n] ? "off" : ""}`}>
              <div className="pf-imp-fix-head"><b className="tnum">Row {r.n}</b><Checkbox label="Skip this row" checked={!!skip[r.n]} onChange={(v) => setSkip((s) => ({ ...s, [r.n]: v }))} /></div>
              {!skip[r.n] && <div className="pf-imp-fix-grid">{Object.keys(r.err).map((k) => { const c = T.cols.find((x) => x[4] === k); return (
                <label key={k} className="field"><span className="small">{c[0]}</span><Input value={r.raw[k] ?? ""} placeholder={c[3] || String(c[2])} onChange={(e) => fix(r.n, k, e.target.value)} aria-invalid="true" /><span className="pf-error"><Icon name="circle-alert" size={14} />{r.err[k]}</span></label>
              ); })}</div>}
            </div>
          ))}
          {bad.length > SHOW_BAD && <span className="small muted">{bad.length - SHOW_BAD} more rows need a fix. Skip them, or correct the file and upload it again.</span>}
        </section>}
      </div>}
    </Drawer>
  );
}
