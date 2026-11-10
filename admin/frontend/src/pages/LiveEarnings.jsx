// Admin → Billing → Earnings on the admin API: what Sheetal earned by month (plans, add-ons, boosts, commission on payouts,
// less refunds, VAT shown on its own), by business type and the top businesses, with a CSV download.

import React, { useEffect, useMemo, useState } from "react";
import { rs } from "@sheetal/shared/core/format";
import { Panel, Select, Stat, Table, Button, useToast } from "@sheetal/shared/core/ui";
import { adminApi } from "../api";

const TYPE = { hotel: "Hotels", host: "Homestays and hosts", developer: "Developers", agency: "Agencies", sponsor: "Investment sponsors" };
const monthName = (m) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const cell = (v) => { const x = v == null ? "" : String(v); return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };

export function LiveEarnings() {
  const toast = useToast();
  const [range, setRange] = useState("12");
  const [d, setD] = useState(null);
  const q = useMemo(() => {
    const now = new Date(Date.now() + 5.75 * 3600_000); let y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
    const to = `${y}-${String(m).padStart(2, "0")}`; m -= Number(range) - 1; while (m < 1) { m += 12; y--; }
    return `from=${y}-${String(m).padStart(2, "0")}&to=${to}`;
  }, [range]);
  useEffect(() => { setD(null); adminApi("GET", `/admin/earnings?${q}`).then((r) => setD(r.data)).catch((e) => { setD(false); toast(e.message); }); }, [q]);
  const csv = () => {
    const body = [["Month", "Plans", "Add-ons", "Boosts", "Commission", "Refunds", "Earned", "VAT collected"], ...d.rows.map((r) => [r.month, r.plans, r.addons, r.boosts || 0, r.commission, r.refunds, r.total, r.vat])].map((r) => r.map(cell).join(",")).join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" })); a.download = `sheetal-earnings-${d.from}-to-${d.to}.csv`; document.body.appendChild(a); a.click(); a.remove();
  };
  if (!d) return <p className="muted pf-pad">{d === false ? "Earnings couldn't load." : "Loading…"}</p>;
  const t = d.totals;
  return (
    <>
      <div className="pf-stats">
        <Stat label="Earned" value={rs(t.total)} note={`${monthName(d.from)} – ${monthName(d.to)}, without VAT`} />
        <Stat label="Plans, add-ons and boosts" value={rs(t.plans + t.addons + (t.boosts || 0))} note={`Add-ons ${rs(t.addons)} · boosts and banners ${rs(t.boosts || 0)}${t.refunds ? ` · refunds −${rs(t.refunds)}` : ""}`} />
        <Stat label="Commission on payouts" value={rs(t.commission)} note={`${rs(d.commissionWaiting)} more in money waiting to be paid out`} />
        <Stat label="VAT collected" value={rs(t.vat)} note="Owed to the government, not earnings" />
      </div>
      <Panel title="By month" sub="Plan and add-on payments count in the month they were paid; commission when its payout is paid."
        actions={<div className="pf-row-actions"><Select value={range} onChange={setRange} style={{ width: 170 }} aria-label="Months" options={[["3", "Last 3 months"], ["6", "Last 6 months"], ["12", "Last 12 months"], ["24", "Last 24 months"]].map(([id, label]) => ({ id, label }))} /><Button variant="ghost" size="sm" icon="download" onClick={csv}>CSV</Button></div>}>
        <Table rows={d.rows} minWidth={760} columns={[
          { key: "m", label: "Month", render: (r) => monthName(r.month) },
          { key: "p", label: "Plans", num: true, align: "right", render: (r) => rs(r.plans) },
          { key: "a", label: "Add-ons", num: true, align: "right", render: (r) => rs(r.addons) },
          { key: "b", label: "Boosts and banners", num: true, align: "right", render: (r) => rs(r.boosts || 0) },
          { key: "c", label: "Commission", num: true, align: "right", render: (r) => rs(r.commission) },
          { key: "f", label: "Refunds", num: true, align: "right", render: (r) => (r.refunds ? `−${rs(r.refunds)}` : "—") },
          { key: "t", label: "Earned", num: true, align: "right", render: (r) => <b>{rs(r.total)}</b> },
          { key: "v", label: "VAT", num: true, align: "right", render: (r) => <span className="muted">{rs(r.vat)}</span> },
        ]} />
      </Panel>
      <div className="pf-split">
        <Panel title="By business type" className="grow"><Table rows={d.byType} minWidth={320} empty={<p className="pf-pad small muted">Nothing earned in these months.</p>} columns={[
          { key: "t", label: "Type", render: (r) => TYPE[r.type] || r.type }, { key: "n", label: "Earned", num: true, align: "right", render: (r) => rs(r.total) },
        ]} /></Panel>
        <Panel title="Top businesses" className="grow"><Table rows={d.top} minWidth={320} empty={<p className="pf-pad small muted">Nothing earned in these months.</p>} columns={[
          { key: "n", label: "Business", render: (r) => <span className="pf-two"><b>{r.name}</b><small>{TYPE[r.type] || r.type}</small></span> }, { key: "e", label: "Earned", num: true, align: "right", render: (r) => rs(r.total) },
        ]} /></Panel>
      </div>
    </>
  );
}
