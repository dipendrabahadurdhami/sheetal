import React, { useMemo, useState } from "react";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { fdate, fdatetime, rs, rsShort, daysFromToday } from "@sheetal/shared/core/format";
import { Button, Drawer, Field, Input, PageHead, Panel, SearchInput, Seg, Select, Stat, StatusBadge, Table, Empty, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { BUSINESS_TYPES, roleTemplatesFor } from "@sheetal/shared/core/rbac";

export const planOf = (db, id) => db.plans.find((p) => p.id === id);
export const mrrOf = (db) => db.tenants.filter((x) => x.status === "active" || x.status === "past_due").reduce((s, x) => s + (planOf(db, x.planId)?.price || 0), 0);

export function AdminDashboard() {
  const t = useT();
  const { db } = useStore();
  const { navigate } = useRouter();
  const T = db.tenants;
  const mrr = mrrOf(db);
  const series = [...db.revenue, { m: "Mar", v: mrr }];
  const max = Math.max(...series.map((s) => s.v));
  const pct = Math.round(((mrr - series[4].v) / series[4].v) * 100);
  const types = Object.keys(BUSINESS_TYPES).map((k) => ({ k, n: T.filter((x) => x.type === k).length }));
  const attention = T.filter((x) => ["pending_verification", "past_due", "trial", "suspended"].includes(x.status));
  const recent = [...T].sort((a, b) => b.since.localeCompare(a.since)).slice(0, 5);

  return (
    <>
      <PageHead title={t("adash.title")} sub={t("adash.sub")} actions={<Button variant="outline" icon="download" onClick={() => {
        const rows = [["Business", "Type", "City", "Owner", "Plan", "Status", "Since", "Renews"], ...T.map((x) => [x.name, x.type, x.city, x.owner, planOf(db, x.planId)?.name || "", x.status, x.since, x.renews])];
        const csv = rows.map((r) => r.map((c) => '"' + String(c ?? "").split('"').join('""') + '"').join(",")).join("\r\n");
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv" })); a.download = "shetal-businesses.csv"; a.click();
      }}>{t("common.export")}</Button>} />
      <div className="pf-stats">
        <Stat to="/admin/billing" label={t("adash.mrr")} value={rsShort(mrr)} note={t("adash.mrrNote", { pct: (pct >= 0 ? "+" : "−") + Math.abs(pct) })} noteIcon={pct >= 0 ? "trending-up" : "trending-down"} />
        <Stat to="/admin/tenants" label={t("adash.active")} value={T.filter((x) => x.status === "active").length} note={t("adash.ofTotal", { n: T.length })} />
        <Stat label={t("adash.trial")} value={T.filter((x) => x.status === "trial").length} note={t("adash.trialNote")} />
        <Stat to="/admin/moderation" label={t("adash.attention")} value={attention.length - T.filter((x) => x.status === "trial").length} note={t("adash.attentionNote")} noteIcon="circle-alert" tone="action" />
      </div>
      <div className="pf-split">
        <Panel title={t("adash.revenue")} sub={t("adash.revenueSub")} className="grow">
          <div className="pf-chart" role="img" aria-label={series.map((s) => `${s.m} ${rs(s.v)}`).join(", ")}>
            {series.map((s, i) => (
              <div key={s.m} className="pf-chart-col">
                <span className="tnum">{(s.v / 1e5).toFixed(2)} L</span>
                <i style={{ height: `${Math.round((s.v / max) * 100)}%` }} className={i === series.length - 1 ? "now" : undefined} />
                <small>{s.m}</small>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title={t("adash.byType")} className="side">
          <ul className="pf-bars">
            {types.map(({ k, n }) => (
              <li key={k}><span><Icon name={BUSINESS_TYPES[k].icon} size={15} />{t(`type.${k}`)}</span><div className="bar"><i style={{ width: `${(n / T.length) * 100}%` }} /></div><b className="tnum">{n}</b></li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="pf-split">
        <Panel title={t("adash.recent")} className="grow" actions={<Link to="/admin/tenants" className="link small">{t("common.seeAll")}</Link>}>
          <Table minWidth={560} rows={recent} onRowClick={(r) => navigate(`/admin/tenants/${r.id}`)} columns={[
            { key: "name", label: t("tenants.business"), render: (r) => <TenantName r={r} /> },
            { key: "plan", label: t("tenants.plan"), render: (r) => planOf(db, r.planId)?.name },
            { key: "status", label: t("common.status"), render: (r) => <StatusBadge status={r.status} /> },
            { key: "since", label: t("tenants.since"), num: true, render: (r) => fdate(r.since) },
          ]} />
        </Panel>
        <Panel title={t("adash.needs")} className="side">
          <ul className="pf-list">
            {attention.map((x) => (
              <li key={x.id}>
                <div><b>{x.name}</b><span className="small muted">{x.status === "trial" ? t("adash.trialEnds", { d: fdate(x.renews) }) : x.status === "past_due" ? t("adash.pastDue", { d: fdate(x.renews) }) : t(`status.${x.status}`)}</span></div>
                <Button variant="outline" size="sm" onClick={() => navigate(`/admin/tenants/${x.id}`)}>{t("common.review")}</Button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

export const TenantName = ({ r }) => {
  const t = useT();
  return (
    <span className="pf-tenant">
      <span className="pf-tenant-ico"><Icon name={BUSINESS_TYPES[r.type].icon} size={16} /></span>
      <span><b>{r.name}</b><small>{t(`type.${r.type}`)}{r.tier ? ` · ${r.tier}` : ""} · {r.city}</small></span>
    </span>
  );
};

export function AdminTenants() {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const [add, setAdd] = useState(null);
  const { navigate } = useRouter();
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const rows = useMemo(() => db.tenants.filter((x) =>
    (type === "all" || x.type === type) && (status === "all" || x.status === status) &&
    `${x.name} ${x.owner} ${x.email} ${x.city} ${x.pan}`.toLowerCase().includes(q.toLowerCase())), [db.tenants, type, status, q]);
  const statuses = ["active", "trial", "past_due", "pending_verification", "suspended"];

  return (
    <>
      <PageHead title={t("tenants.title")} sub={t("tenants.sub", { n: db.tenants.length })} actions={<><DataActions kind="tenants" /><Button icon="plus" onClick={() => setAdd({ name: "", type: "hotel", city: "Kathmandu", owner: "", email: "", phone: "", pan: "" })}>{t("tenants.add")}</Button></>} />
      <Drawer open={!!add} onClose={() => setAdd(null)} title={t("tenants.add")} sub={t("addb.sub")}
        footer={<><Button variant="outline" onClick={() => setAdd(null)}>{t("common.cancel")}</Button><Button disabled={!add?.name || !add?.email} onClick={() => {
          const id = `t${db.tenants.length + 1}`; const plan = db.plans.find((p) => p.type === add.type);
          update((d) => { d.tenants.unshift({ id, ...add, planId: plan.id, status: "trial", since: "2027-03-02", renews: "2027-03-16", usage: { seats: 1 }, scopes: [add.name] }); d.tenantRoles[id] = roleTemplatesFor(add.type).map((r) => ({ ...r, id: `${id}-${r.key}` })); d.members[id] = [{ id: "m1", name: add.owner || add.name, email: add.email, phone: add.phone, roleId: `${id}-owner`, status: "invited", lastActive: "2027-03-02T10:00", scopes: "all", twofa: false }]; d.invites[id] = []; });
          setAdd(null); toast(t("addb.toast")); navigate(`/admin/tenants/${id}`); }}>{t("addb.create")}</Button></>}>
        {add && <div className="pf-stack">
          <Field label={t("tenants.type")}><div className="pf-tiles">{Object.keys(BUSINESS_TYPES).map((k) => <button key={k} className={add.type === k ? "on" : ""} onClick={() => setAdd({ ...add, type: k })}><Icon name={BUSINESS_TYPES[k].icon} size={18} /><span>{t(`type.${k}`)}</span></button>)}</div></Field>
          <Field label={t("bsettings.displayName")}><Input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
          <Field label={t("addb.city")}><div className="pf-chips">{["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan", "Lumbini"].map((c) => <button key={c} className={`chip ${add.city === c ? "active" : ""}`} onClick={() => setAdd({ ...add, city: c })}>{c}</button>)}</div></Field>
          <div className="pf-grid-2 tight"><Field label={t("tenants.owner")}><Input value={add.owner} onChange={(e) => setAdd({ ...add, owner: e.target.value })} /></Field><Field label={t("tenant.pan")}><Input className="input tnum" value={add.pan} onChange={(e) => setAdd({ ...add, pan: e.target.value.replace(/\D/g, "").slice(0, 9) })} /></Field></div>
          <div className="pf-grid-2 tight"><Field label={t("common.email")}><Input value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} /></Field><Field label={t("common.phone")}><Input className="input tnum" value={add.phone} onChange={(e) => setAdd({ ...add, phone: e.target.value })} /></Field></div>
          <p className="pf-hint"><Icon name="mail" size={13} />{t("addb.hint", { days: db.platformSettings.trialDays })}</p>
        </div>}
      </Drawer>
      <section className="card pf-panel">
        <div className="pf-toolbar">
          <Seg value={type} onChange={setType} label={t("tenants.type")} options={[{ id: "all", label: t("common.all") }, ...Object.keys(BUSINESS_TYPES).map((k) => ({ id: k, label: t(`type.${k}s`) }))]} />
          <Select value={status} onChange={setStatus} style={{ width: 210, height: 38 }} aria-label={t("common.status")} options={[{ id: "all", label: t("tenants.anyStatus") }, ...statuses.map((s) => ({ id: s, label: t(`status.${s}`) }))]} />
          <div style={{ marginLeft: "auto" }}><SearchInput value={q} onChange={setQ} placeholder={t("tenants.search")} /></div>
        </div>
        <Table rows={rows} onRowClick={(r) => navigate(`/admin/tenants/${r.id}`)} empty={<Empty title={t("tenants.none")}>{t("tenants.noneText")}</Empty>} minWidth={900} columns={[
          { key: "name", label: t("tenants.business"), render: (r) => <TenantName r={r} /> },
          { key: "owner", label: t("tenants.owner"), render: (r) => <span className="pf-two"><b>{r.owner}</b><small>{r.email}</small></span> },
          { key: "plan", label: t("tenants.plan"), render: (r) => planOf(db, r.planId)?.name },
          { key: "status", label: t("common.status"), render: (r) => <StatusBadge status={r.status} /> },
          { key: "seats", label: t("tenants.seats"), num: true, render: (r) => `${r.usage.seats} / ${planOf(db, r.planId)?.limits.seats === -1 ? "∞" : planOf(db, r.planId)?.limits.seats}` },
          { key: "mrr", label: t("tenants.mrr"), num: true, align: "right", render: (r) => (r.status === "active" || r.status === "past_due" ? rs(planOf(db, r.planId)?.price) : "—") },
          { key: "renews", label: t("tenants.renews"), num: true, render: (r) => <span className={daysFromToday(r.renews) < 0 ? "pf-tone-action" : undefined}>{fdate(r.renews)}</span> },
        ]} />
      </section>
    </>
  );
}

export function NeedsList({ items }) {
  return items.length ? <ul className="pf-list">{items}</ul> : null;
}

export const fmtWhen = fdatetime;
