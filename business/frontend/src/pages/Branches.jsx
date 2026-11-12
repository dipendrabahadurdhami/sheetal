// Branches, plus a few older sample screens kept here (calendar, booking and invoice forms).
// Where it fits: Settings → Branches. LiveBranches is the signed-in version (data from the business API); Branches
// and the others show sample data.
// How it works: branchesOf() gives a business's branches from the store, whichever mode the panel is in.

import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { can } from "@sheetal/shared/core/rbac";
import { TODAY, fdate, inDays, rs, rsShort } from "@sheetal/shared/core/format";
import { Badge, Button, Confirm, Drawer, Field, Input, PageHead, Panel, Seg, Select, Stat, Table, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Counter } from "./ListingWizard";
import { useOps } from "./POS";
import { LinkChip } from "@sheetal/shared/layout/Links";
import { DeleteConfirm } from "@sheetal/shared/components/Crud";
import { liveBranches } from "../live";

/* ───────── Branches ───────── */
export const branchesOf = (db, tenant) => db.branches?.[tenant.id] || tenant.scopes.map((name, i) => ({
  id: `br${i + 1}`, name, address: `${tenant.city}, Nepal`, phone: tenant.phone, pan: tenant.pan, manager: (db.members[tenant.id] || [])[Math.min(i + 1, 1)]?.name || tenant.owner,
  status: "open", receipt: `${tenant.name} · ${name}`, revenue: [312000, 96400, 74200, 58100][i] || 40000, staff: [6, 2, 2, 1][i] || 1, bank: "NIC Asia ••• 4021",
}));

