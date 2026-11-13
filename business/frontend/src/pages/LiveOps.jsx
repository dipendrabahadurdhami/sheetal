// Hotel, point of sale, projects, investors and the calendar on the business API (instead of the sample screens).
// How it works: each screen loads from and saves to the API; the API keeps the rules (no double bookings, ID before
// check-in, paid before check-out, menu prices, shifts, holds, night prices and closed dates).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fdate, fdatetime, rs } from "@sheetal/shared/core/format";
import { can } from "@sheetal/shared/core/rbac";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Select, Stat, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";
import { useBranch } from "@sheetal/shared/core/branch";

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const ROOM_TONE = { vacant: "done", arriving: "action", occupied: "progress", dirty: "problem", blocked: "neutral" };
const BK_TONE = { requested: "action", confirmed: "done", checked_in: "progress", completed: "neutral", cancelled: "problem" };
const BK_WORD = { requested: "Requested", confirmed: "Confirmed", checked_in: "In house", completed: "Checked out", cancelled: "Cancelled" };
const PAY = [["cash", "Cash"], ["fonepay", "Fonepay"], ["card", "Card"], ["esewa", "eSewa"], ["khalti", "Khalti"], ["bank", "Bank"]];

function useApi(path, deps = []) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { let gone = false; bizApi("GET", path).then((r) => !gone && setData(r.data)).catch((e) => { if (!gone) { setData(null); toast(e.message); } }); return () => { gone = true; }; }, [path, tick, ...deps]);
  return [data, useCallback(() => setTick((n) => n + 1), [])];
}
const run = (toast, p, after) => p.then((r) => { if (r?.message) toast(r.message); after?.(r); return r; }).catch((e) => { toast(e.message); throw e; });

// ───── Front desk and bookings ─────
export function LiveFrontDesk({ tenant, role }) {
  const toast = useToast();
  const [rooms, reloadRooms] = useApi("/rooms", [tenant.id]);
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(null);
  const types = useMemo(() => [...new Set((rooms || []).map((r) => r.type))], [rooms]);
  if (!rooms) return <p className="muted pf-pad">Loading rooms…</p>;
  const count = (s) => rooms.filter((r) => r.status === s).length;
  return (
    <>
      <div className="pf-stats">
        <Stat label="Vacant" value={count("vacant")} /><Stat label="Arriving today" value={count("arriving")} /><Stat label="In house" value={count("occupied")} /><Stat label="To clean" value={count("dirty")} tone={count("dirty") ? "action" : undefined} />
      </div>
      <Panel title="Rooms" sub="Tap a room to check in, add to the bill, take payment or check out." actions={can(role, "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete") && <Button icon="plus" onClick={() => setAdding({ type: types[0] || "Deluxe", rate: 5000, nos: "", maxGuests: 2 })}>Add rooms</Button>}>
        {!rooms.length ? <Empty icon="bed-double" title="No rooms yet">Add your rooms with their type and nightly rate.</Empty> : (
          <div className="pf-room-grid pf-pad">{rooms.map((r) => (
            <button key={r.id} type="button" className={`card pf-room ${r.status}`} onClick={() => (r.bookingId ? setOpen(r.bookingId) : r.status === "dirty" ? run(toast, bizApi("PATCH", `/rooms/${r.id}`, { status: "vacant" }), reloadRooms) : null)}>
              <b className="tnum">{r.no}</b><Badge tone={ROOM_TONE[r.status]}>{r.status === "dirty" ? "Clean it" : r.status}</Badge>
              <span className="small muted">{r.type} · {rs(r.rate)}</span><span className="pf-room-guest">{r.guest || "—"}</span>
              {r.bill && r.bill.due > 0 && <span className="small pf-tone-action tnum">Due {rs(r.bill.due)}</span>}
            </button>))}</div>)}
      </Panel>
      <StayDrawer id={open} rooms={rooms} role={role} onClose={() => setOpen(null)} onChange={reloadRooms} />
      <Drawer open={!!adding} onClose={() => setAdding(null)} title="Add rooms" footer={adding && <><Button variant="ghost" onClick={() => setAdding(null)}>Cancel</Button><Button disabled={!adding.nos.trim()} onClick={() => run(toast, bizApi("POST", "/rooms", { type: adding.type, rate: Number(adding.rate), maxGuests: Number(adding.maxGuests), nos: adding.nos.split(/[\s,]+/).filter(Boolean) }), () => { setAdding(null); reloadRooms(); }).catch(() => {})}>Add</Button></>}>
        {adding && <div className="pf-stack">
          <Field label="Room type"><Input value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value })} /></Field>
          <div className="pf-grid-2 tight"><Field label="Rate a night (Rs.)"><Input className="input tnum" value={adding.rate} onChange={(e) => setAdding({ ...adding, rate: e.target.value.replace(/\D/g, "") })} /></Field>
            <Field label="Guests per room"><Input className="input tnum" value={adding.maxGuests} onChange={(e) => setAdding({ ...adding, maxGuests: e.target.value.replace(/\D/g, "") })} /></Field></div>
          <Field label="Room numbers" hint="Separate with commas or spaces, e.g. 101 102 103."><Input value={adding.nos} onChange={(e) => setAdding({ ...adding, nos: e.target.value })} /></Field>
        </div>}
      </Drawer>
    </>
  );
}

