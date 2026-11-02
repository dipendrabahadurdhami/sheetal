import React, { useState } from "react";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { TODAY, fdate, rs, rsShort, daysFromToday } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Seg, Stat, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Bars, Donut } from "@sheetal/shared/core/charts";
import { LinkChip } from "@sheetal/shared/layout/Links";
import { DeleteConfirm, ViewDrawer, restoreAt, useUndo } from "@sheetal/shared/components/Crud";

// Sector tools: developer projects + instalments, collections, sponsor investors, agent renewals,
// reviews, expenses with profit and loss, and stock. `L(key, english)` keeps copy translatable.
const useL = () => { const t = useT(); return (k, en, v) => { const s = t(k, v); if (s !== k) return s; let o = en; if (v) for (const x in v) o = o.split(`{${x}}`).join(v[x]); return o; }; };
const useSec = (tid, key, seed) => {
  const { db, update } = useStore();
  const val = db.sector?.[tid]?.[key] ?? seed;
  const set = (fn) => update((d) => { d.sector = d.sector || {}; d.sector[tid] = d.sector[tid] || {}; if (d.sector[tid][key] === undefined) d.sector[tid][key] = structuredClone(seed); fn(d.sector[tid][key]); });
  return [val, set];
};

/* ───────── Developer: projects, unit inventory, construction progress ───────── */
const PROJECTS = [];
export function Projects({ tenant }) {
  const L = useL();
  const toast = useToast();
  const [projects, setProjects] = useSec(tenant.id, "projects", PROJECTS);
  const [units, setUnits] = useSec(tenant.id, "units", []);
  const [pid, setPid] = useState(projects[0]?.id);
  const [tab, setTab] = useState("units");
  const [sel, setSel] = useState(null);
  const [post, setPost] = useState("");
  const p = projects.find((x) => x.id === pid) || projects[0];
  const count = (s) => units.filter((u) => u.status === s).length;
  const floors = [...new Set(units.map((u) => u.floor))];
  const buyerRows = units.filter((u) => u.buyer).map((u) => ({ buyer: u.buyer, phone: u.phone || "", no: u.no, price: u.price, token: u.token || "", citizenship: u.citizenship || "" }));
  const importBuyers = (rows) => {
    const miss = rows.filter((r) => !units.some((u) => u.no.toLowerCase() === r.no.toLowerCase()));
    setUnits((a) => { rows.forEach((r) => { const u = a.find((y) => y.no.toLowerCase() === r.no.toLowerCase()); if (u) Object.assign(u, { buyer: r.buyer, phone: r.phone, price: r.price, token: r.token || 0, citizenship: r.citizenship || "", status: u.status === "sold" ? "sold" : "reserved" }); }); });
    if (miss.length) toast(L("pj.toastMiss", "{n} rows skipped: unit number not found", { n: miss.length }));
  };
  if (!p) return (
    <>
      <PageHead title={L("nav.projects", "Projects")} sub={L("pj.sub", "Units, prices, buyers and construction progress for each project")} />
      <section className="card pf-panel"><Empty icon="building-2" title={L("pj.none", "No projects yet")}>{L("pj.noneSub", "Post a project from Listings and its units, buyers and progress show here.")}</Empty></section>
    </>
  );
  return (
    <>
      <PageHead title={L("nav.projects", "Projects")} sub={L("pj.sub", "Units, prices, buyers and construction progress for each project")} actions={<><DataActions kind="buyers" rows={buyerRows} onImport={importBuyers} /><LinkChip to="/business/collections" icon="hand-coins">{L("nav.collections", "Collections")}</LinkChip><LinkChip to="/business/agreements" icon="file-pen-line">{L("nav.agreements", "Agreements")}</LinkChip></>} />
      <div className="pf-chips">{projects.map((x) => <button key={x.id} className={`chip ${pid === x.id ? "active" : ""}`} onClick={() => setPid(x.id)}><Icon name="building-2" size={14} />{x.name}</button>)}</div>
      <div className="pf-stats">
        <Stat label={L("pj.sold", "Sold")} value={`${count("sold")} / ${units.length}`} note={L("pj.reserved", "{n} reserved", { n: count("reserved") })} />
        <Stat label={L("pj.value", "Sales value")} value={rsShort(units.filter((u) => u.status === "sold").reduce((s, u) => s + u.price, 0))} note={L("pj.left", "{v} still to sell", { v: rsShort(units.filter((u) => u.status === "available").reduce((s, u) => s + u.price, 0)) })} />
        <Stat label={L("pj.progress", "Construction")} value={`${p.progress}%`} note={L("pj.handover", "Handover {d}", { d: p.handover })} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "units", label: L("pj.units", "Unit chart"), icon: "layout-grid" }, { id: "progress", label: L("pj.prog", "Progress"), icon: "construction" }]} />
      {tab === "units" && <section className="card pf-panel"><div className="pf-pad">
        <div className="pf-cal-legend" style={{ marginBottom: 12 }}>{["available", "reserved", "sold", "blocked"].map((s) => <span key={s}><i className={`pf-u-${s}`} />{L(`pj.s_${s}`, s[0].toUpperCase() + s.slice(1))} · {count(s)}</span>)}</div>
        <div className="pf-units">{floors.map((fl) => (
          <div key={fl} className="pf-units-row"><span className="tnum small muted">{L("pj.floor", "Floor {n}", { n: fl })}</span>
            {units.filter((u) => u.floor === fl).map((u) => <button key={u.no} className={`pf-unit pf-u-${u.status}`} onClick={() => setSel(u)} aria-label={`${u.no} ${u.status}`}><b className="tnum">{u.no}</b><small>{u.type.toUpperCase()}</small></button>)}
          </div>
        ))}</div>
      </div></section>}
      {tab === "progress" && <div className="pf-split">
        <Panel title={L("pj.milestones", "Milestones")} className="grow" pad><div className="pf-stack">{p.milestones.map(([n, v]) => (
          <div key={n} className="pf-meter"><div className="pf-meter-top"><span>{n}</span><b className="tnum">{v}%</b></div><div className="bar"><i style={{ width: `${v}%` }} /></div></div>
        ))}</div></Panel>
        <Panel title={L("pj.updates", "Updates for buyers")} sub={L("pj.updatesSub", "Buyers get these by SMS and on their account page")} className="side" pad><div className="pf-stack">
          <Textarea rows={3} value={post} onChange={(e) => setPost(e.target.value)} placeholder={L("pj.postPh", "What happened on site this week?")} style={{ minHeight: 80 }} />
          <div className="pf-row-actions"><label className="btn btn-outline btn-sm"><input type="file" hidden accept="image/*" /><Icon name="image" size={14} />{L("pj.photo", "Photo")}</label><Button size="sm" icon="send" disabled={!post.trim()} onClick={() => { setProjects((a) => { a.find((x) => x.id === pid).updates.unshift({ at: TODAY.slice(0, 10), text: post }); }); setPost(""); toast(L("pj.toastPosted", "Posted. Buyers have been told.")); }}>{L("pj.post", "Post update")}</Button></div>
          <ul className="pf-list">{p.updates.map((u, i) => <li key={i}><span className="pf-li-ico"><Icon name="construction" size={16} /></span><div><span>{u.text}</span><span className="small muted tnum">{fdate(u.at)}</span></div></li>)}</ul>
        </div></Panel>
      </div>}
      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.no} sub={sel && `${sel.type.toUpperCase()} · ${sel.size} sq ft · ${L("pj.floor", "Floor {n}", { n: sel.floor })}`}
        footer={sel && <>{sel.status === "available" && <Button icon="bookmark" onClick={() => { setUnits((a) => { const u = a.find((x) => x.no === sel.no); u.status = "reserved"; u.buyer = "New buyer"; }); setSel(null); toast(L("pj.toastReserved", "Reserved for 7 days. Make the reservation agreement next.")); }}>{L("pj.reserve", "Reserve")}</Button>}
          {sel.status === "reserved" && <Button icon="check" onClick={() => { setUnits((a) => { a.find((x) => x.no === sel.no).status = "sold"; }); setSel(null); toast(L("pj.toastSold", "Marked sold. Instalment plan created.")); }}>{L("pj.markSold", "Mark sold")}</Button>}</>}>
        {sel && <div className="pf-stack">
          <dl className="pf-kv"><dt>{L("listings.price", "Price")}</dt><dd className="tnum">{rs(sel.price)}</dd><dt>{L("common.status", "Status")}</dt><dd><Badge tone={{ available: "done", reserved: "action", sold: "neutral", blocked: "problem" }[sel.status]}>{L(`pj.s_${sel.status}`, sel.status)}</Badge></dd><dt>{L("pj.buyer", "Buyer")}</dt><dd>{sel.buyer || "—"}</dd></dl>
          <Field label={L("pj.plan", "Payment plan")}><div className="pf-totals">{[["Booking", 10], ["Structure", 30], ["Plaster", 30], ["Handover", 30]].map(([n, pc]) => <div key={n}><span>{n} · {pc}%</span><span className="tnum">{rs((sel.price * pc) / 100)}</span></div>)}</div></Field>
        </div>}
      </Drawer>
    </>
  );
}