export function Branches({ tenant, role }) {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const list = branchesOf(db, tenant);
  const [edit, setEdit] = useState(null);
  const [close, setClose] = useState(null);
  const [del, setDel] = useState(null);
  const plan = db.plans.find((p) => p.id === tenant.planId);
  const multi = true; // one subscription covers every branch
  const save = (next) => update((d) => { d.branches = d.branches || {}; d.branches[tenant.id] = next; d.tenants.find((x) => x.id === tenant.id).scopes = next.filter((b) => b.status === "open").map((b) => b.name); });
  const total = list.reduce((s, b) => s + b.revenue, 0);
  const manage = can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete");
  return (
    <>
      <PageHead title={t("br.title")} sub={t("br.sub")} actions={manage && <Button icon="plus" disabled={!multi && list.length >= 1} title={!multi ? t("br.planLocked") : undefined}
        onClick={() => setEdit({ id: `br${Date.now()}`, name: "", address: "", phone: tenant.phone, pan: tenant.pan, manager: tenant.owner, status: "open", receipt: tenant.name, revenue: 0, staff: 0, bank: "NIC Asia ••• 4021", isNew: true })}>{t("br.add")}</Button>} />
      {!multi && list.length <= 1 && <div className="pf-note"><Icon name="lock" size={16} />{t("br.planLocked")}</div>}
      <div className="pf-stats">
        <Stat label={t("br.count")} value={list.filter((b) => b.status === "open").length} note={t("br.closed", { n: list.filter((b) => b.status !== "open").length })} />
        <Stat label={t("br.revenue")} value={rsShort(total)} note={t("br.allBranches")} to="/business/analytics" />
        <Stat label={t("br.staff")} value={list.reduce((s, b) => s + b.staff, 0)} note={t("br.acrossAll")} to="/business/team" />
      </div>
      <div className="pf-branch-grid">
        {list.map((b) => (
          <section key={b.id} className={`card pf-branch ${b.status !== "open" ? "off" : ""}`}>
            <div className="pf-plan-top"><h3>{b.name}</h3>{b.status === "open" ? <Badge tone="done">{t("br.open")}</Badge> : <Badge tone="neutral">{t("br.closedOne")}</Badge>}</div>
            <span className="small muted"><Icon name="map-pin" size={13} /> {b.address}</span>
            <div className="pf-branch-nums">
              <div><span className="small muted">{t("br.revenue")}</span><b className="tnum">{rsShort(b.revenue)}</b></div>
              <div><span className="small muted">{t("br.share")}</span><b className="tnum">{total ? Math.round((b.revenue / total) * 100) : 0}%</b></div>
              <div><span className="small muted">{t("br.staff")}</span><b className="tnum">{b.staff}</b></div>
            </div>
            <div className="bar"><i style={{ width: `${total ? (b.revenue / total) * 100 : 0}%` }} /></div>
            <div className="pf-chips"><LinkChip to="/business/team" icon="users">{t("nav.team")}</LinkChip><LinkChip to="/business/analytics" icon="chart-column">{t("nav.analytics")}</LinkChip>{(tenant.type === "hotel" || tenant.type === "host") && <LinkChip to="/business/pos" icon="store">{t("nav.pos")}</LinkChip>}</div>
            <dl className="pf-kv"><dt>{t("br.manager")}</dt><dd>{b.manager}</dd><dt>{t("tenant.pan")}</dt><dd className="tnum">{b.pan}</dd><dt>{t("br.bank")}</dt><dd className="tnum">{b.bank}</dd></dl>
            {manage && <div className="pf-plan-foot">{b.status !== "open" && list.length > 1 && <Button variant="ghost" size="sm" icon="trash-2" onClick={() => setDel({ ...b, at: list.findIndex((x) => x.id === b.id) })}>{t("common.delete")}</Button>}<Button variant="ghost" size="sm" onClick={() => setClose(b)}>{b.status === "open" ? t("br.close") : t("br.reopen")}</Button><Button variant="outline" size="sm" icon="pencil" onClick={() => setEdit({ ...b })}>{t("common.edit")}</Button></div>}
          </section>
        ))}
      </div>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? t("br.add") : edit?.name}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>{t("common.cancel")}</Button><Button disabled={!edit?.name?.trim()} onClick={() => { const { isNew, ...b } = edit; save(isNew ? [...list, b] : list.map((x) => (x.id === b.id ? b : x))); setEdit(null); toast(t("br.toastSaved")); }}>{t("common.save")}</Button></>}>
        {edit && <div className="pf-stack">
          <Field label={t("br.name")}><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Rooftop Bar" /></Field>
          <Field label={t("bsettings.address")}><Input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
          <div className="pf-grid-2 tight">
            <Field label={t("common.phone")}><Input className="input tnum" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label={t("tenant.pan")} hint={t("br.panHint")}><Input className="input tnum" value={edit.pan} onChange={(e) => setEdit({ ...edit, pan: e.target.value })} /></Field>
          </div>
          <Field label={t("br.manager")}><Select value={edit.manager} onChange={(v) => setEdit({ ...edit, manager: v })} options={(db.members[tenant.id] || []).map((m) => ({ id: m.name, label: m.name }))} /></Field>
          <Field label={t("br.bank")} hint={t("br.bankHint")}><Input className="input tnum" value={edit.bank} onChange={(e) => setEdit({ ...edit, bank: e.target.value })} /></Field>
          <Field label={t("brand.receiptHeader")}><Input value={edit.receipt} onChange={(e) => setEdit({ ...edit, receipt: e.target.value })} /></Field>
          <ToggleRow title={t("br.ownStock")} sub={t("br.ownStockSub")} checked onChange={() => {}} />
        </div>}
      </Drawer>
      <Confirm open={!!close} onClose={() => setClose(null)} danger={close?.status === "open"} onConfirm={() => { save(list.map((x) => (x.id === close.id ? { ...x, status: x.status === "open" ? "closed" : "open" } : x))); toast(t("br.toastSaved")); }}
        title={close ? t(close.status === "open" ? "br.closeTitle" : "br.reopenTitle", { name: close.name }) : ""} confirmLabel={close?.status === "open" ? t("br.close") : t("br.reopen")}>{t("br.closeText")}</Confirm>
      <DeleteConfirm item={del} name={del?.name} what="branch" onClose={() => setDel(null)}
        onDelete={(x) => save(list.filter((y) => y.id !== x.id))}
        onRestore={({ at, ...x }) => update((d) => { const cur = branchesOf(d, d.tenants.find((y) => y.id === tenant.id)); if (cur.some((y) => y.id === x.id)) return; cur.splice(at >= 0 ? at : cur.length, 0, x); d.branches = d.branches || {}; d.branches[tenant.id] = cur; })}>
        Only closed branches can be deleted. Past sales and invoices from it stay in your reports.
      </DeleteConfirm>
    </>
  );
}

