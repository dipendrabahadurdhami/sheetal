import { useEffect, useMemo, useState } from "react";
import { recordPayment } from "@sheetal/shared/core/store";
import { Link, useParams } from "react-router-dom";
import { Landmark, Scale, KeyRound, Wallet, FileCheck2, ShieldCheck, Gavel, FileSearch, Users, Wrench, Receipt, Building2, QrCode, Upload, Check, ChevronRight } from "lucide-react";
import { api } from "../api/endpoints";
import { useApp } from "../context/AppContext";
import { PageHead, SectionHead } from "../components/ui";
import { fmtFull, fmtPrice } from "../utils/format";
import { useSEO } from "../utils/seo";

const BANKS = [["nabil", "Nabil Bank"], ["nic", "NIC Asia"], ["global", "Global IME"], ["laxmi", "Laxmi Sunrise"], ["nibl", "NIMB"], ["mega", "Mega Bank"], ["nepal", "Nepal Bank"]];

export function Enquiry({ service, fields = [], title = "Request a call", cta = "Send request", preset }) {
  const { user, toast } = useApp();
  const [f, setF] = useState({ name: user?.user_name || "", phone: user?.phone || "", email: user?.email || "", message: "", ...Object.fromEntries(fields.map(([k]) => [k, ""])) });
  const [done, setDone] = useState(false);
  useEffect(() => { if (preset) setF((p) => ({ ...p, ...preset })); }, [preset]);
  const submit = async (e) => {
    e.preventDefault();
    const extra = fields.map(([k, l]) => `${l}: ${f[k]}`).join(" | ");
    try {
      await api.contactAgent({ agent_id: null, name: f.name, email: f.email, phone: f.phone, contact_form: `Service: ${service} | Phone: ${f.phone} | ${extra} | Message: ${f.message}`, terms_agrement: "yes" });
      setDone(true); toast("Request sent. Our team will call you.");
    } catch (x) { toast(x.message || "Could not send"); }
  };
  if (done) return <div className="card card-pad stack" style={{ gap: 10 }}><Check size={28} color="var(--c-red)" /><h3>Request received</h3><p className="muted small">A specialist will call you within one working day.</p><button className="btn btn-outline btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setDone(false)}>Send another</button></div>;
  return (
    <form className="card card-pad stack" onSubmit={submit}>
      <h3>{title}</h3>
      <input className="input" placeholder="Full name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input" type="tel" placeholder="Phone" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <input className="input" type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      {fields.length > 0 && <div className="form-grid">{fields.map(([k, l, t = "text", opts], i) => {
        const lone = fields.length % 2 === 1 && i === fields.length - 1;
        const span = lone ? { gridColumn: "1 / -1" } : undefined;
        return opts
          ? <select key={k} className="select" style={span} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}><option value="">{l}</option>{opts.map((o) => <option key={o}>{o}</option>)}</select>
          : <input key={k} className="input" style={span} type={t} placeholder={l} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />;
      })}</div>}
      <textarea className="textarea" placeholder="Message (optional)" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} style={{ minHeight: 84 }} />
      <button className="btn btn-primary">{cta}</button>
    </form>
  );
}

/* One sticky offset shared by the back link and the side form. Raise it if they hide under the header. */
const STICKY_TOP = 96;