/** One stay: details, the room bill, and the front desk actions. */
function StayDrawer({ id, rooms, role, onClose, onChange }) {
  const toast = useToast();
  const [b, setB] = useState(null);
  const [extra, setExtra] = useState({ what: "", amount: "" });
  const [pay, setPay] = useState({ method: "cash", amount: "" });
  const [roomId, setRoomId] = useState("");
  const [idOk, setIdOk] = useState(false);
  useEffect(() => { setB(null); setIdOk(false); if (id) bizApi("GET", `/bookings/${id}`).then((r) => { setB(r.data); setRoomId(r.data.roomId || ""); setPay((p) => ({ ...p, amount: String(Math.max(0, r.data.bill.due)) })); }).catch((e) => toast(e.message)); }, [id]);
  const act = (p) => run(toast, p, (r) => { if (r.data) { setB(r.data); setPay((x) => ({ ...x, amount: String(Math.max(0, r.data.bill.due)) })); } onChange(); }).catch(() => {});
  const free = rooms.filter((r) => b && r.type === b.type && (r.status === "vacant" || r.id === b.roomId));
  return (
    <Drawer open={!!id} onClose={onClose} title={b ? `${b.code} · ${b.guest}` : "Loading…"} sub={b ? `${b.type}${b.room ? ` · room ${b.room}` : ""} · ${fdate(b.from)} – ${fdate(b.to)} (${b.nights} nights)` : ""}>
      {b && <div className="pf-stack">
        <dl className="pf-kv"><dt>Status</dt><dd><Badge tone={BK_TONE[b.status]}>{BK_WORD[b.status]}</Badge></dd><dt>Phone</dt><dd className="tnum">{b.phone || "—"}</dd><dt>Guests</dt><dd>{b.adults} adults{b.children ? `, ${b.children} children` : ""}</dd><dt>Came from</dt><dd>{b.source}</dd></dl>
        {(b.status === "confirmed" || b.status === "requested") && <Panel title="Check in" pad><div className="pf-stack">
          <Field label="Room"><Select value={roomId} onChange={setRoomId} options={[{ id: "", label: "Choose…" }, ...free.map((r) => ({ id: r.id, label: `${r.no} (${r.status})` }))]} /></Field>
          <ToggleRow title="I have seen the guest's ID" sub="Citizenship, passport or driving licence. Required by law." checked={idOk} onChange={setIdOk} />
          <Button icon="log-in" disabled={!roomId || !idOk} onClick={() => act(bizApi("POST", `/bookings/${b.id}/check-in`, { roomId, idChecked: true }))}>Check in</Button>
          {can(role, "hotel.booking.cancel") && <Button variant="outline" className="pf-danger" onClick={() => window.confirm("Cancel this booking?") && act(bizApi("PATCH", `/bookings/${b.id}`, { status: "cancelled" }))}>Cancel booking</Button>}
        </div></Panel>}
        <Panel title="Room bill">
          <ul className="pf-list">{b.folio.map((l) => <li key={l.id}><span style={{ flex: 1 }}>{l.what}<small className="muted tnum"> · {fdatetime(l.at)}</small></span><b className="tnum">{rs(l.amount)}</b></li>)}
            {!b.folio.length && <li className="muted">Nothing yet. Room nights are added at check-in.</li>}</ul>
          <dl className="pf-kv pf-pad"><dt>Service 10%</dt><dd className="tnum">{rs(b.bill.service)}</dd><dt>VAT 13%</dt><dd className="tnum">{rs(b.bill.vat)}</dd><dt>Total</dt><dd className="tnum"><b>{rs(b.bill.total)}</b></dd><dt>Paid</dt><dd className="tnum">{rs(b.bill.paid)}</dd><dt>To pay</dt><dd className="tnum"><b>{rs(b.bill.due)}</b></dd></dl>
        </Panel>
        {b.status === "checked_in" && <>
          <div className="pf-row-actions"><Input placeholder="Extra, e.g. Laundry" value={extra.what} onChange={(e) => setExtra({ ...extra, what: e.target.value })} /><Input className="input tnum" placeholder="Rs." style={{ width: 110 }} value={extra.amount} onChange={(e) => setExtra({ ...extra, amount: e.target.value.replace(/\D/g, "") })} />
            <Button variant="outline" disabled={!extra.what || !extra.amount} onClick={() => act(bizApi("POST", `/bookings/${b.id}/folio`, { kind: "extra", what: extra.what, amount: Number(extra.amount) })).then(() => setExtra({ what: "", amount: "" }))}>Add</Button>
            {can(role, "pos.bill.discount") && <Button variant="ghost" disabled={!extra.what || !extra.amount} onClick={() => act(bizApi("POST", `/bookings/${b.id}/folio`, { kind: "discount", what: extra.what, amount: Number(extra.amount) })).then(() => setExtra({ what: "", amount: "" }))}>As discount</Button>}</div>
          <div className="pf-row-actions"><Select value={pay.method} onChange={(v) => setPay({ ...pay, method: v })} options={PAY.map(([id, label]) => ({ id, label }))} style={{ width: 130 }} />
            <Input className="input tnum" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/\D/g, "") })} style={{ width: 130 }} />
            <Button disabled={!Number(pay.amount)} onClick={() => act(bizApi("POST", `/bookings/${b.id}/payments`, { method: pay.method, amount: Number(pay.amount) }))}>Take payment</Button></div>
          <Button icon="log-out" disabled={b.bill.due > 0} title={b.bill.due > 0 ? "Settle the bill first" : undefined} onClick={() => act(bizApi("POST", `/bookings/${b.id}/check-out`)).then(onClose)}>Check out</Button>
        </>}
      </div>}
    </Drawer>
  );
}