/* ───────── Collections: instalments, tokens, reminders ───────── */
const INST = [];
export function Collections({ tenant }) {
  const L = useL();
  const toast = useToast();
  const [list, setList] = useSec(tenant.id, "inst", INST);
  const [f, setF] = useState("open");
  const [ed, setEd] = useState(null);
  const [del, setDel] = useState(null);
  const rows = list.filter((x) => (f === "open" ? x.status !== "paid" : x.status === f));
  const instRows = list.map((x) => ({ ...x, status: x.status[0].toUpperCase() + x.status.slice(1) }));
  const nextIn = (a) => "IN-" + (Math.max(300, ...a.map((x) => Number(String(x.id).replace(/\D/g, "")) || 0)) + 1);
  const importInst = (r) => setList((a) => { r.forEach((x) => a.push({ id: nextIn(a), who: x.who, unit: x.unit, what: x.what || "Instalment", amount: x.amount, due: x.due, status: String(x.status || "Upcoming").toLowerCase() })); });
  const saveInst = () => { const rec = { ...ed, amount: Number(ed.amount) || 0 }; setList((a) => { const i = a.findIndex((x) => x.id === rec.id); if (i >= 0) a[i] = rec; else a.push({ ...rec, id: nextIn(a) }); }); setEd(null); toast(L("co.toastSaved", "Instalment saved")); };
  const sum = (s) => list.filter((x) => s.includes(x.status)).reduce((a, x) => a + x.amount, 0);
  return (
    <>
      <PageHead title={L("nav.collections", "Collections")} sub={L("co.sub", "Tokens, instalments and fees. Buyers get a pay link and reminders automatically.")} actions={<><DataActions kind="instalments" rows={instRows} onImport={importInst} /><LinkChip to="/business/invoices" icon="receipt">{L("nav.invoices", "Invoices")}</LinkChip><Button icon="plus" onClick={() => setEd({ who: "", unit: "", what: "", amount: "", due: TODAY.slice(0, 10), status: "upcoming" })}>{L("co.add", "Add instalment")}</Button></>} />
      <div className="pf-stats">
        <Stat label={L("co.dueSoon", "Due this month")} value={rs(sum(["due"]))} note={L("co.people", "{n} buyers", { n: list.filter((x) => x.status === "due").length })} />
        <Stat label={L("co.overdue", "Overdue")} value={rs(sum(["overdue"]))} note={L("co.remind", "Reminder sent daily")} tone="action" noteIcon="circle-alert" />
        <Stat label={L("co.collected", "Collected")} value={rs(sum(["paid"]))} note={L("co.month", "This month")} to="/business/payouts" />
      </div>
      <section className="card pf-panel">
        <div className="pf-toolbar"><Seg value={f} onChange={setF} options={[{ id: "open", label: L("co.open", "To collect") }, { id: "overdue", label: L("co.overdue", "Overdue") }, { id: "paid", label: L("co.paid", "Paid") }]} /></div>
        <Table rows={rows} minWidth={820} onRowClick={(x) => setEd({ ...x, amount: String(x.amount) })}
          empty={<Empty icon="hand-coins" title={f === "paid" ? "Nothing paid yet" : "Nothing to collect"}>{f === "paid" ? "Payments you record show here." : "Every instalment in this view is paid."}</Empty>} columns={[
          { key: "w", label: L("pj.buyer", "Buyer"), render: (x) => <span className="pf-two"><b>{x.who}</b><small className="tnum">{x.unit}</small></span> },
          { key: "x", label: L("co.for", "For"), render: (x) => x.what },
          { key: "a", label: L("billing.amount", "Amount"), num: true, align: "right", render: (x) => rs(x.amount) },
          { key: "d", label: L("co.due", "Due"), num: true, render: (x) => <span className={x.status === "overdue" ? "pf-tone-action" : undefined}>{fdate(x.due)}<small className="pf-sub-line">{daysFromToday(x.due) < 0 ? L("ag.overdue", "{n} days overdue", { n: -daysFromToday(x.due) }) : L("ag.inDays", "in {n} days", { n: daysFromToday(x.due) })}</small></span> },
          { key: "s", label: L("common.status", "Status"), render: (x) => <Badge tone={{ paid: "done", overdue: "action", due: "progress", upcoming: "neutral" }[x.status]}>{L(`co.s_${x.status}`, x.status)}</Badge> },
          { key: "z", label: "", align: "right", render: (x) => x.status !== "paid" && <div className="pf-row-actions" onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="sm" icon="send" onClick={() => toast(L("co.toastLink", "Pay link sent by SMS and WhatsApp"))}>{L("co.sendLink", "Send link")}</Button><Button size="sm" onClick={() => { setList((a) => { a.find((y) => y.id === x.id).status = "paid"; }); toast(L("co.toastPaid", "Recorded. Receipt sent.")); }}>{L("co.record", "Record payment")}</Button></div> },
        ]} />
      </section>
      <Drawer open={!!ed} onClose={() => setEd(null)} title={ed?.id ? `${ed.id} · ${ed.who}` : L("co.add", "Add instalment")}
        footer={ed && <>{ed.id && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" onClick={() => setDel(ed)}>{L("common.delete", "Delete")}</Button>}<Button variant="outline" onClick={() => setEd(null)}>{L("common.cancel", "Cancel")}</Button><Button disabled={!ed.who.trim() || !ed.unit.trim() || !(Number(ed.amount) > 0) || !ed.due} onClick={saveInst}>{L("common.save", "Save")}</Button></>}>
        {ed && <div className="pf-stack">
          <div className="pf-grid-2 tight"><Field label={L("pj.buyer", "Buyer")}><Input value={ed.who} onChange={(e) => setEd({ ...ed, who: e.target.value })} /></Field><Field label="Unit"><Input className="input tnum" value={ed.unit} onChange={(e) => setEd({ ...ed, unit: e.target.value })} placeholder="A-1201" /></Field></div>
          <Field label={L("co.for", "For")}><Input value={ed.what} onChange={(e) => setEd({ ...ed, what: e.target.value })} placeholder="Structure 30%" /></Field>
          <div className="pf-grid-2 tight"><Field label={L("billing.amount", "Amount")}><div className="pf-unit"><span>Rs.</span><input className="input tnum" inputMode="numeric" value={ed.amount} onChange={(e) => setEd({ ...ed, amount: e.target.value.replace(/\D/g, "") })} /></div></Field><Field label={L("co.due", "Due")}><Input type="date" value={ed.due} onChange={(e) => setEd({ ...ed, due: e.target.value })} /></Field></div>
          <Field label={L("common.status", "Status")}><Seg value={ed.status} onChange={(v) => setEd({ ...ed, status: v })} options={["upcoming", "due", "overdue", "paid"].map((x) => ({ id: x, label: L(`co.s_${x}`, x[0].toUpperCase() + x.slice(1)) }))} /></Field>
        </div>}
      </Drawer>
      <DeleteConfirm item={del} name={del && `${del.id} · ${del.who}`} what="instalment" onClose={() => setDel(null)}
        onDelete={(x) => { setList((a) => { a.splice(a.findIndex((y) => y.id === x.id), 1); }); setEd(null); }} onRestore={(x) => setList((a) => { restoreAt(a, { ...x, amount: Number(x.amount) || 0 }, a.length); })} />
    </>
  );
}

/* ───────── Sponsor: investors and updates ───────── */
const INVESTORS = [];
export function Investors({ tenant }) {
  const L = useL();
  const toast = useToast();
  const [list, setList] = useSec(tenant.id, "investors", INVESTORS);
  const [tab, setTab] = useState("people");
  const [ed, setEd] = useState(null);
  const [del, setDel] = useState(null);
  const ivRows = list.map((x) => ({ ...x, kyc: x.kyc ? "Yes" : "No" }));
  const importIv = (r) => setList((a) => { r.forEach((x, i) => a.push({ id: `iv${Date.now()}${i}`, name: x.name, city: x.city || "", amount: x.amount, since: x.since, kyc: x.kyc === "Yes" })); });
  const saveIv = () => { const rec = { ...ed, amount: Number(ed.amount) || 0 }; setList((a) => { const i = a.findIndex((x) => x.id === rec.id); if (i >= 0) a[i] = rec; else a.push({ ...rec, id: `iv${Date.now()}` }); }); setEd(null); toast(L("iv.toastSaved", "Investor saved")); };
  const [msg, setMsg] = useState("");
  const raised = 27500000; const target = 50000000;
  return (
    <>
      <PageHead title={L("nav.investors", "Investors")} sub={L("iv.sub", "Who has invested, how much, and what you've told them")} actions={<><DataActions kind="investors" rows={ivRows} onImport={importIv} /><LinkChip to="/business/payouts" icon="wallet">{L("iv.returns", "Pay returns")}</LinkChip><Button icon="user-plus" onClick={() => setEd({ name: "", city: "", amount: "", since: TODAY.slice(0, 10), kyc: false })}>{L("iv.add", "Add investor")}</Button></>} />
      <div className="pf-stats">
        <Stat label={L("kpi.raised", "Raised")} value={rsShort(raised)} note={L("iv.ofTarget", "{p}% of {t}", { p: Math.round((raised / target) * 100), t: rsShort(target) })} />
        <Stat label={L("kpi.investors", "Investors")} value="128" note={L("iv.kycMissing", "{n} need KYC", { n: list.filter((x) => !x.kyc).length })} tone="action" />
        <Stat label={L("iv.avg", "Average")} value={rs(214800)} note={L("iv.min", "Minimum Rs. 10,000")} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "people", label: L("iv.people", "Investors"), icon: "users" }, { id: "updates", label: L("pj.updates", "Updates"), icon: "megaphone" }]} />
      {tab === "people" && <section className="card pf-panel"><Table rows={list} minWidth={640} onRowClick={(x) => setEd({ ...x, amount: String(x.amount) })}
        empty={<Empty icon="users" title="No investors yet" action={<Button icon="user-plus" onClick={() => setEd({ name: "", city: "", amount: "", since: TODAY.slice(0, 10), kyc: false })}>{L("iv.add", "Add investor")}</Button>}>Add people who invested, or import your list.</Empty>} columns={[
        { key: "n", label: L("iv.name", "Name"), render: (x) => <span className="pf-two"><b>{x.name}</b><small>{x.city}</small></span> },
        { key: "a", label: L("billing.amount", "Amount"), num: true, align: "right", render: (x) => rs(x.amount) },
        { key: "s", label: L("iv.since", "Since"), num: true, render: (x) => fdate(x.since) },
        { key: "k", label: "KYC", render: (x) => (x.kyc ? <Badge tone="done">{L("iv.verified", "Verified")}</Badge> : <Badge tone="action">{L("iv.pending", "Pending")}</Badge>) },
      ]} /></section>}
      {tab === "updates" && <Panel title={L("iv.send", "Send an update")} sub={L("iv.sendSub", "Goes to every investor by email and on their account")} pad><div className="pf-stack">
        <Textarea rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={L("iv.ph", "Progress, numbers, photos. Keep it honest; returns are never guaranteed.")} style={{ minHeight: 100 }} />
        <ToggleRow title={L("iv.attach", "Attach quarterly statement")} sub={L("iv.attachSub", "PDF made from your accounts")} checked onChange={() => {}} />
        <div className="pf-row-actions"><Button icon="send" disabled={!msg.trim()} onClick={() => { setMsg(""); toast(L("iv.toast", "Sent to 128 investors")); }}>{L("iv.sendBtn", "Send update")}</Button></div>
      </div></Panel>}
      <Drawer open={!!ed} onClose={() => setEd(null)} title={ed?.id ? ed.name || "Investor" : L("iv.add", "Add investor")}
        footer={ed && <>{ed.id && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" onClick={() => setDel(ed)}>{L("common.delete", "Delete")}</Button>}<Button variant="outline" onClick={() => setEd(null)}>{L("common.cancel", "Cancel")}</Button><Button disabled={!ed.name.trim() || !(Number(ed.amount) > 0) || !ed.since} onClick={saveIv}>{L("common.save", "Save")}</Button></>}>
        {ed && <div className="pf-stack">
          <div className="pf-grid-2 tight"><Field label={L("iv.name", "Name")}><Input value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} /></Field><Field label="City" optional><Input value={ed.city} onChange={(e) => setEd({ ...ed, city: e.target.value })} /></Field></div>
          <div className="pf-grid-2 tight"><Field label={L("billing.amount", "Amount")}><div className="pf-unit"><span>Rs.</span><input className="input tnum" inputMode="numeric" value={ed.amount} onChange={(e) => setEd({ ...ed, amount: e.target.value.replace(/\D/g, "") })} /></div></Field><Field label={L("iv.since", "Since")}><Input type="date" value={ed.since} onChange={(e) => setEd({ ...ed, since: e.target.value })} /></Field></div>
          <ToggleRow title="KYC verified" sub="Citizenship or passport and PAN checked" checked={!!ed.kyc} onChange={(v) => setEd({ ...ed, kyc: v })} />
        </div>}
      </Drawer>
      <DeleteConfirm item={del} name={del?.name} what="investor" onClose={() => setDel(null)}
        onDelete={(x) => { setList((a) => { a.splice(a.findIndex((y) => y.id === x.id), 1); }); setEd(null); }} onRestore={(x) => setList((a) => { restoreAt(a, { ...x, amount: Number(x.amount) || 0 }, a.length); })}>Their investment record is removed from this list. Agreements and payments already made stay.</DeleteConfirm>
    </>
  );
}

