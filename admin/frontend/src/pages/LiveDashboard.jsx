// Admin → Dashboard on the admin API: every number comes from GET /admin/dashboard (nothing is sample data).
// Where it fits: AdminApp.jsx shows it at /admin when isStaffLive(); the sample AdminDashboard stays for the demo.
// How it works: loads once and every minute; shows the blocks the server sent (it leaves out what the staff role may
// not open). Work waiting for staff is a list with counts, each row linking to the page that handles it.
// Rules: whole rupees; money is what Sheetal earned without VAT (same as Billing → Earnings).

import React, { useCallback, useEffect, useState } from "react";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { rs, rsShort } from "@sheetal/shared/core/format";
import { Badge, Button, Empty, PageHead, Panel, Stat } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi } from "../api";

const TYPE = { hotel: "Hotels", host: "Homestays and hosts", developer: "Developers", agency: "Agencies", sponsor: "Investment sponsors" };
const STATUS = { active: "Active", trial: "On trial", past_due: "Past due", suspended: "Suspended", cancelled: "Cancelled", pending_verification: "Waiting for verification" };
const monthName = (m) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function LiveDashboard() {
  const { navigate } = useRouter();
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => adminApi("GET", "/admin/dashboard").then((r) => { setD(r.data); setFailed(false); }).catch(() => setFailed(true)), []);
  useEffect(() => { load(); const every = setInterval(load, 60_000); return () => clearInterval(every); }, [load]);

  const head = <PageHead title="Dashboard" sub="Businesses, money and the work waiting for the team" />;
  if (!d) return <>{head}<p className="muted pf-pad">{failed ? "The dashboard couldn't load." : "Loading…"}</p>{failed && <div className="pf-pad"><Button variant="outline" onClick={load}>Try again</Button></div>}</>;

  const b = d.businesses, waiting = d.queue.reduce((n, q) => n + q.count, 0);
  const m = d.money;
  return (
    <>
      {head}
      <div className="pf-stats">
        <Stat to="/admin/billing" label="Monthly recurring revenue" value={rsShort(d.mrr.total)} note={`${d.mrr.payingBusinesses} paying ${d.mrr.payingBusinesses === 1 ? "business" : "businesses"}`} />
        <Stat to="/admin/tenants" label="Active businesses" value={b.byStatus.active || 0} note={`${b.total} in all · ${d.signups.last7} new in 7 days`} />
        <Stat to="/admin/tenants" label="Trials ending in 7 days" value={d.trialsEnding} note={`${b.byStatus.trial || 0} on trial`} tone={d.trialsEnding ? "action" : undefined} />
        <Stat to="/admin/tenants" label="Past due" value={d.pastDue} note={d.pastDue ? "Plan payment is late" : "All paid up"} noteIcon={d.pastDue ? "circle-alert" : undefined} tone={d.pastDue ? "action" : undefined} />
      </div>
      <div className="pf-split">
        <Panel title="Waiting for the team" sub={waiting ? `${waiting} to handle` : undefined} className="grow">
          {d.queue.length === 0 ? <p className="pf-pad small muted">Nothing here is yours to handle.</p> : (
            <ul className="pf-list">{d.queue.map((q) => (
              <li key={q.id}><span className="pf-li-ico"><Icon name={q.count ? "circle-alert" : "check"} size={17} /></span><div><span>{q.label}</span></div>
                {q.count ? <Badge tone="action">{q.count}</Badge> : <span className="small muted">None</span>}
                <Button variant="outline" size="sm" onClick={() => navigate(q.to)}>Open</Button></li>
            ))}</ul>
          )}
        </Panel>
        {m && <Panel title="Money this month" sub={`${monthName(d.month)}, without VAT`} className="side" actions={<Link to="/admin/earnings" className="link small">Earnings</Link>}>
          <ul className="pf-list">
            <li><div><b className="tnum">{rs(m.total)}</b><br /><span className="small muted">Earned so far</span></div></li>
            <li><div>Plans <b className="tnum">{rs(m.plans)}</b></div></li>
            <li><div>Add-ons <b className="tnum">{rs(m.addons)}</b></div></li>
            <li><div>Boosts and banners <b className="tnum">{rs(m.boosts)}</b></div></li>
            <li><div>Commission <b className="tnum">{rs(m.commission)}</b><br /><span className="small muted tnum">{rs(m.commissionWaiting)} more waiting for payouts</span></div></li>
            {m.refunds > 0 && <li><div>Refunds <b className="tnum">−{rs(m.refunds)}</b></div></li>}
          </ul>
        </Panel>}
      </div>
      <div className="pf-split">
        <Panel title="Businesses by status" className="grow" actions={<Link to="/admin/tenants" className="link small">All businesses</Link>}>
          {b.total === 0 ? <Empty icon="building-2" title="No businesses yet" action={<Button size="sm" onClick={() => navigate("/admin/tenants")}>Add a business</Button>}>Add the first one from the Businesses page.</Empty> : (
            <ul className="pf-list">{Object.entries(b.byStatus).map(([k, n]) => (
              <li key={k}><div>{STATUS[k] || k}</div><b className="tnum">{n}</b><Button variant="ghost" size="sm" onClick={() => navigate("/admin/tenants")}>View</Button></li>
            ))}</ul>
          )}
        </Panel>
        <Panel title="By type" className="side" sub={`${d.signups.last7} new in 7 days · ${d.signups.last30} in 30 days`}>
          {b.total === 0 ? <p className="pf-pad small muted">Nothing to show yet.</p> : (
            <ul className="pf-list">{Object.entries(b.byType).map(([k, n]) => (
              <li key={k}><div>{TYPE[k] || k}</div><b className="tnum">{n}</b></li>
            ))}</ul>
          )}
        </Panel>
      </div>
    </>
  );
}