export function LiveBookings({ tenant, role }) {
  const toast = useToast();
  const [rows, reload] = useApi("/bookings", [tenant.id]);
  const [rooms] = useApi("/rooms", [tenant.id]);
  const [tab, setTab] = useState("upcoming");
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  const [avail, setAvail] = useState(null);
  const groups = { upcoming: ["requested", "confirmed"], inhouse: ["checked_in"], past: ["completed"], cancelled: ["cancelled"] };
  const types = [...new Set((rooms || []).map((r) => r.type))];
  useEffect(() => { if (form?.from && form?.to && form.to > form.from) bizApi("GET", `/availability?from=${form.from}&to=${form.to}`).then((r) => setAvail(r.data)).catch(() => setAvail(null)); }, [form?.from, form?.to]);
  const list = (rows || []).filter((b) => groups[tab].includes(b.status));
  return (
    <>
      <PageHead title="Bookings" sub="Every stay, from the website, other sites, phone and walk-ins." actions={can(role, "hotel.booking.create") && <Button icon="plus" onClick={() => setForm({ type: types[0] || "", guest: "", phone: "", from: today(), to: plusDays(1), adults: 2, source: "direct" })}>New booking</Button>} />
      <section className="card pf-panel">
        <div className="pf-pad-x"><Tabs value={tab} onChange={setTab} tabs={Object.keys(groups).map((g) => ({ id: g, label: { upcoming: "Upcoming", inhouse: "In house", past: "Past", cancelled: "Cancelled" }[g], count: (rows || []).filter((b) => groups[g].includes(b.status)).length }))} /></div>
        {!rows ? <p className="muted pf-pad">Loading…</p> : <Table rows={list} onRowClick={(b) => setOpen(b.id)} minWidth={820} empty={<Empty icon="clipboard-list" title="No bookings here" />} columns={[
          { key: "c", label: "Booking", render: (b) => <span className="pf-two"><b className="tnum">{b.code}</b><small>{b.source}</small></span> },
          { key: "g", label: "Guest", render: (b) => <span className="pf-two"><b>{b.guest}</b><small className="tnum">{b.phone}</small></span> },
          { key: "r", label: "Room", render: (b) => <span className="pf-two"><b className="tnum">{b.room || "—"}</b><small>{b.type}</small></span> },
          { key: "d", label: "Stay", num: true, render: (b) => `${fdate(b.from)} – ${fdate(b.to)}` },
          { key: "a", label: "Amount", num: true, align: "right", render: (b) => rs(b.bill.total || b.amount) },
          { key: "s", label: "Status", render: (b) => <Badge tone={BK_TONE[b.status]}>{BK_WORD[b.status]}</Badge> },
          { key: "x", label: "", align: "right", render: (b) => b.status === "requested" && can(role, "hotel.booking.update") && <Button size="sm" onClick={(e) => { e.stopPropagation(); run(toast, bizApi("PATCH", `/bookings/${b.id}`, { status: "confirmed" }), reload).catch(() => {}); }}>Confirm</Button> },
        ]} />}
      </section>
      <StayDrawer id={open} rooms={rooms || []} role={role} onClose={() => { setOpen(null); reload(); }} onChange={reload} />
      <Drawer open={!!form} onClose={() => setForm(null)} title="New booking" footer={form && <><Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button><Button disabled={!form.type || form.guest.trim().length < 2} onClick={() => run(toast, bizApi("POST", "/bookings", { ...form, adults: Number(form.adults) || 1, email: form.email || undefined, phone: form.phone || undefined }), () => { setForm(null); reload(); }).catch(() => {})}>Book</Button></>}>
        {form && <div className="pf-stack">
          <div className="pf-grid-2 tight"><Field label="Check-in"><Input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></Field><Field label="Check-out"><Input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></Field></div>
          <Field label="Room type"><Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} options={types.map((x) => { const a = avail?.find((y) => y.type === x); return { id: x, label: a ? `${x} · ${a.free} free · ${rs(a.rate)}` : x }; })} /></Field>
          <Field label="Guest name"><Input value={form.guest} onChange={(e) => setForm({ ...form, guest: e.target.value })} /></Field>
          <div className="pf-grid-2 tight"><Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field><Field label="Adults"><Input className="input tnum" value={form.adults} onChange={(e) => setForm({ ...form, adults: e.target.value.replace(/\D/g, "") })} /></Field></div>
          <Field label="Came from"><Select value={form.source} onChange={(v) => setForm({ ...form, source: v })} options={[["direct", "Phone or our website"], ["walkin", "Walk-in"], ["shetal", "Sheetal"], ["booking", "Booking.com"], ["airbnb", "Airbnb"], ["agoda", "Agoda"]].map(([id, label]) => ({ id, label }))} /></Field>
          <Field label="Notes"><Textarea rows={2} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>}
      </Drawer>
    </>
  );
}