/* ───────── Calendar and rates ───────── */
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SEASONS = [];
export function Calendar({ tenant, role }) {
  const t = useT();
  const toast = useToast();
  const [ops, set] = useOps(tenant);
  const types = [...new Set(ops.rooms.map((r) => r.type))];
  const [type, setType] = useState(types.find((x) => x.includes("Deluxe")) || types[0]);
  const YEAR = Number(TODAY.slice(0, 4)); // calendar covers this year
  const [month, setMonth] = useState(Number(TODAY.slice(5, 7)) - 1);
  const [sel, setSel] = useState([]);
  const [tab, setTab] = useState("cal");
  const rooms = ops.rooms.filter((r) => r.type === type);
  const base = rooms[0]?.rate || 5000;
  const blocked = ops.blocked || {};
  const overrides = ops.rates || {};
  const days = new Date(YEAR, month + 1, 0).getDate();
  const first = new Date(YEAR, month, 1).getDay();
  const key = (d) => `${type}|${YEAR}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const iso = (d) => `${YEAR}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const priceOf = (d) => {
    if (overrides[key(d)]) return overrides[key(d)];
    const dt = new Date(YEAR, month, d); let p = base;
    if (dt.getDay() === 5 || dt.getDay() === 6) p *= 1.1;
    SEASONS.forEach((s) => { if (iso(d) >= s.from && iso(d) <= s.to) p *= 1 + s.pct / 100; });
    return Math.round(p / 50) * 50;
  };
  const sold = (d) => ops.bookings.filter((b) => b.type === type && b.from <= iso(d) && b.to > iso(d)).length;
  const edit = can(role, "hotel.calendar.update");
  const apply = (kind, v) => { set((o) => { o.blocked = o.blocked || {}; o.rates = o.rates || {}; sel.forEach((d) => { if (kind === "block") o.blocked[key(d)] = !o.blocked[key(d)]; else o.rates[key(d)] = v; }); }); toast(t(kind === "block" ? "cal.toastBlocked" : "cal.toastRate", { n: sel.length })); setSel([]); };
  return (
    <>
      <PageHead title={t("nav.calendar")} sub={t("cal.sub")} actions={<><LinkChip to="/business/bookings" icon="clipboard-list">{t("nav.bookings")}</LinkChip><LinkChip to="/business/pos" icon="concierge-bell">{t("pos.front")}</LinkChip><Seg value={tab} onChange={setTab} options={[{ id: "cal", label: t("cal.calendar"), icon: "calendar-days" }, { id: "rules", label: t("cal.rules"), icon: "sliders-horizontal" }]} /></>} />
      {tab === "cal" && <>
        <div className="pf-toolbar card" style={{ borderRadius: "var(--r)" }}>
          <Select value={type} onChange={(v) => { setType(v); setSel([]); }} options={types.map((x) => ({ id: x, label: `${x} · ${ops.rooms.filter((r) => r.type === x).length}` }))} style={{ width: 240, height: 38 }} aria-label={t("an.roomType")} />
          <div className="pf-row-actions" style={{ marginLeft: "auto" }}>
            <button className="btn btn-ghost btn-icon" aria-label="prev" disabled={month === 0} onClick={() => setMonth(month - 1)}><Icon name="chevron-left" size={18} /></button>
            <b className="tnum" style={{ minWidth: 130, textAlign: "center" }}>{MONTH[month]} {YEAR}</b>
            <button className="btn btn-ghost btn-icon" aria-label="next" disabled={month === 11} onClick={() => setMonth(month + 1)}><Icon name="chevron-right" size={18} /></button>
          </div>
        </div>
        <div className="pf-split">
          <section className="card pf-panel grow"><div className="pf-pad">
            <div className="pf-cal-head">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <span key={d}>{d}</span>)}</div>
            <div className="pf-cal">
              {Array.from({ length: first }, (_, i) => <span key={`e${i}`} />)}
              {Array.from({ length: days }, (_, i) => {
                const d = i + 1; const b = blocked[key(d)]; const s = sold(d); const on = sel.includes(d); const left = rooms.length - s;
                return (
                  <button key={d} className={`pf-cal-day ${b ? "blocked" : ""} ${on ? "on" : ""} ${left === 0 ? "full" : ""}`} aria-pressed={on} aria-label={`${d} ${MONTH[month]}: ${b ? t("cal.blocked") : `${rs(priceOf(d))}, ${left} ${t("cal.left")}`}`}
                    onClick={() => edit && setSel(on ? sel.filter((x) => x !== d) : [...sel, d])}>
                    <b className="tnum">{d}</b>
                    {b ? <small>{t("cal.blocked")}</small> : <><span className="tnum">{(priceOf(d) / 1000).toFixed(1)}k</span><small className="tnum">{left ? t("cal.nLeft", { n: left }) : t("cal.full")}</small></>}
                  </button>
                );
              })}
            </div>
          </div></section>
          <Panel title={sel.length ? t("cal.selected", { n: sel.length }) : t("cal.pickDays")} sub={sel.length ? sel.map((d) => d).join(", ") + ` ${MONTH[month].slice(0, 3)}` : t("cal.pickHint")} className="side" pad>
            <div className="pf-stack">
              <Field label={t("cal.setPrice")}><div className="pf-chips">{[0.9, 1, 1.2, 1.5].map((f) => <button key={f} className="chip" disabled={!sel.length} onClick={() => apply("rate", Math.round((base * f) / 50) * 50)}>{rs(Math.round((base * f) / 50) * 50)}</button>)}</div></Field>
              <Button variant="outline" icon="ban" disabled={!sel.length} onClick={() => apply("block")}>{t("cal.blockToggle")}</Button>
              <div className="pf-cal-legend"><span><i className="a" />{t("cal.lgOpen")}</span><span><i className="b" />{t("cal.lgFull")}</span><span><i className="c" />{t("cal.blocked")}</span></div>
              <p className="pf-hint"><Icon name="refresh-cw" size={13} />{t("cal.syncNote")}</p>
            </div>
          </Panel>
        </div>
      </>}
      {tab === "rules" && <div className="pf-split">
        <Panel title={t("cal.seasons")} sub={t("cal.seasonsSub")} className="grow"><Table rows={SEASONS} minWidth={520} columns={[
          { key: "n", label: t("cal.season"), render: (s) => <b className="pf-strong">{s.name}</b> },
          { key: "d", label: t("hr.dates"), num: true, render: (s) => `${fdate(s.from)} – ${fdate(s.to)}` },
          { key: "p", label: t("cal.change"), num: true, align: "right", render: (s) => `+${s.pct}%` },
        ]} /></Panel>
        <Panel title={t("cal.stayRules")} className="side" pad><div className="pf-stack">
          <Field label={t("cal.minNights")}><Counter value={2} min={1} max={30} onChange={() => {}} label={t("cal.minNights")} /></Field>
          <Field label={t("cal.weekend")}><Seg value="10" onChange={() => {}} options={["0", "10", "20"].map((x) => ({ id: x, label: `+${x}%` }))} /></Field>
          <Field label={t("cal.cutoff")}><Seg value="14" onChange={() => {}} options={["12", "14", "18", "22"].map((x) => ({ id: x, label: `${x}:00` }))} /></Field>
          <ToggleRow title={t("cal.buffer")} sub={t("cal.bufferSub")} checked={false} onChange={() => {}} />
          <ToggleRow title={t("cal.lastMinute")} sub={t("cal.lastMinuteSub")} checked onChange={() => {}} />
        </div></Panel>
      </div>}
    </>
  );
}

