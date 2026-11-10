// An agreement as a printable page: the filled text in one language, the signatures, and (once everyone has signed)
// the signing record. English and Nepali copies are separate documents, each entirely in its own language.
// Where it fits: Business → Agreements (preview and print) and the website's signing page (/sign/<token>).
// How it works: agreementHtml(doc, lang) returns a whole HTML page, shown in an <iframe> on screen; printAgreement()
// prints every language of the agreement one after the other (the browser's print dialog can save it as a PDF).
// Rules: the text is shown exactly as sent; nothing here changes it. ⟦…⟧ marks a value still to fill in (drafts only).

const L = {
  en: {
    ref: "Agreement no.", signatures: "Signatures", signedOn: "Signed electronically", notSigned: "Not signed yet", record: "Signing record",
    recordNote: "Each person confirmed it was them with a one-time code sent to their email, then typed their name to sign.",
    email: "Email", time: "Signed (Nepal time)", ip: "IP address", method: "Method", methodVal: "Code sent by email", typed: "Name typed",
    hash: "Fingerprint of the signed text (SHA-256)", draft: "Draft: not sent for signing yet", waiting: "Waiting for signatures", cancelled: "Cancelled",
    foot: "Signed through Sheetal Property",
  },
  ne: {
    ref: "सम्झौता नं.", signatures: "हस्ताक्षर", signedOn: "विद्युतीय रूपमा हस्ताक्षर गरिएको", notSigned: "हस्ताक्षर बाँकी", record: "हस्ताक्षर विवरण",
    recordNote: "प्रत्येक व्यक्तिले आफ्नो इमेलमा पठाइएको एक पटक मात्र चल्ने कोड हालेर आफू नै भएको पुष्टि गर्नुभयो र आफ्नो नाम लेखेर हस्ताक्षर गर्नुभयो।",
    email: "इमेल", time: "हस्ताक्षर समय (नेपाल)", ip: "आईपी ठेगाना", method: "तरिका", methodVal: "इमेलमा पठाइएको कोड", typed: "लेखिएको नाम",
    hash: "हस्ताक्षर गरिएको पाठको पहिचान (SHA-256)", draft: "मस्यौदा: हस्ताक्षरका लागि पठाइएको छैन", waiting: "हस्ताक्षर हुन बाँकी", cancelled: "रद्द गरिएको",
    foot: "शीतल प्रोपर्टीमार्फत हस्ताक्षर गरिएको",
  },
};
const DEV = "०१२३४५६७८९";
const neDigits = (s) => String(s ?? "").replace(/\d/g, (d) => DEV[Number(d)]);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s) => esc(s).replace(/⟦([^⟧]*)⟧/g, '<mark>$1</mark>');

function bodyHtml(text) {
  return String(text || "").replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
    if (p.startsWith("# ")) return `<h1>${inline(p.slice(2))}</h1>`;
    return `<p>${p.split("\n").map(inline).join("<br>")}</p>`;
  }).join("\n");
}

const STYLE = `
  @page { size: A4; margin: 18mm 18mm 20mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #1d1c1a; }
  body { font-family: "Noto Serif", "Noto Serif Devanagari", Georgia, serif; font-size: 15px; line-height: 1.65; }
  .ne { font-family: "Noto Serif Devanagari", "Noto Serif", serif; font-size: 16px; line-height: 1.8; }
  .sheet { max-width: 760px; margin: 0 auto; padding: 36px 40px 40px; }
  .top { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; border-bottom: 1px solid #cfcac2; padding-bottom: 10px; margin-bottom: 22px; font-size: 13px; color: #55524c; }
  .top b { color: #1d1c1a; font-weight: 600; }
  .state { margin: 0 0 20px; padding: 8px 12px; border: 1px solid #b68235; border-radius: 4px; color: #6b4a17; font-size: 13px; }
  h1 { font-size: 24px; font-weight: 600; line-height: 1.3; margin: 0 0 18px; text-align: center; }
  p { margin: 0 0 12px; text-align: justify; hyphens: auto; }
  mark { background: none; color: #8a5a12; border-bottom: 1px dashed #b68235; padding: 0 2px; }
  h2 { font-size: 16px; font-weight: 600; margin: 30px 0 12px; padding-top: 12px; border-top: 1px solid #cfcac2; }
  .signs { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px 28px; }
  .sign { border-top: 1px solid #1d1c1a; padding-top: 6px; font-size: 13px; line-height: 1.5; break-inside: avoid; }
  .sign .who { font-size: 15px; font-weight: 600; }
  .sign .ok { color: #2f5d34; }
  .sign .no { color: #8a5a12; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; line-height: 1.5; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid #e3dfd8; }
  th { font-weight: 600; color: #55524c; }
  .note { font-size: 12.5px; color: #55524c; margin: 0 0 10px; text-align: left; }
  .hash { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; word-break: break-all; }
  .record { break-before: page; }
  .foot { margin-top: 28px; font-size: 11.5px; color: #77736b; text-align: center; }
  @media print { .sheet { padding: 0; max-width: none; } .state { display: none; } }
`;
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif:wght@400;600&family=Noto+Serif+Devanagari:wght@400;600&display=swap">';