const tileLink = { display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", color: "inherit", textDecoration: "none" };

export const Points = ({ items }) => (
  <div className="grid-3">{items.map(([I, t, d, to]) => {
    const body = (
      <>
        <I size={24} strokeWidth={1.5} color="var(--c-red)" /><h4>{t}</h4><p className="small muted">{d}</p>
        {to && <span className="small" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent-ink)", fontWeight: 500 }}>See details <ChevronRight size={14} /></span>}
      </>
    );
    return (
      <div key={t} className="stack" style={{ gap: 10, borderTop: "2px solid var(--line-strong)", paddingTop: 18 }}>
        {to ? <Link to={to} style={tileLink}>{body}</Link> : body}
      </div>
    );
  })}</div>
);

/* Detail copy for each legal service. General guide: have your partner lawyer confirm the wording. */
const LEGAL = {
  "Document check": {
    slug: "document-check", icon: FileSearch, summary: "Lal purja, tiraro, char killa and trace map verified against Malpot records.",
    topic: "Document check",
    what: "A lawyer reads your land papers and compares them with the official record at the Malpot (land revenue) office, so you know the seller really owns what they are selling.",
    when: "Before you pay any advance or sign an agreement to buy land or a house.",
    steps: [
      ["Collect your papers", "You share copies of the lal purja, tiraro, trace map and the seller's citizenship."],
      ["Verify the lal purja", "The lawyer confirms the certificate is genuine and in the seller's name."],
      ["Match with Malpot record", "Details are compared with the official record at the land revenue office."],
      ["Check tiraro receipts", "Land tax receipts are checked to make sure taxes are paid up to date."],
      ["Compare boundaries", "Char killa and trace map are matched with the actual plot and its area."],
      ["Written summary", "You receive a short report on what was found and whether to go ahead."],
    ],
    docs: ["Copy of the lal purja", "Latest tiraro receipt", "Trace map and char killa", "Seller's citizenship copy"],
  },
  "Dispute check": {
    slug: "dispute-check", icon: ShieldCheck, summary: "Court cases, bank mortgage and guthi status checked before you pay.",
    topic: "Dispute",
    what: "A check for hidden problems on the land or house that could stop the sale or cost you money later.",
    when: "Before you pay, especially if the property has a loan against it or a long family history.",
    steps: [
      ["Share plot details", "Give us the kitta number, location and the lal purja copy."],
      ["Search court cases", "We look for any case, claim or order registered on the property."],
      ["Check bank mortgage", "We confirm whether a loan or mortgage is registered against it."],
      ["Check guthi status", "We find out if it is guthi land, which has special rules on sale."],
      ["Check ownership history", "Earlier sales and family claims are reviewed for hidden problems."],
      ["Clear advice", "The lawyer tells you plainly if it is safe to pay and what to do next."],
    ],
    docs: ["Copy of the lal purja", "Plot (kitta) number and location", "Seller's citizenship copy", "Any earlier sale or loan papers"],
  },
  "Deed transfer": {
    slug: "deed-transfer", icon: Gavel, summary: "Rajinama drafting and registration with the land revenue office.",
    topic: "Deed transfer",
    what: "The legal step that moves land or a house from the seller's name into yours. It is done with a rajinama (transfer deed) registered at the land revenue office.",
    when: "After you and the seller agree on the price and the property checks are clear.",
    steps: [
      ["Review the papers", "We check the property is clear and ready to be transferred."],
      ["Agree the terms", "Price, payment schedule and date are written down for both sides."],
      ["Draft the rajinama", "The lawyer prepares the transfer deed for buyer and seller."],
      ["Pay tax and fees", "We calculate and arrange registration fees and any tax clearance."],
      ["Register at the office", "We go with you to the land revenue office to sign and register."],
      ["Get your lal purja", "We follow up until the new lal purja is issued in your name."],
    ],
    docs: ["Citizenship of buyer and seller", "Original lal purja", "Latest tiraro or tax clearance", "Trace map and passport photos"],
  },
  "Naksa & approvals": {
    slug: "naksa-approvals", icon: FileCheck2, summary: "Blue print, building permit and completion certificate review.",
    topic: "Naksa & approvals",
    what: "A review of the building itself: the approved drawing (naksa), the building permit and the completion certificate from the municipality.",
    when: "When buying a built house, building a new one, or adding floors.",
    steps: [
      ["Collect the drawings", "You share the blue print, naksa pass and lal purja copy."],
      ["Match plan to building", "We check the approved drawing against what is actually built."],
      ["Confirm the permit", "We verify the building permit was issued by the municipality."],
      ["Review the certificate", "The completion certificate is checked, or we explain how to get it."],
      ["Find unapproved work", "Extra floors or changes made without approval are pointed out."],
      ["Next steps", "You get a clear list of what to fix, regularise or apply for."],
    ],
    docs: ["Blue print / naksa pass", "Building permit", "Completion certificate, if issued", "Copy of the lal purja"],
  },
  "Rental agreements": {
    slug: "rental-agreements", icon: Scale, summary: "Clear lease contracts that protect owners and tenants.",
    topic: "Rental agreement",
    what: "A written lease between owner and tenant that sets out the rent, deposit, length of stay and what each side must do.",
    when: "Before a tenant moves in, or when you renew or change the terms.",
    steps: [
      ["Understand your case", "We note who is renting, the property and the main terms."],
      ["Set rent and deposit", "Monthly rent, yearly increase and deposit amount are written clearly."],
      ["Fix the duration", "Lease length, renewal and notice period are agreed."],
      ["Divide responsibilities", "Repairs, utilities and house rules are split between owner and tenant."],
      ["Draft the lease", "The lawyer writes a clear agreement in simple language."],
      ["Review and sign", "We go through it with both sides, then you sign and keep copies."],
    ],
    docs: ["Citizenship copies of owner and tenant", "Proof of ownership", "Agreed rent and deposit", "Move-in date and lease length"],
  },
  "Inheritance & partition": {
    slug: "inheritance-partition", icon: Users, summary: "Name transfer (naamsari) and family partition (anshabanda).",
    topic: "Inheritance",
    what: "Moving property into family members' names after a death (naamsari), or dividing shared family land between heirs (anshabanda).",
    when: "After a family member dies, or when relatives want to split land they own together.",
    steps: [
      ["Confirm legal heirs", "We establish who the rightful heirs are from the family papers."],
      ["Collect documents", "Death certificate, relationship papers and citizenship of all heirs."],
      ["Get family consent", "Written agreement from family members on who gets what."],
      ["Prepare the application", "The naamsari or anshabanda application is drafted."],
      ["File at the land office", "Everything is submitted to the land revenue office."],
      ["Follow up to completion", "We follow up until the new lal purja is issued."],
    ],
    docs: ["Death certificate, if inheritance", "Citizenship and relationship papers of all heirs", "Lal purja of the property", "Written consent from the family members"],
  },
};

export function HomeLoan({ apply }) {
  useSEO(apply ? "Apply for a home loan" : "Home loan", "Compare home loan offers from Nepali banks and apply online.");
  const [P, setP] = useState(6000000), [y, setY] = useState(15), [r, setR] = useState(10.5);
  const m = r / 1200, n = y * 12, emi = (P * m * (1 + m) ** n) / ((1 + m) ** n - 1);
  return (
    <>
      <div className="tools-hero services-hero"><PageHead crumbs={[{ label: "Services", to: "/services" }, { label: apply ? "Apply online" : "Home loan" }]} title={apply ? "Apply for a home loan online" : "Home loan"}>
        We compare offers from partner banks, prepare your file and follow up until approval.
      </PageHead></div>
      <div className="container section-sm detail-layout" style={{ marginTop: 0 }}>
        <div className="stack" style={{ gap: 48 }}>
          {!apply && <>
            <section><SectionHead title="How it works" />
              <div className="steps-num">
                <div><h4>Check eligibility</h4><p className="small muted">Share income, job and the property you like.</p></div>
                <div><h4>Compare offers</h4><p className="small muted">We collect rates and fees from partner banks.</p></div>
                <div><h4>Choose your bank</h4><p className="small muted">Pick the offer that fits you and we submit your application.</p></div>
                <div><h4>Valuation & papers</h4><p className="small muted">Bank valuation, lal purja and income documents.</p></div>
                <div><h4>Approval</h4><p className="small muted">The bank reviews your file and issues the offer letter.</p></div>
                <div><h4>Funds released</h4><p className="small muted">Sign the offer letter and the loan is released.</p></div>
              </div>
            </section>
            <section><SectionHead title="Partner banks" /><div className="logo-row" style={{ gridTemplateColumns: `repeat(${BANKS.length}, minmax(72px, 1fr))`, gap: 8, overflowX: "auto" }}>{BANKS.map(([k, n]) => <div key={k} title={n} style={{ height: 56, padding: 8 }}><img src={`/banks/${k}.png`} alt={n} style={{ maxHeight: 30, maxWidth: "100%" }} /></div>)}</div></section>
          </>}
          <section className="card card-pad stack" style={{ gap: 20 }}>
            <h3>Quick EMI estimate</h3>
            <div className="field"><div className="row between"><label>Loan amount</label><b className="tnum">{fmtPrice(P)}</b></div><input className="range" type="range" min={500000} max={30000000} step={100000} value={P} onChange={(e) => setP(+e.target.value)} /></div>
            <div className="field"><div className="row between"><label>Tenure</label><b className="tnum">{y} years</b></div><input className="range" type="range" min={1} max={30} value={y} onChange={(e) => setY(+e.target.value)} /></div>
            <div className="row between"><span className="row muted small" style={{ gap: 8 }}>
              Monthly EMI at
              <button type="button" aria-label="Decrease interest rate" style={{ width: 28, height: 28, padding: 0, border: "1px solid var(--line-strong)", borderRadius: "var(--r)", background: "var(--card)", color: "var(--text-strong)", fontSize: 16, lineHeight: 1, cursor: "pointer" }} onClick={() => setR((v) => Math.max(5, +(v - 0.25).toFixed(2)))}>−</button>
              <b className="tnum" style={{ minWidth: 48, textAlign: "center", color: "var(--text-strong)" }}>{r}%</b>
              <button type="button" aria-label="Increase interest rate" style={{ width: 28, height: 28, padding: 0, border: "1px solid var(--line-strong)", borderRadius: "var(--r)", background: "var(--card)", color: "var(--text-strong)", fontSize: 16, lineHeight: 1, cursor: "pointer" }} onClick={() => setR((v) => Math.min(20, +(v + 0.25).toFixed(2)))}>+</button>
            </span><span className="price-big tnum">{fmtFull(Math.round(emi))}</span></div>
            <Link to="/tools/emi" className="link small">Full EMI calculator</Link>
          </section>
          {!apply && <section><SectionHead title="Documents you'll need" />
            <ul className="prose" style={{ columns: 2, columnGap: 32 }}><li>Citizenship copy</li><li>Passport photos</li><li>Salary certificate or business PAN</li><li>Last 6 months bank statement</li><li>Lal purja of the property</li><li>Blue print / naksa pass</li><li>Tax clearance</li><li>Char killa and trace map</li></ul>
          </section>}
        </div>
        <aside style={{ alignSelf: "stretch" }}><div className="sticky-card" style={{ boxShadow: "none" }}>
          <Enquiry service="Home loan application" title={apply ? "Your application" : "Apply online"} cta="Submit application"
            fields={[["loan_amount", "Loan amount (Rs.)", "number"], ["income", "Monthly income (Rs.)", "number"], ["employment", "Employment", "text", ["Salaried", "Business", "Foreign employment", "Other"]], ["bank", "Preferred bank", "text", BANKS.map(([, n]) => n)]]} />
        </div></aside>
      </div>
    </>
  );
}

export function LegalHelp() {
  useSEO("Legal help", "Property document checks, deed transfer and legal support in Nepal.");
  return (
    <>
      <div className="tools-hero services-hero"><PageHead crumbs={[{ label: "Services", to: "/services" }, { label: "Legal help" }]} title="Legal help for property">Partner lawyers check ownership and handle transfer at the Malpot office.</PageHead></div>
      <div className="container section-sm detail-layout" style={{ marginTop: 0 }}>
        <div className="stack" style={{ gap: 40 }}>
          <Points items={[[FileSearch, "Document check", "Lal purja, tiraro, char killa and trace map verified against Malpot records.", "/services/legal-help/document-check"], [ShieldCheck, "Dispute check", "Court cases, bank mortgage and guthi status checked before you pay.", "/services/legal-help/dispute-check"], [Gavel, "Deed transfer", "Rajinama drafting and registration with the land revenue office.", "/services/legal-help/deed-transfer"], [FileCheck2, "Naksa & approvals", "Blue print, building permit and completion certificate review.", "/services/legal-help/naksa-approvals"], [Scale, "Rental agreements", "Clear lease contracts that protect owners and tenants.", "/services/legal-help/rental-agreements"], [Users, "Inheritance & partition", "Name transfer (naamsari) and family partition (anshabanda).", "/services/legal-help/inheritance-partition"]]} />
          <section><SectionHead title="How it works" />
            <div className="steps-num">
              <div><h4>1. Tell us your case</h4><p className="small muted">Pick a topic and send your question with the plot number or location.</p></div>
              <div><h4>2. Share your papers</h4><p className="small muted">Send copies of the lal purja, citizenship and any earlier papers.</p></div>
              <div><h4>3. Lawyer reviews</h4><p className="small muted">A partner lawyer reads the papers and checks the official record.</p></div>
              <div><h4>4. Clear answer</h4><p className="small muted">You get a plain explanation by phone or email, usually within one day.</p></div>
              <div><h4>5. Next steps agreed</h4><p className="small muted">We explain the fees, the time needed and what you must do.</p></div>
              <div><h4>6. We handle the work</h4><p className="small muted">The lawyer drafts, files and follows up at the land revenue office.</p></div>
            </div>
          </section>
          <section><SectionHead title="Good to know before you pay" />
            <ul className="prose" style={{ columns: 2, columnGap: 32 }}>
              <li>Never pay an advance before the documents are checked</li>
              <li>Make sure the lal purja is in the seller's own name</li>
              <li>Ask for the latest tiraro (land tax) receipt</li>
              <li>Check for a bank mortgage or guthi status</li>
              <li>Match the plot with the trace map on site</li>
              <li>Keep a written record of every payment</li>
            </ul>
          </section>
        </div>
        <aside style={{ alignSelf: "stretch" }}><div className="sticky-card" style={{ boxShadow: "none" }}><Enquiry service="Legal help" title="Ask a question" fields={[["topic", "Topic", "text", ["Document check", "Dispute", "Deed transfer", "Naksa & approvals", "Rental agreement", "Inheritance", "Other"]]]} /></div></aside>
      </div>
    </>
  );
}

export function LegalService() {
  const { slug } = useParams();
  const key = Object.keys(LEGAL).find((k) => LEGAL[k].slug === slug);
  const v = key && LEGAL[key];
  const preset = useMemo(() => (v ? { topic: v.topic } : null), [v]);
  useSEO(key || "Legal help", v ? v.summary : "Property legal support in Nepal.");
  if (!v) return <div className="container section stack"><h2>Service not found</h2><Link to="/services/legal-help" className="link">See all legal services</Link></div>;
  return (
    <>
      <div className="tools-hero services-hero"><PageHead crumbs={[{ label: "Services", to: "/services" }, { label: "Legal help", to: "/services/legal-help" }, { label: key }]} title={key}>{v.summary}</PageHead></div>
      <div className="container section-sm detail-layout" style={{ marginTop: 0 }}>
        <div className="stack" style={{ gap: 48 }}>
          <section><SectionHead title="What it is" /><p>{v.what}</p></section>
          <section><SectionHead title="When you need it" /><p>{v.when}</p></section>
          <section><SectionHead title="What we do" />
            <div className="steps-num">{v.steps.map(([t, d], i) => <div key={t}><h4>{i + 1}. {t}</h4><p className="small muted">{d}</p></div>)}</div>
          </section>
          <section><SectionHead title="Documents you'll need" />
            <ul className="prose" style={{ columns: 2, columnGap: 32 }}>{v.docs.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
          <section><SectionHead title="Other legal services" />
            <div className="row" style={{ gap: 8, flexWrap: "nowrap", overflowX: "auto" }}>{Object.keys(LEGAL).filter((k) => k !== key).map((k) => <Link key={k} to={`/services/legal-help/${LEGAL[k].slug}`} className="chip" style={{ flex: "1 1 auto", whiteSpace: "nowrap", textAlign: "center", padding: "10px 12px", fontSize: 14 }}>{k}</Link>)}</div>
          </section>
        </div>
        <aside style={{ alignSelf: "stretch" }}><div className="sticky-card" style={{ boxShadow: "none", position: "sticky", top: STICKY_TOP, maxHeight: `calc(100vh - ${STICKY_TOP + 16}px)`, overflowY: "auto" }}><Enquiry service={`Legal help: ${key}`} title={`Ask about ${key.toLowerCase()}`} preset={preset} fields={[["topic", "Topic", "text", ["Document check", "Dispute", "Deed transfer", "Naksa & approvals", "Rental agreement", "Inheritance", "Other"]]]} /></div></aside>
      </div>
    </>
  );
}

/* Detail copy for each property management service. General guide: confirm final wording and fees with your team. */
const MANAGEMENT = {
  "Tenant search": {
    slug: "tenant-search", icon: Users, summary: "Listing, viewings and background checks.",
    what: "We find a reliable tenant for your property. We advertise it, show it to interested people and check who they are before you sign anything.",
    when: "When your property is empty or a tenant is about to leave, and you do not have time to find the next one yourself.",
    steps: [
      ["Understand your property", "We note the type, location, rent you expect and what kind of tenant you prefer."],
      ["Take photos and list", "Clear photos and a short description are listed on our site and other channels."],
      ["Handle enquiries", "We answer calls and messages and book viewings at times that suit you."],
      ["Show the property", "Our team shows the property so you do not need to be there."],
      ["Check the tenant", "We check citizenship, workplace and references of the people who want to rent."],
      ["Send you the shortlist", "You choose the tenant, and we move on to the agreement."],
    ],
    docs: ["Proof of ownership (lal purja)", "Owner's citizenship copy", "Expected rent and deposit", "Keys and access details"],
  },
  "Rent collection": {
    slug: "rent-collection", icon: Receipt, summary: "Monthly collection with receipts and statements.",
    what: "We collect rent from your tenant every month and pass it on to you, with a receipt for the tenant and a statement for you.",
    when: "When you live abroad or are busy, or when you want a clear record of every payment.",
    steps: [
      ["Set the rent terms", "Rent amount, due date and any yearly increase are written down."],
      ["Share payment options", "The tenant pays by Fonepay, eSewa, IME Pay or bank transfer."],
      ["Send reminders", "A friendly reminder goes out before the due date."],
      ["Confirm each payment", "We check every payment reference before we issue a receipt."],
      ["Pay you the rent", "Rent is sent to your account, after any agreed fee and expenses."],
      ["Monthly statement", "You get a simple statement of rent received, expenses and balance."],
    ],
    docs: ["Signed rental agreement", "Tenant's name and phone number", "Owner's bank account details", "Agreed rent and due date"],
  },
  "Maintenance": {
    slug: "maintenance", icon: Wrench, summary: "Plumbing, electrical and painting with trusted vendors.",
    what: "We arrange repairs and upkeep through trusted plumbers, electricians, painters and cleaners, and we agree the price with you first.",
    when: "When something breaks, when a tenant moves out, or when the property needs regular upkeep.",
    steps: [
      ["Receive the problem", "The tenant or owner reports the issue by phone or message."],
      ["Check the issue", "We look at the problem, with photos where possible."],
      ["Get a quote", "A trusted vendor gives a price, and we send it to you."],
      ["You approve", "Work starts only after you say yes, except for urgent repairs."],
      ["Do the work", "We schedule the vendor with the tenant and see that it is done properly."],
      ["Report and invoice", "You get photos of the finished work and a clear bill."],
    ],
    docs: ["Property address and access details", "Tenant contact number", "Your approved repair budget", "Any warranty papers for fittings"],
  },
  "Inspections": {
    slug: "inspections", icon: ShieldCheck, summary: "Quarterly visits with photo reports.",
    what: "We visit your property regularly and send you a photo report, so you know how it is being looked after even when you are far away.",
    when: "When you live abroad or in another city, or when you want to check that the tenant is looking after the property.",
    steps: [
      ["Agree the schedule", "We fix the visit dates, usually every three months."],
      ["Inform the tenant", "The tenant is told before each visit."],
      ["Check the building", "We look at walls, roof, doors, windows and the compound."],
      ["Check fittings", "Plumbing, electrical points, water tank and appliances are tested."],
      ["Take photos", "Clear photos are taken of every room and any problem found."],
      ["Send your report", "You get a short written report with what needs attention."],
    ],
    docs: ["Property address", "Tenant contact number", "List of fittings and appliances", "Owner's phone or email for reports"],
  },
  "Agreements": {
    slug: "agreements", icon: Scale, summary: "Lease drafting, renewals and move-out handover.",
    what: "We prepare the written lease, renew it when it ends and handle the handover when a tenant leaves, so both sides are clear and protected.",
    when: "Before a tenant moves in, when a lease is ending, or when a tenant gives notice to leave.",
    steps: [
      ["Agree the main terms", "Rent, deposit, lease length and notice period are set with you."],
      ["Draft the lease", "A clear lease is written in simple language for both sides."],
      ["Sign and keep copies", "Owner and tenant sign, and each keeps a copy."],
      ["Track the renewal date", "We remind you before the lease ends."],
      ["Renew or change terms", "We update the rent or conditions and prepare the new lease."],
      ["Move-out handover", "We check the property, settle the deposit and take back the keys."],
    ],
    docs: ["Citizenship copies of owner and tenant", "Proof of ownership", "Agreed rent and deposit", "Move-in or move-out date"],
  },
  "Utilities & tax": {
    slug: "utilities-tax", icon: Building2, summary: "Electricity, water and municipal tax paid on time.",
    what: "We pay the regular bills on your property, such as electricity, water and municipal tax, so nothing is late and no penalty is added.",
    when: "When you do not live near the property, or when you keep forgetting due dates.",
    steps: [
      ["List all the bills", "We note each account: electricity, water, internet and municipal tax."],
      ["Set the due dates", "A calendar is made so no date is missed."],
      ["Check the amounts", "We read the bill and check it against usage and past bills."],
      ["Pay on time", "Bills are paid from the funds you agree or from rent collected."],
      ["Keep the receipts", "Every receipt is saved and shared with you."],
      ["Yearly summary", "You get one yearly summary of what was paid, useful for your tax records."],
    ],
    docs: ["Customer numbers for electricity and water", "Latest tiraro or tax receipt", "Owner's citizenship copy", "Funds or bank details for payment"],
  },
};

export function PropertyManagement() {
  useSEO("Property management", "Tenant search, rent collection and maintenance for property owners in Nepal.");
  return (
    <>
      <div className="tools-hero services-hero"><PageHead crumbs={[{ label: "Services", to: "/services" }, { label: "Property management" }]} title="Property management">For owners abroad or busy at work: we look after tenants, rent and repairs.</PageHead></div>
      <div className="container section-sm detail-layout" style={{ marginTop: 0 }}>
        <div className="stack" style={{ gap: 40 }}>
          <Points items={Object.entries(MANAGEMENT).map(([k, v]) => [v.icon, k, v.summary, `/services/management/${v.slug}`])} />
          <section><SectionHead title="How it works" />
            <div className="steps-num">
              <div><h4>1. Tell us about your property</h4><p className="small muted">Share the type, location and what help you want.</p></div>
              <div><h4>2. Get a quote</h4><p className="small muted">We call you back with a clear monthly fee, with no hidden charges.</p></div>
              <div><h4>3. Sign the agreement</h4><p className="small muted">The services, fee and our duties are written down for you.</p></div>
              <div><h4>4. We take over</h4><p className="small muted">We collect keys, meet the tenant and set up rent and bills.</p></div>
              <div><h4>5. Regular reports</h4><p className="small muted">Each month you get rent, expense and inspection updates.</p></div>
              <div><h4>6. Stay in control</h4><p className="small muted">You approve big repairs and can change or stop the service.</p></div>
            </div>
          </section>
          <section><SectionHead title="What owners get" />
            <ul className="prose" style={{ columns: 2, columnGap: 32 }}>
              <li>One contact person for everything</li>
              <li>Rent paid to your account every month</li>
              <li>Photo reports after every inspection</li>
              <li>Repairs approved by you before work starts</li>
              <li>Receipts and statements for your records</li>
              <li>Bills and municipal tax paid on time</li>
            </ul>
          </section>
        </div>
        <aside style={{ alignSelf: "stretch" }}><div className="sticky-card" style={{ boxShadow: "none" }}><Enquiry service="Property management" title="Get a management quote" fields={[["property_type", "Property type", "text", ["House", "Flat", "Apartment", "Commercial", "Land"]], ["location", "Location"]]} /></div></aside>
      </div>
    </>
  );
}

export function ManagementService() {
  const { slug } = useParams();
  const key = Object.keys(MANAGEMENT).find((k) => MANAGEMENT[k].slug === slug);
  const v = key && MANAGEMENT[key];
  useSEO(key || "Property management", v ? v.summary : "Property management in Nepal.");
  if (!v) return <div className="container section stack"><h2>Service not found</h2><Link to="/services/management" className="link">See all management services</Link></div>;
  return (
    <>
      <div className="tools-hero services-hero"><PageHead crumbs={[{ label: "Services", to: "/services" }, { label: "Property management", to: "/services/management" }, { label: key }]} title={key}>{v.summary}</PageHead></div>
      <div className="container section-sm detail-layout" style={{ marginTop: 0 }}>
        <div className="stack" style={{ gap: 48 }}>
          <section><SectionHead title="What it is" /><p>{v.what}</p></section>
          <section><SectionHead title="When you need it" /><p>{v.when}</p></section>
          <section><SectionHead title="What we do" />
            <div className="steps-num">{v.steps.map(([t, d], i) => <div key={t}><h4>{i + 1}. {t}</h4><p className="small muted">{d}</p></div>)}</div>
          </section>
          <section><SectionHead title="What we need from you" />
            <ul className="prose" style={{ columns: 2, columnGap: 32 }}>{v.docs.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
          <section><SectionHead title="Other management services" />
            <div className="row" style={{ gap: 8, flexWrap: "nowrap", overflowX: "auto" }}>{Object.keys(MANAGEMENT).filter((k) => k !== key).map((k) => <Link key={k} to={`/services/management/${MANAGEMENT[k].slug}`} className="chip" style={{ flex: "1 1 auto", whiteSpace: "nowrap", textAlign: "center", padding: "10px 12px", fontSize: 14 }}>{k}</Link>)}</div>
          </section>
        </div>
        <aside style={{ alignSelf: "stretch" }}><div className="sticky-card" style={{ boxShadow: "none", position: "sticky", top: STICKY_TOP, maxHeight: `calc(100vh - ${STICKY_TOP + 16}px)`, overflowY: "auto" }}><Enquiry service={`Property management: ${key}`} title={`Ask about ${key.toLowerCase()}`} fields={[["property_type", "Property type", "text", ["House", "Flat", "Apartment", "Commercial", "Land"]], ["location", "Location"]]} /></div></aside>
      </div>
    </>
  );
}

export function PayRent() {
  useSEO("Pay rent online", "Pay rent by Fonepay, eSewa, IME Pay or bank transfer.");
  const { toast } = useApp();
  const [f, setF] = useState({ code: "", name: "", phone: "", month: new Date().toISOString().slice(0, 7), amount: "", method: "Fonepay", ref: "" });
  const [proof, setProof] = useState(null);
  const [done, setDone] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.contactAgent({ agent_id: null, name: f.name, phone: f.phone, email: "", contact_form: `Service: Rent payment | Property: ${f.code} | Month: ${f.month} | Amount: ${f.amount} | Method: ${f.method} | Ref: ${f.ref}${proof ? " | Proof: " + proof.name : ""}`, terms_agrement: "yes" });
      recordPayment({ code: `RENT-${f.month}-${(f.code || "X").toUpperCase()}`, kind: "rent", title: `Rent ${f.month}${f.code ? " · " + f.code : ""}`, total: Number(f.amount) || 0, paid: Number(f.amount) || 0, method: f.method, status: "pending_verification" });
      setDone(true); toast("Payment details sent. Track it in My payments.");
    } catch (x) { toast(x.message); }
  };
  return (
    <>
      <div className="tools-hero services-hero"><PageHead crumbs={[{ label: "Services", to: "/services" }, { label: "Pay rent online" }]} title="Pay rent online">Scan, pay and send us the reference. Owners get notified and you get a receipt.</PageHead></div>
      <div className="container section-sm detail-layout" style={{ marginTop: 0 }}>
        <div className="stack" style={{ gap: 24 }}>
          <div className="steps-num" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <div><h4>Scan & pay</h4><p className="small muted">Use Fonepay, eSewa or IME Pay with the QR.</p></div>
            <div><h4>Send reference</h4><p className="small muted">Enter the transaction ID and upload a screenshot.</p></div>
            <div><h4>Get receipt</h4><p className="small muted">We confirm with the owner and email your receipt.</p></div>
          </div>
          <div className="card card-pad row" style={{ gap: 24, alignItems: "center", flexWrap: "wrap" }}>
            <img src="/pay/fonepay-qr.png" alt="Fonepay QR" style={{ width: 180, background: "#FFFFFF", padding: 8, border: "1px solid var(--line)" }} />
            <div className="stack" style={{ gap: 10 }}>
              <span className="row"><QrCode size={18} color="var(--c-red)" /> Scan with any banking app</span>
              <div className="row" style={{ gap: 10 }}>{["esewa", "imepay"].map((k) => <img key={k} src={`/pay/${k}.png`} alt={k} style={{ height: 32, background: "#FFFFFF", padding: 4, border: "1px solid var(--line)" }} />)}</div>
              <span className="small muted">Bank transfer: details shared on request.</span>
            </div>
          </div>
          <section><SectionHead title="Good to know" />
            <ul className="prose" style={{ columns: 2, columnGap: 32 }}>
              <li>Use the property code from your agreement or the property page</li>
              <li>Pay the exact rent amount for the month</li>
              <li>Keep the payment screenshot until you get the receipt</li>
              <li>Pay by the due date to avoid late fees</li>
              <li>Enter the transaction ID exactly as shown</li>
              <li>One payment form for each month</li>
            </ul>
          </section>
          <section><SectionHead title="Common questions" />
            <div className="stack" style={{ gap: 16 }}>
              <div><h4>When do I get my receipt?</h4><p className="small muted">We confirm the payment with the owner, then email your receipt.</p></div>
              <div><h4>What if I pay the wrong amount?</h4><p className="small muted">Call us with your transaction ID and we will sort it out with the owner.</p></div>
              <div><h4>I do not know my property code.</h4><p className="small muted">It is written on your rental agreement. You can also find it on the property page and on the listing card, shown as #code. Or ask the owner or call our team.</p></div>
            </div>
          </section>
        </div>
        <aside style={{ alignSelf: "stretch" }}><div className="sticky-card" style={{ boxShadow: "none" }}>
          {done ? <div className="card card-pad stack" style={{ gap: 10 }}><Check size={28} color="var(--c-red)" /><h3>Thank you</h3><p className="muted small">We will confirm your payment and send a receipt.</p></div> : (
            <form className="card card-pad stack" onSubmit={submit}>
              <h3>Payment details</h3>
              <input className="input" placeholder="Tenant name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              <input className="input" type="tel" placeholder="Phone" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
              <div className="form-grid">
                <input className="input" placeholder="Property code" required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
                <input className="input" type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} />
                <input className="input" type="number" placeholder="Amount (Rs.)" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
                <select className="select" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{["Fonepay", "eSewa", "IME Pay", "Khalti", "Bank transfer"].map((m) => <option key={m}>{m}</option>)}</select>
              </div>
              <input className="input" placeholder="Transaction ID / reference" required value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
              <label className="drop" style={{ padding: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}><Upload size={18} style={{ flexShrink: 0 }} /><span>{proof ? proof.name : "Upload payment screenshot"}</span><input type="file" accept="image/*" hidden onChange={(e) => setProof(e.target.files[0])} /></label>
              <button className="btn btn-primary"><Wallet size={16} /> Submit payment</button>
            </form>
          )}
        </div></aside>
      </div>
    </>
  );
}

export const SERVICE_LINKS = [
  ["/services/home-loan", Landmark, "Home loan", "Compare bank offers and apply."],
  ["/services/legal-help", Scale, "Legal help", "Document checks and deed transfer."],
  ["/services/management", KeyRound, "Property management", "Tenants, rent and repairs handled."],
  ["/services/pay-rent", Wallet, "Pay rent online", "Fonepay, eSewa, IME Pay or bank."],
  ["/rates-and-trends", Receipt, "Rates & trends", "Average prices by locality."],
  ["/requirement", FileSearch, "Post a requirement", "Tell us what you need."],
];
// Property valuation: its own page and request form (it used to open the Post a requirement form)
export function Valuation() {
  useSEO("Property valuation", "A written property valuation in Nepal: site visit, locality price comparison and a report partner banks accept.");
  return (
    <>
      <div className="tools-hero services-hero"><PageHead crumbs={[{ label: "Services", to: "/services" }, { label: "Property valuation" }]} title="Property valuation">Know what your land, house or flat is worth before you sell, buy, divide family property or apply for a loan.</PageHead></div>
      <div className="container section-sm detail-layout" style={{ marginTop: 0 }}>
        <div className="stack" style={{ gap: 40 }}>
          <section><SectionHead title="How it works" />
            <div className="steps-num">
              <div><h4>1. Send a request</h4><p className="small muted">Tell us where the property is, what it is and why you need the value.</p></div>
              <div><h4>2. We fix a visit</h4><p className="small muted">A valuer calls you to agree a date and the fee before anything starts.</p></div>
              <div><h4>3. Site visit</h4><p className="small muted">The valuer measures the land and building, checks access and takes photos.</p></div>
              <div><h4>4. Papers checked</h4><p className="small muted">Lal purja, trace map, naksa and tax receipts are matched with the site.</p></div>
              <div><h4>5. Price comparison</h4><p className="small muted">Recent prices in the same locality and road width are compared.</p></div>
              <div><h4>6. Written report</h4><p className="small muted">You get a signed report, usually within 3 to 5 working days.</p></div>
            </div>
          </section>
          <section><SectionHead title="What the report covers" />
            <ul className="prose" style={{ columns: 2, columnGap: 32 }}>
              <li>Land area in ropani, aana and square feet</li>
              <li>Building area, age and condition</li>
              <li>Road access, width and setbacks</li>
              <li>Market value and distress value</li>
              <li>Government (malpot) rate for the area</li>
              <li>Photos, location map and comparables</li>
            </ul>
          </section>
          <section><SectionHead title="Papers to keep ready" />
            <ul className="prose" style={{ columns: 2, columnGap: 32 }}>
              <li>Lal purja (land ownership certificate)</li>
              <li>Trace map and charkilla</li>
              <li>Approved building naksa, if built</li>
              <li>Latest land tax receipt</li>
              <li>Owner's citizenship copy</li>
              <li>Bank's format, if the report is for a loan</li>
            </ul>
          </section>
        </div>
        <aside style={{ alignSelf: "stretch" }}><div className="sticky-card" style={{ boxShadow: "none" }}><Enquiry service="Property valuation" title="Request a valuation" cta="Request valuation"
          fields={[["property_type", "Property type", "text", ["Land", "House", "Flat", "Apartment", "Commercial"]], ["location", "Location"], ["purpose", "Valuation for", "text", ["Selling", "Buying", "Bank loan", "Family division", "Other"]]]} /></div></aside>
      </div>
    </>
  );
}