/* ───────── Manual booking form ───────── */
export function BookingForm({ tenant, open, onClose }) {
  const t = useT();
  const toast = useToast();
  const [ops, set] = useOps(tenant);
  const types = [...new Set(ops.rooms.map((r) => r.type))];
  const [f, setF] = useState({ guest: "", phone: "", type: types[0], nights: 2, adults: 2, children: 0, source: "walkin", pay: "advance", from: inDays(0) });
  const rate = ops.rooms.find((r) => r.type === f.type)?.rate || 5000;
  const total = Math.round(rate * f.nights * 1.243);
  const freeRoom = ops.rooms.find((r) => r.type === f.type && r.status === "vacant")?.no || ops.rooms.find((r) => r.type === f.type)?.no;
  const save = () => {
    set((o) => { o.bookings.unshift({ id: `BK-${TODAY.slice(0, 4)}-${String(o.bookings.length + 1).padStart(4, "0")}`, guest: f.guest || "Walk-in guest", phone: f.phone, room: freeRoom, type: f.type, from: f.from, to: new Date(new Date(f.from).getTime() + f.nights * 864e5).toISOString().slice(0, 10), amount: total, paid: f.pay === "full" ? total : f.pay === "advance" ? Math.round(total * 0.3) : 0, status: "confirmed", source: f.source }); });
    toast(t("bkf.toastSaved")); onClose();
  };
  return (
    <Drawer open={open} onClose={onClose} title={t("bk.manual")} sub={t("bkf.sub")}
      footer={<><span className="small muted tnum" style={{ marginRight: "auto" }}>{t("pos.total")}: <b className="pf-strong">{rs(total)}</b></span><Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button><Button icon="check" onClick={save}>{t("bkf.save")}</Button></>}>
      <div className="pf-stack">
        <div className="pf-grid-2 tight"><Field label={t("bk.guest")}><Input value={f.guest} onChange={(e) => setF({ ...f, guest: e.target.value })} placeholder="Full name" /></Field><Field label={t("common.phone")}><Input className="input tnum" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="98XXXXXXXX" /></Field></div>
        <Field label={t("an.roomType")}><div className="pf-chips">{types.map((x) => <button key={x} className={`chip ${f.type === x ? "active" : ""}`} onClick={() => setF({ ...f, type: x })}>{x}</button>)}</div></Field>
        <Field label={t("hr.start")}><div className="pf-chips">{[[inDays(0), "Today"], [inDays(1), "Tomorrow"], [inDays(2), fdate(inDays(2))], [inDays(7), fdate(inDays(7))]].map(([d, l]) => <button key={d} className={`chip ${f.from === d ? "active" : ""}`} onClick={() => setF({ ...f, from: d })}>{l}</button>)}</div></Field>
        <div className="pf-grid-2 tight">
          <Field label={t("bkf.nights")}><Counter value={f.nights} min={1} max={60} onChange={(n) => setF({ ...f, nights: n })} label={t("bkf.nights")} /></Field>
          <Field label={t("room.guests")}><Counter value={f.adults} min={1} max={12} onChange={(n) => setF({ ...f, adults: n })} label={t("room.guests")} /></Field>
        </div>
        <Field label={t("bkf.source")}><Seg value={f.source} onChange={(v) => setF({ ...f, source: v })} options={["walkin", "direct", "booking", "airbnb"].map((s) => ({ id: s, label: t(`src.${s}`) }))} /></Field>
        <Field label={t("bkf.payment")}><Seg value={f.pay} onChange={(v) => setF({ ...f, pay: v })} options={[{ id: "full", label: t("bkf.full") }, { id: "advance", label: t("bkf.advance") }, { id: "later", label: t("bkf.later") }]} /></Field>
        <div className="pf-note"><Icon name="bed-double" size={16} />{t("bkf.room", { no: freeRoom, rate: rs(rate) })}</div>
      </div>
    </Drawer>
  );
}