/** One copy (en or ne) as the inside of a page. */
function copyHtml(doc, lang) {
  const t = L[lang];
  const num = (s) => (lang === "ne" ? neDigits(s) : String(s ?? ""));
  const nameOf = (s) => (lang === "ne" ? s.nameNe || s.name : s.name);
  const done = doc.status === "signed";
  const state = doc.status === "draft" ? t.draft : doc.status === "cancelled" ? t.cancelled : doc.status === "sent" ? t.waiting : "";
  const time = (s) => (s.signedTime ? (lang === "ne" ? neDigits(s.signedTime).replace("(NPT)", "") : s.signedTime.replace(" (NPT)", "")) : "");
  const signs = (doc.signers || []).map((s) => `
    <div class="sign"><div class="who">${esc(nameOf(s))}</div><div>${esc(s.roleLabel?.[lang] ?? s.role)}</div>
      ${s.status === "signed" ? `<div class="ok">${t.signedOn}${time(s) ? `: ${esc(time(s))}` : ""}</div>` : `<div class="no">${t.notSigned}</div>`}</div>`).join("");
  const record = done ? `
    <section class="record"><h2>${t.record}: ${esc(num(doc.ref))}</h2>
      <p class="note">${t.recordNote}</p>
      <table><thead><tr><th>${t.signatures}</th><th>${t.email}</th><th>${t.time}</th><th>${t.ip}</th><th>${t.typed}</th></tr></thead><tbody>
      ${(doc.signers || []).map((s) => `<tr><td>${esc(nameOf(s))}<br><small>${esc(s.roleLabel?.[lang] ?? s.role)}</small></td><td>${esc(s.email || "")}</td><td>${esc(time(s))}</td><td>${esc(num(s.ip || ""))}</td><td>${esc(s.signedName || "")}</td></tr>`).join("")}
      </tbody></table>
      <p class="note" style="margin-top:10px">${t.method}: ${t.methodVal}</p>
      <p class="note">${t.hash}:<br><span class="hash">${esc(doc.hash || "")}</span></p>
    </section>` : "";
  return `<div class="sheet" lang="${lang}">
    <div class="top"><span><b>${esc(doc.business?.name || "")}</b></span><span>${t.ref} <b>${esc(num(doc.ref))}</b></span></div>
    ${state ? `<div class="state">${state}</div>` : ""}
    ${bodyHtml(doc.texts?.[lang])}
    <h2>${t.signatures}</h2><div class="signs">${signs}</div>
    ${record}
    ${done ? `<div class="foot">${t.foot}</div>` : ""}
  </div>`;
}

/** A whole HTML page with one language's copy (or several, each starting on a new page). */
export function agreementHtml(doc, langs) {
  const list = (Array.isArray(langs) ? langs : [langs]).filter((l) => doc.texts?.[l] != null);
  const one = list.length === 1 ? list[0] : "en";
  return `<!doctype html><html lang="${one}"><head><meta charset="utf-8"><title>${esc(doc.ref)} ${esc(doc.title)}</title>${FONTS}<style>${STYLE}</style></head>
<body class="${one === "ne" ? "ne" : ""}">${list.map((l, i) => `<div style="${i ? "break-before:page" : ""}" class="${l === "ne" ? "ne" : ""}">${copyHtml(doc, l)}</div>`).join("")}</body></html>`;
}

/** The languages an agreement has, in print order. */
export const docLangs = (doc) => ["en", "ne"].filter((l) => doc.texts?.[l] != null);

/** Prints the agreement (every language) through a hidden frame; the print dialog can save it as a PDF. */
export function printAgreement(doc, langs = docLangs(doc)) {
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(f);
  f.srcdoc = agreementHtml(doc, langs);
  f.onload = () => {
    const w = f.contentWindow;
    const go = () => { w.focus(); w.print(); setTimeout(() => f.remove(), 60_000); };
    (w.document.fonts?.ready ?? Promise.resolve()).then(go, go);
  };
}