/* ───────── Reviews (all types) ───────── */
const REVIEWS = [];
export function Reviews({ tenant }) {
  const L = useL();
  const toast = useToast();
  const [list, setList] = useSec(tenant.id, "reviews", REVIEWS);
  const [draft, setDraft] = useState({});
  const [del, setDel] = useState(null);
  const undo = useUndo();
  const avg = list.length ? (list.reduce((s, r) => s + r.stars, 0) / list.length).toFixed(1) : "0.0";
  const clearReply = (r) => { const old = r.reply; setList((a) => { a.find((x) => x.id === r.id).reply = ""; }); undo("Reply removed", () => setList((a) => { a.find((x) => x.id === r.id).reply = old; })); };
  const importReviews = (rows) => setList((a) => { rows.forEach((r, i) => a.unshift({ id: `rv${Date.now()}${i}`, who: r.who, stars: r.stars, text: r.text, about: r.about || "", at: r.at || TODAY.slice(0, 10), reply: r.reply || "", imported: true })); });
  return (
    <>
      <PageHead title={L("nav.reviews", "Reviews")} sub={L("rv.sub", "Reviews from people who booked or bought through Sheetal")} actions={<><DataActions kind="reviews" rows={list} onImport={importReviews} /><LinkChip to="/business/promote" icon="trending-up">{L("rv.rank", "Reviews lift your ranking")}</LinkChip></>} />
      <div className="pf-stats">
        <Stat label={L("rv.avg", "Average")} value={`${avg} / 5`} note={L("rv.count", "{n} reviews", { n: 212 })} />
        <Stat label={L("rv.unanswered", "Not answered")} value={list.filter((r) => !r.reply).length} note={L("rv.replyTip", "Reply within 2 days")} tone="action" />
        <Stat label={L("rv.ask", "Ask for reviews")} value={L("common.on", "On")} note={L("rv.askNote", "SMS after check-out or handover")} />
      </div>
      {!list.length && <Empty icon="star" title="No reviews yet">Guests get an SMS asking for a review after check-out. You can also import reviews you collected elsewhere.</Empty>}
      <div className="pf-stack">{list.map((r) => (
        <section key={r.id} className="card pf-pad pf-stack tight">
          <div className="pf-plan-top"><span className="pf-two"><b>{r.who} · <span className="tnum">{"★".repeat(r.stars)}{"☆".repeat(5 - r.stars)}</span></b><small className="tnum">{r.about} · {fdate(r.at)}</small></span><div className="pf-row-actions">{r.imported && <Badge tone="neutral">Imported</Badge>}{r.flagged && <Badge tone="action">{L("rv.reported", "Reported")}</Badge>}{r.imported && <Button variant="ghost" size="sm" icon="trash-2" onClick={() => setDel(r)}>{L("common.delete", "Delete")}</Button>}</div></div>
          <p>{r.text}</p>
          {r.reply ? <div className="pf-note"><Icon name="reply" size={16} /><span><b>{L("rv.yourReply", "Your reply")}:</b> {r.reply}</span>
            <span className="pf-row-actions" style={{ flex: "none" }}><Button variant="ghost" size="sm" icon="pencil" onClick={() => { setDraft({ ...draft, [r.id]: r.reply }); setList((a) => { a.find((x) => x.id === r.id).reply = ""; }); }}>{L("common.edit", "Edit")}</Button><Button variant="ghost" size="sm" icon="trash-2" onClick={() => clearReply(r)}>Remove</Button></span></div> : <div className="pf-stack tight">
            <Textarea rows={2} value={draft[r.id] || ""} onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value })} placeholder={L("rv.replyPh", "Write a public reply")} style={{ minHeight: 60 }} />
            <div className="pf-row-actions"><Button variant="ghost" size="sm" icon="flag" onClick={() => { setList((a) => { a.find((x) => x.id === r.id).flagged = true; }); toast(L("rv.toastReported", "Reported to Sheetal for review")); }}>{L("rv.report", "Report")}</Button>
              <Button variant="outline" size="sm" icon="sparkles" onClick={() => setDraft({ ...draft, [r.id]: r.stars >= 4 ? `Thank you, ${r.who.split(" ")[0]}! We're glad you enjoyed it and hope to see you again.` : `We're sorry, ${r.who.split(" ")[0]}. That's not the stay we want for anyone. We've spoken with the team and would like to make it right; please message us.` })}>{L("rv.suggest", "Suggest reply")}</Button>
              <Button size="sm" disabled={!draft[r.id]} onClick={() => { setList((a) => { a.find((x) => x.id === r.id).reply = draft[r.id]; }); toast(L("rv.toastReplied", "Reply posted")); }}>{L("rv.post", "Post reply")}</Button></div>
          </div>}
        </section>
      ))}</div>
      <DeleteConfirm item={del} name={del && `${del.who}'s review`} what="review" onClose={() => setDel(null)}
        onDelete={(x) => setList((a) => { a.splice(a.findIndex((y) => y.id === x.id), 1); })} onRestore={(x) => setList((a) => { restoreAt(a, x, 0); })}>Only reviews you imported can be deleted. Reviews left through Sheetal stay, and you can report them instead.</DeleteConfirm>
    </>
  );
}