/* ───────── New invoice form ───────── */
export function InvoiceForm({ open, onClose }) {
  const t = useT();
  const toast = useToast();
  const [lines, setLines] = useState([{ what: "Room night", qty: 2, rate: 6500 }]);
  const [to, setTo] = useState("");
  const [vat, setVat] = useState(true);
  const sub = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const tax = vat ? Math.round(sub * 0.13) : 0;
  return (
    <Drawer open={open} onClose={onClose} title={t("binv.new")}
      footer={<><span className="small muted tnum" style={{ marginRight: "auto" }}>{t("pos.total")}: <b className="pf-strong">{rs(sub + tax)}</b></span><Button variant="outline" onClick={() => { toast(t("wiz.toastDraft")); onClose(); }}>{t("wiz.saveDraft")}</Button><Button icon="send" onClick={() => { toast(t("binvf.toastSent")); onClose(); }}>{t("binvf.send")}</Button></>}>
      <div className="pf-stack">
        <Field label={t("binv.billedTo")}><Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Name or company, PAN if any" /></Field>
        {lines.map((l, i) => (
          <div key={i} className="pf-repeat">
            <div className="pf-repeat-head"><b>{t("binvf.line", { n: i + 1 })}</b>{lines.length > 1 && <button className="btn btn-ghost btn-sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="trash-2" size={14} />{t("common.delete")}</button>}</div>
            <div className="pf-chips">{["Room night", "Breakfast", "Airport pickup", "Service fee", "Consultation"].map((x) => <button key={x} className={`chip ${l.what === x ? "active" : ""}`} onClick={() => setLines(lines.map((y, j) => (j === i ? { ...y, what: x } : y)))}>{x}</button>)}</div>
            <div className="pf-grid-2 tight"><Field label={t("binvf.qty")}><Counter value={l.qty} min={1} max={99} onChange={(n) => setLines(lines.map((y, j) => (j === i ? { ...y, qty: n } : y)))} label={t("binvf.qty")} /></Field>
              <Field label={t("binvf.rate")}><Input className="input tnum" value={l.rate} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, rate: Number(e.target.value.replace(/\D/g, "")) } : y)))} /></Field></div>
          </div>
        ))}
        <Button variant="outline" icon="plus" onClick={() => setLines([...lines, { what: "Service fee", qty: 1, rate: 1000 }])}>{t("binvf.addLine")}</Button>
        <ToggleRow title={t("pos.vat")} checked={vat} onChange={setVat} />
        <div className="pf-totals"><div><span>{t("pos.subtotal")}</span><span className="tnum">{rs(sub)}</span></div><div><span>{t("pos.vat")}</span><span className="tnum">{rs(tax)}</span></div><div className="total"><span>{t("pos.total")}</span><span className="tnum">{rs(sub + tax)}</span></div></div>
      </div>
    </Drawer>
  );
}

