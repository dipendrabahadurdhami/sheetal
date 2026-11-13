// Projects page (developers): units by project, holds, reservations with their payment plan and payments.
// Where it fits: Business → Projects, through LiveOps.jsx which re-exports it as LiveProjects.
// How it works: moved from business/frontend/src/pages/LiveOps.jsx (P2-W3) onto the kit (@sheetal/ui, @sheetal/sdk); the server keeps every rule.
// Rules: buttons show only for roles that may use them (the server checks again); a refund is a negative payment.

import React, { useEffect, useState } from "react";
import { fdate, fdatetime, rs } from "@sheetal/shared/core/format";
import { can } from "@sheetal/shared/core/rbac";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Select, Table, Tabs, Textarea, useToast } from "@sheetal/ui/primitives";
import { bizApi } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";

/** One GET on the kit: [data, reload]; loads again when the business, the branch picked at the top or reload() change (null while loading or after an error). */
function useApi(path) {
  const toast = useToast();
  const { data, error, refresh } = useApiGet(path);
  useEffect(() => { if (error) toast(error.message); }, [error, toast]);
  return [error ? null : data, refresh];
}
const run = (toast, p, after) => p.then((r) => { if (r?.message) toast(r.message); after?.(r); return r; }).catch((e) => { toast(e.message); throw e; });