/* ───────── Expenses, profit and loss ───────── */
const EXP = [];
const CATS = ["salary", "utility", "food", "commission", "repair", "marketing", "rent", "tax", "other"];
export function Expenses({ tenant }) {
  const L = useL();
  const toast = useToast();
  const [list, setList] = useSec(tenant.id, "expenses", EXP);
  const [tab, setTab] = useState("pl");
  const [f, setF] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [del, setDel] = useState(null);
  const view = list.find((x) => x.id === viewId);
  const catLabel = (c) => L(`ex.c_${c}`, c[0].toUpperCase() + c.slice(1));
  const save = () => { const rec = { ...f, amount: Number(f.amount), at: f.at || TODAY.slice(0, 10) }; setList((a) => { const i = a.findIndex((x) => x.id === rec.id); if (i >= 0) a[i] = rec; else a.unshift({ ...rec, id: `ex${Date.now()}` }); }); setF(null); toast(L("ex.toast", "Expense saved")); };
  const expRows = list.map((x) => ({ ...x, cat: catLabel(x.cat) }));
  const importExp = (rows) => setList((a) => { rows.forEach((r, i) => a.unshift({ id: `ex${Date.now()}${i}`, what: r.what, cat: String(r.cat).toLowerCase(), amount: r.amount, at: r.at, by: r.by || "Cash", bill: r.bill || "" })); });
  const income = 482300; const cost = list.reduce((s, x) => s + x.amount, 0);
  const byCat = CATS.map((c) => ({ label: L(`ex.c_${c}`, c[0].toUpperCase() + c.slice(1)), v: list.filter((x) => x.cat === c).reduce((s, x) => s + x.amount, 0) })).filter((x) => x.v);
  return (
    <>
      <PageHead title={L("nav.expenses", "Expenses and profit")} sub={L("ex.sub", "Record spending in seconds and see real profit each month")} actions={<><DataActions kind="expenses" rows={expRows} onImport={importExp} /><Button icon="plus" onClick={() => setF({ what: "", cat: "food", amount: "", by: "Cash", at: TODAY.slice(0, 10) })}>{L("ex.add", "Add expense")}</Button></>} />
      <div className="pf-stats">
        <Stat label={L("ex.income", "Income")} value={rs(income)} note={L("co.month", "This month")} to="/business/invoices" />
        <Stat label={L("ex.spent", "Spent")} value={rs(cost)} note={L("ex.items", "{n} expenses", { n: list.length })} />
        <Stat label={L("ex.profit", "Profit")} value={rs(income - cost)} note={L("ex.margin", "{p}% margin", { p: Math.round(((income - cost) / income) * 100) })} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "pl", label: L("ex.pl", "Profit and loss"), icon: "chart-column" }, { id: "list", label: L("ex.list", "Expenses"), icon: "receipt" }]} />
      {tab === "pl" && <div className="pf-split">
        <Panel title={L("ex.byMonth", "Profit by month")} className="grow" pad><Bars data={["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"].map((m, i) => ({ label: m, v: [96, 118, 84, 102, 131, income - cost][i] * (i === 5 ? 1 : 1000) }))} format={rs} /></Panel>
        <Panel title={L("ex.where", "Where money went")} className="side" pad><Donut data={byCat.slice(0, 5)} center={rsShort(cost)} /></Panel>
      </div>}
      {tab === "list" && <section className="card pf-panel"><Table rows={list} minWidth={640} onRowClick={(x) => setViewId(x.id)}
        empty={<Empty icon="receipt" title="No expenses yet" action={<Button icon="plus" onClick={() => setF({ what: "", cat: "food", amount: "", by: "Cash", at: TODAY.slice(0, 10) })}>{L("ex.add", "Add expense")}</Button>}>Add what you spend to see real profit.</Empty>} columns={[
        { key: "w", label: L("ex.what", "What"), render: (x) => <span className="pf-two"><b>{x.what}</b><small>{L(`ex.c_${x.cat}`, x.cat)}</small></span> },
        { key: "b", label: L("ex.paidBy", "Paid by"), render: (x) => x.by },
        { key: "d", label: L("billing.date", "Date"), num: true, render: (x) => fdate(x.at) },
        { key: "a", label: L("billing.amount", "Amount"), num: true, align: "right", render: (x) => rs(x.amount) },
      ]} /></section>}
      <ViewDrawer open={!!view} onClose={() => setViewId(null)} title={view?.what} sub={view && `${catLabel(view.cat)} · ${fdate(view.at)}`}
        facts={view ? [[L("billing.amount", "Amount"), rs(view.amount)], [L("ex.paidBy", "Paid by"), view.by], ["Bill no", view.bill]] : []}
        onEdit={() => { setF({ ...view, amount: String(view.amount) }); setViewId(null); }} onDelete={() => setDel(view)} />
      <DeleteConfirm item={del} name={del?.what} what="expense" onClose={() => setDel(null)}
        onDelete={(x) => { setList((a) => { a.splice(a.findIndex((y) => y.id === x.id), 1); }); setViewId(null); }}
        onRestore={(x) => setList((a) => { restoreAt(a, x, 0); })} />
      <Drawer open={!!f} onClose={() => setF(null)} title={f?.id ? "Edit expense" : L("ex.add", "Add expense")}
        footer={f && <><Button variant="outline" onClick={() => setF(null)}>{L("common.cancel", "Cancel")}</Button><Button disabled={!f.what || !f.amount} onClick={save}>{L("common.save", "Save")}</Button></>}>
        {f && <div className="pf-stack">
          <Field label={L("ex.cat", "Category")}><div className="pf-chips">{CATS.map((c) => <button key={c} className={`chip ${f.cat === c ? "active" : ""}`} onClick={() => setF({ ...f, cat: c })}>{L(`ex.c_${c}`, c[0].toUpperCase() + c.slice(1))}</button>)}</div></Field>
          <Field label={L("ex.what", "What")}><Input value={f.what} onChange={(e) => setF({ ...f, what: e.target.value })} /></Field>
          <Field label={L("billing.amount", "Amount")}><div className="pf-unit"><span>Rs.</span><input className="input tnum" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, "") })} /></div></Field>
          <Field label={L("billing.date", "Date")}><Input type="date" value={f.at || ""} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
          <Field label={L("ex.paidBy", "Paid by")}><Seg value={f.by} onChange={(v) => setF({ ...f, by: v })} options={["Cash", "Bank", "Fonepay", "Card"].map((x) => ({ id: x, label: x }))} /></Field>
          <label className="drop pf-drop"><input type="file" hidden accept="image/*" /><Icon name="camera" size={22} /><b>{L("ex.bill", "Photo of the bill")}</b></label>
        </div>}
      </Drawer>
    </>
  );
}