/* ───────── Branches of a signed-in business (from the API) ───────── */
export function LiveBranches({ tenant, role }) {
  const t = useT();
  const { db } = useStore();
  const toast = useToast();
  const api = liveBranches(toast);
  const list = db.branches?.[tenant.id] || [];
  const [edit, setEdit] = useState(null);
  const [close, setClose] = useState(null);
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const manage = can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete");
  const stays = tenant.type === "hotel" || tenant.type === "host";
  const people = (db.members[tenant.id] || []).filter((m) => m.status === "active");
  const act = async (p, done) => { setBusy(true); try { await p; done?.(); } catch { /* the toast says why */ } finally { setBusy(false); } };
  return (
    <>
      <PageHead title={t("br.title")} sub="Your outlets, offices or sites. On the Team page, give each person all branches or just theirs: they then see only those branches' work."
        actions={manage && <Button icon="plus" onClick={() => setEdit({ name: "", address: "", phone: tenant.phone || "", manager: "", receipt: tenant.name, isNew: true })}>{t("br.add")}</Button>} />
      <div className="pf-stats">
        <Stat label={t("br.count")} value={list.filter((b) => b.status === "open").length} note={t("br.closed", { n: list.filter((b) => b.status !== "open").length })} />
        <Stat label={t("br.staff")} value={people.length} note="People in the business" to="/business/team" />
        {stays && <Stat label="Rooms" value={list.reduce((n, b) => n + (b.rooms || 0), 0)} note={t("br.acrossAll")} to="/business/pos" />}
      </div>
      <div className="pf-branch-grid">
        {list.map((b) => (
          <section key={b.id} className={`card pf-branch ${b.status !== "open" ? "off" : ""}`}>
            <div className="pf-plan-top"><h3>{b.name}</h3>{b.status === "open" ? <Badge tone="done">{t("br.open")}</Badge> : <Badge tone="neutral">{t("br.closedOne")}</Badge>}</div>
            <span className="small muted"><Icon name="map-pin" size={13} /> {b.address || "No address yet"}</span>
            <div className="pf-branch-nums">
              <div><span className="small muted">{t("br.staff")}</span><b className="tnum">{b.staff}</b></div>
              {stays && <div><span className="small muted">Rooms</span><b className="tnum">{b.rooms}</b></div>}
            </div>
            <dl className="pf-kv"><dt>{t("br.manager")}</dt><dd>{b.manager || "—"}</dd><dt>{t("common.phone")}</dt><dd className="tnum">{b.phone || "—"}</dd><dt>{t("brand.receiptHeader")}</dt><dd>{b.receipt || tenant.name}</dd></dl>
            <div className="pf-chips"><LinkChip to="/business/team" icon="users">{t("nav.team")}</LinkChip>{stays && <LinkChip to="/business/pos" icon="store">{t("nav.pos")}</LinkChip>}</div>
            {manage && <div className="pf-plan-foot">
              {b.status !== "open" && list.length > 1 && <Button variant="ghost" size="sm" icon="trash-2" disabled={busy} onClick={() => setDel(b)}>{t("common.delete")}</Button>}
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setClose(b)}>{b.status === "open" ? t("br.close") : t("br.reopen")}</Button>
              <Button variant="outline" size="sm" icon="pencil" disabled={busy} onClick={() => setEdit({ ...b })}>{t("common.edit")}</Button>
            </div>}
          </section>
        ))}
      </div>
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? t("br.add") : edit?.name}
        footer={<><Button variant="outline" onClick={() => setEdit(null)}>{t("common.cancel")}</Button><Button disabled={busy || (edit?.name?.trim().length || 0) < 2} onClick={() => act(edit.isNew ? api.add(edit) : api.save(edit), () => setEdit(null))}>{t("common.save")}</Button></>}>
        {edit && <div className="pf-stack">
          <Field label={t("br.name")} hint={!edit.isNew ? "Renaming also renames it in everyone's access and on rooms." : undefined}><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Pokhara Lakeside" /></Field>
          <Field label={t("bsettings.address")}><Input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
          <Field label={t("common.phone")}><Input className="input tnum" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label={t("br.manager")}><Select value={edit.manager} onChange={(v) => setEdit({ ...edit, manager: v })} options={[{ id: "", label: "Nobody yet" }, ...people.map((m) => ({ id: m.name, label: m.name }))]} /></Field>
          <Field label={t("brand.receiptHeader")}><Input value={edit.receipt} onChange={(e) => setEdit({ ...edit, receipt: e.target.value })} /></Field>
        </div>}
      </Drawer>
      <Confirm open={!!close} onClose={() => setClose(null)} danger={close?.status === "open"} onConfirm={() => act(api.setOpen(close, close.status !== "open"))}
        title={close ? t(close.status === "open" ? "br.closeTitle" : "br.reopenTitle", { name: close.name }) : ""} confirmLabel={close?.status === "open" ? t("br.close") : t("br.reopen")}>{t("br.closeText")}</Confirm>
      <Confirm open={!!del} onClose={() => setDel(null)} danger onConfirm={() => act(api.remove(del))} title={del ? `Delete ${del.name}?` : ""} confirmLabel={t("common.delete")}>
        People who also work at other branches keep those. A branch with rooms, or someone's only branch, can't be deleted.
      </Confirm>
    </>
  );
}