const UNIT_TONE = { available: "done", held: "action", reserved: "progress", sold: "neutral", blocked: "problem" };
export function ProjectsPage({ tenant, role }) {
  const toast = useToast();
  const [projects, reload] = useApi("/projects");
  const [reservations, reloadRes] = useApi("/reservations");
  const [tab, setTab] = useState("units");
  const [adding, setAdding] = useState(null);
  const [reserve, setReserve] = useState(null);
  const [res, setRes] = useState(null);
  const [pay, setPay] = useState({ amount: "", method: "bank", ref: "" });
  const both = () => { reload(); reloadRes(); };
  if (!projects) return <p className="muted pf-pad">Loading projects…</p>;
  return (
    <>
      <PageHead title="Projects" sub="Units, holds, reservations and what each buyer has paid." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "units", label: "Units", icon: "layout-grid" }, { id: "reservations", label: "Reservations and collections", icon: "wallet", count: reservations?.filter((r) => r.status === "reserved").length }]} />
      {tab === "units" && (!projects.length ? <Empty icon="building-2" title="No project listings yet">Post a project from Listings first; its units are managed here.</Empty> : projects.map((p) => (
        <Panel key={p.id} title={p.title} sub={`${p.code} · ${p.summary.available} free · ${p.summary.held} held · ${p.summary.reserved} reserved · ${p.summary.sold} sold`} actions={can(role, "projects.project.read+projects.project.create+projects.project.update+projects.project.delete") && <Button size="sm" icon="plus" onClick={() => setAdding({ projectId: p.id, block: "A", type: "2BHK", price: "", nos: "" })}>Add units</Button>}>
          {!p.units.length ? <p className="muted pf-pad">No units yet.</p> : <div className="pf-room-grid pf-pad">{p.units.map((u) => (
            <button key={u.id} type="button" className={`card pf-room ${u.status}`} onClick={() => (u.status === "available" || u.status === "held") && can(role, "projects.reservation.read+projects.reservation.create+projects.reservation.update+projects.reservation.delete") && setReserve({ unit: u, buyer: "", phone: "", plan: "" })}>
              <b className="tnum">{u.block}{u.no}</b><Badge tone={UNIT_TONE[u.status]}>{u.status}</Badge><span className="small muted">{u.type}{u.sizeSqft ? ` · ${u.sizeSqft} sq ft` : ""}</span><span className="tnum small">{rs(u.price)}</span>
              {u.status === "available" && <span className="small pf-tone-action" onClick={(e) => { e.stopPropagation(); run(toast, bizApi("POST", `/units/${u.id}/hold`, { days: 3 }), reload).catch(() => {}); }}>Hold 3 days</span>}
            </button>))}</div>}
        </Panel>)))}
      {tab === "reservations" && <section className="card pf-panel">
        <Table rows={reservations || []} onRowClick={(r) => setRes(r)} minWidth={760} empty={<Empty icon="wallet" title="No reservations yet" />} columns={[
          { key: "c", label: "Reservation", render: (r) => <span className="pf-two"><b className="tnum">{r.code} · {r.unit.block}{r.unit.no}</b><small>{r.buyer}{r.phone ? ` · ${r.phone}` : ""}</small></span> },
          { key: "p", label: "Price", num: true, align: "right", render: (r) => rs(r.price) },
          { key: "d", label: "Paid", num: true, align: "right", render: (r) => rs(r.paid) },
          { key: "o", label: "Next due", render: (r) => { const n = r.plan.find((s) => !s.done); return n ? <span className={n.overdue ? "pf-tone-action" : ""}>{n.label} · {fdate(n.due)} · {rs(n.amount - n.paid)}</span> : "—"; } },
          { key: "s", label: "Status", render: (r) => <Badge tone={{ reserved: "progress", sold: "done", cancelled: "neutral" }[r.status]}>{r.status}</Badge> },
        ]} />
      </section>}
      <Drawer open={!!adding} onClose={() => setAdding(null)} title="Add units" footer={adding && <><Button variant="ghost" onClick={() => setAdding(null)}>Cancel</Button><Button disabled={!adding.nos || !adding.price} onClick={() => run(toast, bizApi("POST", `/projects/${adding.projectId}/units`, { block: adding.block, type: adding.type, sizeSqft: Number(adding.size) || undefined, price: Number(adding.price), nos: adding.nos.split(/[\s,]+/).filter(Boolean) }), () => { setAdding(null); reload(); }).catch(() => {})}>Add</Button></>}>
        {adding && <div className="pf-stack"><div className="pf-grid-2 tight"><Field label="Block"><Input value={adding.block} onChange={(e) => setAdding({ ...adding, block: e.target.value })} /></Field><Field label="Type"><Input value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value })} /></Field></div>
          <div className="pf-grid-2 tight"><Field label="Price (Rs.)"><Input className="input tnum" value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value.replace(/\D/g, "") })} /></Field><Field label="Size (sq ft)"><Input className="input tnum" value={adding.size || ""} onChange={(e) => setAdding({ ...adding, size: e.target.value.replace(/\D/g, "") })} /></Field></div>
          <Field label="Unit numbers" hint="e.g. 101 102 201 202"><Input value={adding.nos} onChange={(e) => setAdding({ ...adding, nos: e.target.value })} /></Field></div>}
      </Drawer>
      <Drawer open={!!reserve} onClose={() => setReserve(null)} title={reserve ? `Reserve ${reserve.unit.block}${reserve.unit.no}` : ""} sub={reserve ? rs(reserve.unit.price) : ""} footer={reserve && <><Button variant="ghost" onClick={() => setReserve(null)}>Cancel</Button><Button disabled={reserve.buyer.trim().length < 2} onClick={() => {
        const plan = reserve.plan.trim() ? reserve.plan.trim().split("\n").map((line) => { const [label, due, amount] = line.split(",").map((x) => x.trim()); return { label, due, amount: Number(String(amount).replace(/\D/g, "")) }; }) : [];
        run(toast, bizApi("POST", `/units/${reserve.unit.id}/reserve`, { buyer: reserve.buyer, phone: reserve.phone || undefined, plan }), () => { setReserve(null); both(); }).catch(() => {});
      }}>Reserve</Button></>}>
        {reserve && <div className="pf-stack"><Field label="Buyer"><Input value={reserve.buyer} onChange={(e) => setReserve({ ...reserve, buyer: e.target.value })} /></Field><Field label="Phone"><Input value={reserve.phone} onChange={(e) => setReserve({ ...reserve, phone: e.target.value })} /></Field>
          <Field label="Payment plan (optional)" hint="One instalment per line: label, date, amount — e.g. Booking, 2026-12-01, 2000000. They must add up to the price."><Textarea rows={4} value={reserve.plan} onChange={(e) => setReserve({ ...reserve, plan: e.target.value })} /></Field></div>}
      </Drawer>
      <Drawer open={!!res} onClose={() => setRes(null)} title={res ? `${res.code} · ${res.buyer}` : ""} sub={res ? `${res.unit.block}${res.unit.no} · ${rs(res.price)} · paid ${rs(res.paid)}` : ""}>
        {res && <div className="pf-stack">
          {res.plan.length > 0 && <ul className="pf-list">{res.plan.map((s, i) => <li key={i}><span style={{ flex: 1 }}>{s.label} · {fdate(s.due)}</span><span className="tnum">{rs(s.paid)} / {rs(s.amount)}</span><Badge tone={s.done ? "done" : s.overdue ? "problem" : "neutral"}>{s.done ? "Paid" : s.overdue ? "Overdue" : "Due"}</Badge></li>)}</ul>}
          <ul className="pf-list">{res.collections.map((c) => <li key={c.id}><span style={{ flex: 1 }}>{c.method}{c.ref ? ` · ${c.ref}` : ""}<small className="muted"> · {fdatetime(c.at)}</small></span><b className="tnum">{rs(c.amount)}</b></li>)}</ul>
          {res.status === "reserved" && can(role, "collections.payment.read+collections.payment.create") && <div className="pf-row-actions">
            <Select value={pay.method} onChange={(v) => setPay({ ...pay, method: v })} options={["bank", "cash", "cheque", "fonepay", "esewa", "khalti"].map((x) => ({ id: x, label: x }))} style={{ width: 120 }} />
            <Input className="input tnum" placeholder="Rs." value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/\D/g, "") })} style={{ width: 140 }} />
            <Input placeholder="Reference" value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} style={{ width: 140 }} />
            <Button disabled={!Number(pay.amount)} onClick={() => run(toast, bizApi("POST", `/reservations/${res.id}/collections`, { amount: Number(pay.amount), method: pay.method, ref: pay.ref || undefined }), (r) => { setRes(r.data); setPay({ amount: "", method: "bank", ref: "" }); both(); }).catch(() => {})}>Record payment</Button></div>}
          {res.status === "reserved" && can(role, "projects.reservation.read+projects.reservation.create+projects.reservation.update+projects.reservation.delete") && <Button variant="outline" className="pf-danger" onClick={() => { const note = window.prompt("Why is it cancelled?"); if (note?.trim()) run(toast, bizApi("POST", `/reservations/${res.id}/cancel`, { note }), () => { setRes(null); both(); }).catch(() => {}); }}>Cancel reservation</Button>}
        </div>}
      </Drawer>
    </>
  );
}