// ───── POS: moved to apps/pos/frontend (P2-W4) ─────
export { PosPage as LivePOS } from "@sheetal/app-pos/frontend";

// ───── Developer projects and investments: moved to apps/projects/frontend and apps/investments/frontend (P2-W3) ─────
export { ProjectsPage as LiveProjects } from "@sheetal/app-projects/frontend";
export { InvestorsPage as LiveInvestors } from "@sheetal/app-investments/frontend";

// ───── Calendar: night prices, closed dates and rules (per room type, at the branch picked at the top) ─────
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function LiveCalendar(props) {
  // Prices and closed dates belong to one branch: with several branches, pick one at the top first.
  const br = useBranch();
  if (br.branch === "all" && br.allowed.length > 1) {
    return <><PageHead title="Calendar and prices" sub="Night prices, closed dates and stay rules for each branch." /><Empty icon="map-pin" title="Pick a branch" sub="Choose a branch at the top of the page to see and change its calendar." /></>;
  }
  return <BranchCalendar {...props} />;
}

function BranchCalendar({ tenant, role }) {
  const toast = useToast();
  const now = new Date();
  const [ym, setYm] = useState([now.getFullYear(), now.getMonth()]);
  const [type, setType] = useState(null);
  const [sel, setSel] = useState([]);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const month = `${ym[0]}-${String(ym[1] + 1).padStart(2, "0")}`;
  const [cal, reload] = useApi(`/calendar?month=${month}${type ? `&type=${encodeURIComponent(type)}` : ""}`, [tenant.id]);
  const [rule, setRule] = useState(null);
  useEffect(() => { if (cal?.rule) setRule(cal.rule); }, [cal?.type, cal?.rule?.weekendPct, cal?.rule?.minNights]);
  const edit = can(role, "hotel.calendar.update");
  const act = (p) => { setBusy(true); run(toast, p, () => { setSel([]); setPrice(""); reload(); }).catch(() => {}).finally(() => setBusy(false)); };
  const setDays = (body) => act(bizApi("PUT", "/calendar/days", { type: cal.type, days: sel, ...body }));
  const go = (d) => { const m = ym[1] + d; setYm([ym[0] + Math.floor(m / 12), ((m % 12) + 12) % 12]); setSel([]); };
  if (!cal) return <p className="muted pf-pad">Loading the calendar…</p>;
  const first = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const past = (d) => d < today();
  return (
    <>
      <PageHead title="Calendar and prices" sub="Set prices for any night, close dates, and the weekend and minimum-stay rules. Bookings, availability and Booking.com / Airbnb calendars follow them." />
      {!cal.type ? <Empty icon="calendar-days" title="No rooms at this branch yet" sub="Add rooms on the front desk first, then set their prices here." /> : <>
        <div className="pf-toolbar card" style={{ borderRadius: "var(--r)" }}>
          <Select value={cal.type} onChange={(v) => { setType(v); setSel([]); }} options={cal.types.map((x) => ({ id: x.type, label: `${x.type} · ${x.rooms} room${x.rooms > 1 ? "s" : ""}` }))} style={{ width: 240, height: 38 }} aria-label="Room type" />
          <span className="small muted">Normal price {rs(cal.base)} a night{rule?.weekendPct ? ` · weekends +${rule.weekendPct}%` : ""}{rule?.minNights > 1 ? ` · at least ${rule.minNights} nights` : ""}</span>
          <div className="pf-row-actions" style={{ marginLeft: "auto" }}>
            <button className="btn btn-ghost btn-icon" aria-label="Previous month" onClick={() => go(-1)}><Icon name="chevron-left" size={18} /></button>
            <b className="tnum" style={{ minWidth: 130, textAlign: "center" }}>{MONTHS[ym[1]]} {ym[0]}</b>
            <button className="btn btn-ghost btn-icon" aria-label="Next month" onClick={() => go(1)}><Icon name="chevron-right" size={18} /></button>
          </div>
        </div>
        <div className="pf-split">
          <section className="card pf-panel grow"><div className="pf-pad">
            <div className="pf-cal-head">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <span key={d}>{d}</span>)}</div>
            <div className="pf-cal">
              {Array.from({ length: first }, (_, i) => <span key={`e${i}`} />)}
              {cal.days.map((n) => {
                const on = sel.includes(n.day);
                return (
                  <button key={n.day} type="button" disabled={!edit || past(n.day)} aria-pressed={on}
                    className={`pf-cal-day ${n.closed ? "blocked" : ""} ${on ? "on" : ""} ${n.left === 0 ? "full" : ""} ${n.override != null ? "set" : ""}`}
                    aria-label={`${n.day}: ${n.closed ? "closed" : `${rs(n.price)}, ${n.left} left`}`}
                    onClick={() => setSel(on ? sel.filter((x) => x !== n.day) : [...sel, n.day])}>
                    <b className="tnum">{Number(n.day.slice(8))}</b>
                    {n.closed ? <small>Closed</small> : <><span className="tnum">{(n.price / 1000).toFixed(1)}k</span><small className="tnum">{n.left ? `${n.left} left` : "Full"}</small></>}
                  </button>
                );
              })}
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>Tap nights to select them. A price you set is underlined; striped nights are closed.</p>
          </div></section>
          {edit && <div className="side pf-stack">
            <Panel title={sel.length ? `${sel.length} night${sel.length > 1 ? "s" : ""} selected` : "Change nights"} pad>
              {!sel.length ? <p className="small muted">Select nights in the calendar to set a price or close them.</p> : <div className="pf-stack">
                <Field label="Price a night (Rs.)"><Input className="input tnum" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} placeholder={String(cal.base)} /></Field>
                <Button disabled={busy || !price} onClick={() => setDays({ rate: Number(price) })}>Set price</Button>
                <Button variant="outline" disabled={busy} onClick={() => setDays({ rate: null })}>Back to normal price</Button>
                <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
                  <Button variant="outline" icon="ban" disabled={busy} onClick={() => setDays({ closed: true })}>Close</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setDays({ closed: false })}>Open</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setSel([])}>Clear</Button>
                </div>
              </div>}
            </Panel>
            {rule && <Panel title={`${cal.type} rules`} pad><div className="pf-stack">
              <Field label="Weekend markup (Friday and Saturday nights)">
                <div className="pf-chips">{[0, 10, 20, 30].map((x) => <button key={x} type="button" className={`chip ${rule.weekendPct === x ? "active" : ""}`} aria-pressed={rule.weekendPct === x} onClick={() => setRule({ ...rule, weekendPct: x })}>{x ? `+${x}%` : "None"}</button>)}</div>
              </Field>
              <Field label="Shortest stay (nights)"><Input className="input tnum" type="number" min={1} max={60} value={rule.minNights} onChange={(e) => setRule({ ...rule, minNights: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} /></Field>
              <Button variant="outline" disabled={busy || (rule.weekendPct === cal.rule.weekendPct && rule.minNights === cal.rule.minNights)} onClick={() => act(bizApi("PUT", "/calendar/rules", { type: cal.type, ...rule }))}>Save rules</Button>
            </div></Panel>}
          </div>}
        </div>
      </>}
    </>
  );
}