/* ───────── Stock (restaurant, bar, minibar, housekeeping) ───────── */
const STOCK = [];
export function Stock({ tenant }) {
  const L = useL();
  const toast = useToast();
  const [list, setList] = useSec(tenant.id, "stock", STOCK);
  const low = list.filter((x) => x.qty < x.min);
  const adj = (id, n) => setList((a) => { const x = a.find((y) => y.id === id); x.qty = Math.max(0, x.qty + n); });
  const [ed, setEd] = useState(null);
  const [del, setDel] = useState(null);
  const PLACES = [...new Set(["Kitchen", "Bar", "Minibar", "Housekeeping", ...list.map((x) => x.place)])];
  const blank = () => ({ name: "", place: PLACES[0], unit: "piece", qty: "", min: "", cost: "" });
  const saveItem = () => { const rec = { ...ed, qty: Number(ed.qty) || 0, min: Number(ed.min) || 0, cost: Number(ed.cost) || 0 }; setList((a) => { const i = a.findIndex((x) => x.id === rec.id); if (i >= 0) a[i] = rec; else a.unshift({ ...rec, id: `s${Date.now()}` }); }); setEd(null); toast(L("st.toastSaved", "Stock item saved")); };
  const importStock = (rows) => setList((a) => { rows.forEach((r, i) => { const x = a.find((y) => y.name.toLowerCase() === r.name.toLowerCase() && y.place === r.place); if (x) Object.assign(x, { unit: r.unit, qty: r.qty, min: r.min || x.min, cost: r.cost || x.cost }); else a.unshift({ id: `s${Date.now()}${i}`, name: r.name, place: r.place, unit: r.unit, qty: r.qty, min: r.min || 0, cost: r.cost || 0 }); }); });
  return (
    <>
      <PageHead title={L("nav.stock", "Stock")} sub={L("st.sub", "Kitchen, bar, minibar and housekeeping. POS sales take stock out automatically.")} actions={<><DataActions kind="stock" rows={list} onImport={importStock} /><LinkChip to="/business/pos" icon="store">{L("nav.pos", "POS")}</LinkChip><Button icon="plus" onClick={() => setEd(blank())}>{L("st.add", "Add item")}</Button><Button variant="outline" icon="shopping-cart" disabled={!low.length} onClick={() => toast(L("st.toastOrder", "Purchase order sent to your supplier"))}>{L("st.order", "Order low items")}</Button></>} />
      <div className="pf-stats">
        <Stat label={L("st.items", "Items")} value={list.length} note={L("st.placesN", "{n} places", { n: new Set(list.map((x) => x.place)).size })} />
        <Stat label={L("st.low", "Running low")} value={low.length} note={low.map((x) => x.name).slice(0, 2).join(", ") || "—"} tone={low.length ? "action" : undefined} noteIcon={low.length ? "circle-alert" : undefined} />
        <Stat label={L("st.value", "Stock value")} value={rs(list.reduce((s, x) => s + x.qty * x.cost, 0))} note={L("st.atCost", "At cost")} />
      </div>
      <section className="card pf-panel"><Table rows={list} minWidth={760} onRowClick={(x) => setEd({ ...x, qty: String(x.qty), min: String(x.min), cost: String(x.cost) })}
        empty={<Empty icon="package" title="No stock items yet" action={<Button icon="plus" onClick={() => setEd(blank())}>{L("st.add", "Add item")}</Button>}>Add what you keep in the kitchen, bar and store, or import a list.</Empty>} columns={[
        { key: "n", label: L("st.item", "Item"), render: (x) => <span className="pf-two"><b>{x.name}</b><small>{x.place}</small></span> },
        { key: "q", label: L("st.qty", "In stock"), render: (x) => <div className="pf-counter" onClick={(e) => e.stopPropagation()}><button onClick={() => adj(x.id, -1)} aria-label="−"><Icon name="minus" size={15} /></button><b className="tnum">{x.qty}</b><button onClick={() => adj(x.id, 1)} aria-label="+"><Icon name="plus" size={15} /></button></div> },
        { key: "u", label: L("st.unit", "Unit"), render: (x) => x.unit },
        { key: "m", label: L("st.min", "Reorder at"), num: true, align: "right", render: (x) => x.min },
        { key: "s", label: L("common.status", "Status"), render: (x) => (x.qty < x.min ? <Badge tone="action">{L("st.lowTag", "Low")}</Badge> : <Badge tone="done">{L("st.ok", "OK")}</Badge>) },
      ]} /></section>
      <Drawer open={!!ed} onClose={() => setEd(null)} title={ed?.id ? ed.name || "Edit item" : L("st.add", "Add item")}
        footer={ed && <>{ed.id && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" onClick={() => setDel(ed)}>{L("common.delete", "Delete")}</Button>}<Button variant="outline" onClick={() => setEd(null)}>{L("common.cancel", "Cancel")}</Button><Button disabled={!ed.name.trim() || !ed.unit.trim()} onClick={saveItem}>{L("common.save", "Save")}</Button></>}>
        {ed && <div className="pf-stack">
          <Field label={L("st.item", "Item")}><Input value={ed.name} onChange={(e) => setEd({ ...ed, name: e.target.value })} placeholder="Mineral water 1 L" /></Field>
          <Field label={L("st.place", "Kept in")}><div className="pf-chips">{PLACES.map((p) => <button key={p} type="button" className={`chip ${ed.place === p ? "active" : ""}`} onClick={() => setEd({ ...ed, place: p })}>{p}</button>)}</div></Field>
          <div className="pf-grid-2 tight">
            <Field label={L("st.unit", "Unit")}><Input value={ed.unit} onChange={(e) => setEd({ ...ed, unit: e.target.value })} placeholder="bottle, kg, piece" /></Field>
            <Field label={L("st.qty", "In stock")}><Input className="input tnum" inputMode="numeric" value={ed.qty} onChange={(e) => setEd({ ...ed, qty: e.target.value.replace(/\D/g, "") })} /></Field>
          </div>
          <div className="pf-grid-2 tight">
            <Field label={L("st.min", "Reorder at")} hint="Marked low below this"><Input className="input tnum" inputMode="numeric" value={ed.min} onChange={(e) => setEd({ ...ed, min: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label={L("st.cost", "Cost per unit")}><div className="pf-unit"><span>Rs.</span><input className="input tnum" inputMode="numeric" value={ed.cost} onChange={(e) => setEd({ ...ed, cost: e.target.value.replace(/\D/g, "") })} /></div></Field>
          </div>
        </div>}
      </Drawer>
      <DeleteConfirm item={del} name={del?.name} what="stock item" onClose={() => setDel(null)}
        onDelete={(x) => { setList((a) => { a.splice(a.findIndex((y) => y.id === x.id), 1); }); setEd(null); }} onRestore={(x) => setList((a) => { restoreAt(a, { ...x, qty: Number(x.qty) || 0, min: Number(x.min) || 0, cost: Number(x.cost) || 0 }, 0); })} />
    </>
  );
}

/* ───────── Agent renewals (listings about to expire) ───────── */
export function Renewals({ tenant }) {
  const L = useL();
  const toast = useToast();
  const { db, update } = useStore();
  const rows = db.listings.filter((l) => l.tenantId === tenant.id && (l.kind === "sell" || l.kind === "rentout") && l.expires).sort((a, b) => a.expires.localeCompare(b.expires));
  return (
    <section className="card pf-panel">
      <div className="pf-panel-head"><div className="pf-panel-title"><h2>{L("rn.title", "Expiring soon")}</h2><span>{L("rn.sub", "Listings go offline after 90 days unless renewed")}</span></div>
        <Button size="sm" icon="refresh-cw" onClick={() => toast(L("rn.toastAll", "All renewed for 90 days"))}>{L("rn.all", "Renew all")}</Button></div>
      <Table rows={rows} minWidth={600} columns={[
        { key: "t", label: L("listings.listing", "Listing"), render: (l) => <span className="pf-two"><b>{l.title}</b><small className="tnum">{l.id}</small></span> },
        { key: "e", label: L("rn.expires", "Expires"), num: true, render: (l) => <span className={daysFromToday(l.expires) <= 7 ? "pf-tone-action" : undefined}>{fdate(l.expires)}</span> },
        { key: "x", label: "", align: "right", render: () => <Button variant="outline" size="sm" onClick={() => toast(L("rn.toast", "Renewed for 90 days"))}>{L("rn.renew", "Renew")}</Button> },
      ]} />
    </section>
  );
}
