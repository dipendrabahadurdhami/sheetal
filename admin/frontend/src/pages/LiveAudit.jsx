// Admin → Audit log on the admin API: every change made in the panels, newest first, with filters and CSV.
// Where it fits: /admin/audit when isStaffLive() (AdminApp.jsx); the sample AdminAudit stays for the demo.
// How it works: filters go to GET /admin/audit (100 a page); CSV comes from GET /admin/audit.csv with the same filters.

import React, { useEffect, useState } from "react";
import { fdatetime } from "@sheetal/shared/core/format";
import { Button, Empty, Input, PageHead, Select, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Link } from "@sheetal/shared/core/router";
import { adminApi, adminDownload } from "../api";

const KIND_LABEL = { billing: "Billing", lead: "Leads", promote: "Promote", settings: "Settings", tenant: "Businesses", staff: "Staff", listing: "Listings", form: "Forms", agreement: "Agreements", support: "Support", audit: "Audit log" };
const words = (a) => a.replace(/[._]/g, " ");

export function LiveAudit() {
  const toast = useToast();
  const [f, setF] = useState({ q: "", actorId: "", kind: "", from: "", to: "", page: 1 });
  const [d, setD] = useState(null);
  const qs = () => new URLSearchParams(Object.entries(f).filter(([, v]) => v !== "" && v !== null).map(([k, v]) => [k, String(v)])).toString();
  useEffect(() => {
    const tm = setTimeout(() => adminApi("GET", `/admin/audit?${qs()}`).then(setD).catch((e) => toast(e.message)), 250);
    return () => clearTimeout(tm);
  }, [f]);
  const set = (p) => setF((x) => ({ ...x, ...p, page: p.page ?? 1 }));
  const csv = () => adminDownload(`/admin/audit.csv?${qs()}`, `audit-log-${new Date().toISOString().slice(0, 10)}.csv`).catch((e) => toast(e.message));
  const rows = d?.data || [];
  const meta = d?.meta;
  return (
    <>
      <PageHead title="Audit log" sub="Every change made in the business and admin panels. Use it to see who did what and when."
        actions={<Button variant="outline" icon="download" disabled={!rows.length} onClick={csv}>CSV</Button>} />
      <section className="card pf-panel">
        <div className="pf-toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
          <div className="pf-search"><Icon name="search" size={15} /><input className="input" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Words in the action or target" aria-label="Search" /></div>
          <Select value={f.actorId} onChange={(v) => set({ actorId: v })} style={{ width: 180, height: 38 }} options={[{ id: "", label: "Everyone" }, ...(d?.staff || []).map((s) => ({ id: s.id, label: s.userName }))]} aria-label="Who" />
          <Select value={f.kind} onChange={(v) => set({ kind: v })} style={{ width: 170, height: 38 }} options={[{ id: "", label: "All kinds" }, ...(d?.kinds || []).map((k) => ({ id: k, label: KIND_LABEL[k] || k }))]} aria-label="Kind" />
          <Input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} aria-label="From" style={{ width: 150 }} />
          <Input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} aria-label="To" style={{ width: 150 }} />
        </div>
        {d === null ? <p className="pf-pad muted">Loading…</p> : rows.length ? (
          <ul className="pf-feed">{rows.map((a) => (
            <li key={a.id}><Icon name="history" size={16} />
              <span><b>{a.actor?.userName || "System"}</b> {words(a.action)}{a.target ? <>: <span className="muted">{a.target}</span></> : null}
                {a.tenant && <> · <Link to={`/admin/tenants/${a.tenantId}`} className="link">{a.tenant}</Link></>}
                {a.ip && <span className="tiny muted tnum"> · {a.ip}</span>}</span>
              <time className="tnum">{fdatetime(a.createdAt)}</time></li>
          ))}</ul>
        ) : <Empty icon="history" title="Nothing matches">Try fewer filters.</Empty>}
        {meta && meta.last_page > 1 && <div className="pf-row-actions" style={{ justifyContent: "space-between", padding: 12 }}>
          <span className="small muted tnum">{meta.total.toLocaleString("en-IN")} changes · page {meta.current_page} of {meta.last_page}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <Button size="sm" variant="outline" disabled={meta.current_page <= 1} onClick={() => setF((x) => ({ ...x, page: x.page - 1 }))}>Newer</Button>
            <Button size="sm" variant="outline" disabled={meta.current_page >= meta.last_page} onClick={() => setF((x) => ({ ...x, page: x.page + 1 }))}>Older</Button>
          </span>
        </div>}
      </section>
    </>
  );
}
