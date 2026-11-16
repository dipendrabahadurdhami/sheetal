// Admin → Sales, Revenue and Billing (MB 13 and 14.3, P3-FE-4): every app sale and refund; what Sheetal earned for today, 7 days, 30 days or any
// range with the previous period's % change, by day / app / edition / method; the billing lists (VAT per Nepal month, tax invoices and credit
// notes, "not sent to IRD", refunds waiting, shadow-mode differences); CSV export of each.
// Where it fits: /admin/sales, /admin/revenue and /admin/billing-apps (AdminApp.jsx). Sales and revenue need platform.revenue.read; the billing
// lists platform.billing.read; every CSV also platform.billing.export (the server audits each export).
// How it works: GET /admin/sales, /admin/revenue, /admin/billing/vat, /admin/billing/tax-invoices, /admin/billing/ird, /admin/billing/shadow,
// /admin/refunds (BE-7). Ranges are Nepal days, worked out on the server; the screen sends only the picked range (reportsLogic.js).
// Rules: every total shown is the server's, and on a page that shows every row it is checked against the rows (a mismatch is shown, never hidden).
// The technology partner is never named here.

import React, { useEffect, useState } from "react";
import { fdate, fdatetime } from "@sheetal/shared/core/format";
import { Badge, Button, Empty, Field, Input, PageHead, Panel, Seg, Stat, Table, Tabs, Textarea, Drawer, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { adminApi, adminDownload } from "../api";
import { rsPaisa } from "./pricingLogic";
import { changeLabel, customOk, nepalToday, RANGES, rangeQuery, totalsMatch } from "./reportsLogic";

/** Today / 7 days / 30 days / Custom, with two Nepal dates for Custom. Calls onChange only with a usable range. */
export function RangePicker({ value, onChange }) {
  const [from, setFrom] = useState(value.from || nepalToday());
  const [to, setTo] = useState(value.to || nepalToday());
  return (
    <div className="pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
      <Seg label="Range (Nepal time)" value={value.range} onChange={(range) => (range === "custom" ? onChange({ range, from, to }) : onChange({ range }))} options={RANGES} />
      {value.range === "custom" && <>
        <Input type="date" aria-label="From (Nepal date)" value={from} onChange={(e) => { setFrom(e.target.value); if (customOk(e.target.value, to)) onChange({ range: "custom", from: e.target.value, to }); }} style={{ width: 160 }} />
        <Input type="date" aria-label="To (Nepal date)" value={to} onChange={(e) => { setTo(e.target.value); if (customOk(from, e.target.value)) onChange({ range: "custom", from, to: e.target.value }); }} style={{ width: 160 }} />
        {!customOk(from, to) && <span className="pf-hint pf-tone-problem" role="alert">Pick a start on or before the end, at most a year apart.</span>}
      </>}
    </div>
  );
}

function CsvButton({ path, name }) {
  const toast = useToast();
  return <Button variant="outline" size="sm" icon="download" onClick={() => adminDownload(path, name).then(() => toast("Exported. The export is in the audit log.")).catch((e) => toast(e.message))}>CSV</Button>;
}

const useReport = (path, deps) => {
  const toast = useToast();
  const [res, setRes] = useState(null);
  useEffect(() => { let live = true; setRes(null); adminApi("GET", path).then((r) => { if (live) setRes(r); }).catch((e) => { if (live) { setRes({ error: e.message }); toast(e.message); } }); return () => { live = false; }; }, deps);
  return res;
};

const MONEY_KEYS = ["grossPaisa", "vatPaisa", "netPaisa", "commissionPaisa", "sheetalNetPaisa"];

export function Sales() {
  const [r, setR] = useState({ range: "30d" });
  const [page, setPage] = useState(1);
  const q = rangeQuery(r, { page });
  const res = useReport(`/admin/sales${q}`, [q]);
  const rows = res?.data || [];
  const allShown = res?.meta && res.meta.last_page === 1;
  return (
    <>
      <PageHead title="Sales" sub="Every app sale and refund, in Nepal time. Test payments never appear." actions={<CsvButton path={`/admin/sales${rangeQuery(r, {}, "csv")}`} name="sheetal-sales.csv" />} />
      <Panel pad><RangePicker value={r} onChange={(v) => { setR(v); setPage(1); }} /></Panel>
      {res?.totals && <div className="pf-stats">
        <Stat label="Sales (with VAT)" value={rsPaisa(res.totals.grossPaisa)} note={`${res.totals.rows} lines · ${res.from} to ${res.to}`} />
        <Stat label="VAT" value={rsPaisa(res.totals.vatPaisa)} />
        <Stat label="Commission" value={rsPaisa(res.totals.commissionPaisa)} />
        <Stat label="Sheetal net" value={rsPaisa(res.totals.sheetalNetPaisa)} />
      </div>}
      {allShown && res?.totals && !totalsMatch(rows, res.totals, MONEY_KEYS) && <p className="pf-hint pf-tone-problem" role="alert"><Icon name="circle-alert" size={13} />The totals don't equal the rows. Please tell the developer.</p>}
      <Panel>
        {!res ? <p className="muted pf-pad">Loading sales…</p> : (
          <Table rows={rows} minWidth={980} empty={<Empty icon="receipt" title="No sales in this range" />} columns={[
            { key: "d", label: "Paid", num: true, render: (x) => fdatetime(x.paidAt) },
            { key: "b", label: "Business", render: (x) => x.business || x.tenantId },
            { key: "n", label: "Invoice", render: (x) => x.number || "—" },
            { key: "a", label: "App", render: (x) => <span className="pf-two"><b>{x.appId || "business"}</b><small>{x.editionId || ""}</small></span> },
            { key: "k", label: "Kind", render: (x) => <Badge tone={x.kind === "refund" ? "action" : "done"}>{x.kind === "refund" ? "Refund" : x.saleType}</Badge> },
            { key: "m", label: "Method", render: (x) => x.method },
            { key: "g", label: "Gross", num: true, align: "right", render: (x) => rsPaisa(x.grossPaisa) },
            { key: "c", label: "Commission", num: true, align: "right", render: (x) => `${rsPaisa(x.commissionPaisa)} (${x.commissionPct}%)` },
            { key: "s", label: "Sheetal net", num: true, align: "right", render: (x) => rsPaisa(x.sheetalNetPaisa) },
          ]} />
        )}
        {res?.meta?.last_page > 1 && <div className="pf-row-actions pf-pad" style={{ justifyContent: "flex-end" }}>
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="small muted">Page {page} of {res.meta.last_page}</span>
          <Button size="sm" variant="ghost" disabled={page >= res.meta.last_page} onClick={() => setPage(page + 1)}>Next</Button>
        </div>}
      </Panel>
    </>
  );
}

export function Revenue() {
  const [r, setR] = useState({ range: "30d" });
  const [by, setBy] = useState("byDay");
  const q = rangeQuery(r);
  const res = useReport(`/admin/revenue${q}`, [q]);
  const d = res?.data;
  const rows = d ? d[by] : [];
  const stat = (label, k) => <Stat label={label} value={rsPaisa(d.totals[k])} note={`${changeLabel(d.changePct[k])} vs ${d.previousFrom} – ${d.previousTo}`} />;
  return (
    <>
      <PageHead title="Revenue" sub="What Sheetal earned from apps, compared with the period just before. Nepal time." actions={<CsvButton path={`/admin/revenue${rangeQuery(r, {}, "csv")}`} name="sheetal-app-revenue.csv" />} />
      <Panel pad><RangePicker value={r} onChange={setR} /></Panel>
      {!d ? <p className="muted pf-pad">Loading revenue…</p> : <>
        <div className="pf-stats">
          {stat("Sales (with VAT)", "grossPaisa")}{stat("Refunds", "refundsPaisa")}{stat("Commission", "commissionPaisa")}{stat("Sheetal net", "sheetalNetPaisa")}
        </div>
        <div className="pf-stats">
          {stat("New sales", "newSalesPaisa")}{stat("Renewals", "renewalsPaisa")}{stat("Upgrades", "upgradesPaisa")}{stat("Add-ons", "addonsPaisa")}
        </div>
        <div className="pf-stats">
          <Stat label="Monthly recurring (MRR, without VAT)" value={rsPaisa(d.mrrPaisa)} />
          <Stat label="Trials started / converted" value={`${d.trialsStarted} / ${d.trialsConverted}`} />
          <Stat label="Lapsed" value={String(d.lapsed)} />
        </div>
        <Panel title={`${d.from} to ${d.to} (${d.days} days)`} actions={<Tabs value={by} onChange={setBy} tabs={[{ id: "byDay", label: "By day" }, { id: "byApp", label: "By app" }, { id: "byEdition", label: "By edition" }, { id: "byMethod", label: "By method" }]} />}>
          <Table rows={rows} rowKey="key" minWidth={760} empty={<Empty icon="chart-column" title="No sales in this range" />} columns={[
            { key: "k", label: by === "byDay" ? "Day" : by === "byApp" ? "App" : by === "byEdition" ? "Edition" : "Method", render: (x) => x.key },
            { key: "n", label: "Sales", num: true, render: (x) => x.totals.count },
            { key: "g", label: "Gross", num: true, align: "right", render: (x) => rsPaisa(x.totals.grossPaisa) },
            { key: "r", label: "Refunds", num: true, align: "right", render: (x) => rsPaisa(x.totals.refundsPaisa) },
            { key: "c", label: "Commission", num: true, align: "right", render: (x) => rsPaisa(x.totals.commissionPaisa) },
            { key: "s", label: "Sheetal net", num: true, align: "right", render: (x) => rsPaisa(x.totals.sheetalNetPaisa) },
          ]} />
          {rows.length > 0 && !totalsMatch(rows.map((x) => x.totals), d.totals, ["grossPaisa", "commissionPaisa", "sheetalNetPaisa"]) && <p className="pf-hint pf-tone-problem pf-pad" role="alert">The totals don't equal the rows. Please tell the developer.</p>}
        </Panel>
      </>}
    </>
  );
}

export function BillingV3() {
  const [tab, setTab] = useState("vat");
  const [r, setR] = useState({ range: "30d" });
  return (
    <>
      <PageHead title="App billing" sub="VAT, tax invoices and credit notes, the IRD list, refunds and the shadow check, for app sales." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "vat", label: "VAT" }, { id: "invoices", label: "Tax invoices" }, { id: "ird", label: "Not sent to IRD" }, { id: "refunds", label: "Refunds" }, { id: "shadow", label: "Shadow check" }]} />
      {(tab === "vat" || tab === "invoices") && <Panel pad><RangePicker value={r} onChange={setR} /></Panel>}
      {tab === "vat" && <VatTab r={r} />}
      {tab === "invoices" && <InvoicesTab r={r} />}
      {tab === "ird" && <IrdTab />}
      {tab === "refunds" && <RefundsTab />}
      {tab === "shadow" && <ShadowTab />}
    </>
  );
}

function VatTab({ r }) {
  const q = rangeQuery(r);
  const res = useReport(`/admin/billing/vat${q}`, [q]);
  return (
    <Panel title="VAT per Nepal month" actions={<CsvButton path={`/admin/billing/vat${rangeQuery(r, {}, "csv")}`} name="sheetal-vat.csv" />}>
      {!res ? <p className="muted pf-pad">Loading…</p> : <Table rows={res.data || []} rowKey="month" minWidth={820} empty={<Empty icon="receipt" title="No tax invoices in this range" />} columns={[
        { key: "m", label: "Month", render: (x) => x.month },
        { key: "i", label: "Invoices", num: true, render: (x) => x.invoices },
        { key: "t", label: "Taxable", num: true, align: "right", render: (x) => rsPaisa(x.taxablePaisa) },
        { key: "v", label: "VAT", num: true, align: "right", render: (x) => rsPaisa(x.vatPaisa) },
        { key: "c", label: "Credit notes", num: true, render: (x) => x.creditNotes },
        { key: "cv", label: "Credit VAT", num: true, align: "right", render: (x) => rsPaisa(x.creditVatPaisa) },
        { key: "n", label: "VAT to pay", num: true, align: "right", render: (x) => <b>{rsPaisa(x.netVatPaisa)}</b> },
      ]} />}
    </Panel>
  );
}

function InvoicesTab({ r }) {
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(1);
  const q = rangeQuery(r, { kind, page });
  const res = useReport(`/admin/billing/tax-invoices${q}`, [q]);
  return (
    <Panel title="Tax invoices and credit notes" actions={<Seg label="Kind" value={kind} onChange={(k) => { setKind(k); setPage(1); }} options={[{ id: "all", label: "All" }, { id: "subscription", label: "Invoices" }, { id: "credit", label: "Credit notes" }]} />}>
      {!res ? <p className="muted pf-pad">Loading…</p> : <Table rows={res.data || []} minWidth={760} empty={<Empty icon="receipt" title="None in this range" />} columns={[
        { key: "n", label: "Number", render: (x) => <span className="pf-two"><b className="tnum">{x.number}</b>{x.creditFor && <small>for {x.creditFor}</small>}</span> },
        { key: "b", label: "Business", render: (x) => x.business || x.tenantId },
        { key: "d", label: "Issued", num: true, render: (x) => fdate(x.issuedAt) },
        { key: "v", label: "VAT", num: true, align: "right", render: (x) => rsPaisa(x.vatPaisa) },
        { key: "t", label: "Total", num: true, align: "right", render: (x) => rsPaisa(x.totalPaisa) },
      ]} />}
      {res?.meta?.last_page > 1 && <div className="pf-row-actions pf-pad" style={{ justifyContent: "flex-end" }}>
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span className="small muted">Page {page} of {res.meta.last_page}</span>
        <Button size="sm" variant="ghost" disabled={page >= res.meta.last_page} onClick={() => setPage(page + 1)}>Next</Button></div>}
    </Panel>
  );
}

function IrdTab() {
  const res = useReport("/admin/billing/ird", []);
  return (
    <Panel title="Not sent to IRD" sub="The IRD (CBMS) link is not built yet, so every issued tax invoice is listed here. Nothing is blocked by it.">
      {!res ? <p className="muted pf-pad">Loading…</p> : <Table rows={res.data || []} minWidth={560} empty={<Empty icon="check" title="Nothing waiting" />} columns={[
        { key: "n", label: "Number", render: (x) => <b className="tnum">{x.number}</b> },
        { key: "d", label: "Issued", num: true, render: (x) => fdate(x.issuedAt) },
        { key: "t", label: "Total", num: true, align: "right", render: (x) => rsPaisa(x.totalPaisa) },
      ]} />}
    </Panel>
  );
}

function RefundsTab() {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const [sent, setSent] = useState(null);
  const [ref, setRef] = useState("");
  const res = useReport("/admin/refunds?status=all", [tick]);
  const markSent = () => adminApi("POST", `/admin/refunds/${sent.id}/sent`, { ref: ref.trim() }).then((r) => { toast(r.message || "Saved."); setSent(null); setRef(""); setTick((n) => n + 1); }).catch((e) => toast(e.message));
  return (
    <Panel title="Refunds" sub="Asked by one person, approved by another (Approvals), then the money is sent and its reference recorded.">
      {!res ? <p className="muted pf-pad">Loading…</p> : <Table rows={res.data || []} minWidth={820} empty={<Empty icon="rotate-ccw" title="No refunds" />} columns={[
        { key: "b", label: "Business", render: (x) => <span className="pf-two"><b>{x.business || "—"}</b><small>{x.invoiceNumber}{x.creditNumber ? ` → ${x.creditNumber}` : ""}</small></span> },
        { key: "a", label: "Amount", num: true, align: "right", render: (x) => (x.amountPaisa != null ? rsPaisa(x.amountPaisa) : "—") },
        { key: "w", label: "Asked", num: true, render: (x) => fdate(x.createdAt) },
        { key: "s", label: "Stage", render: (x) => <Badge tone={x.stage === "money_sent" ? "done" : x.stage === "money_to_send" || x.stage === "pending" ? "action" : "neutral"}>{x.stage.replace(/_/g, " ")}</Badge> },
        { key: "x", label: "", align: "right", render: (x) => (x.stage === "money_to_send" ? <Button size="sm" onClick={() => setSent(x)}>Money sent</Button> : x.sentRef ? <span className="small muted">ref {x.sentRef}</span> : null) },
      ]} />}
      <Drawer open={!!sent} onClose={() => setSent(null)} title="Record the money sent" footer={<><Button variant="ghost" onClick={() => setSent(null)}>Cancel</Button><Button disabled={ref.trim().length < 3} onClick={markSent}>Save</Button></>}>
        <Field label="Bank or wallet reference"><Textarea rows={2} value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)} /></Field>
      </Drawer>
    </Panel>
  );
}

function ShadowTab() {
  const res = useReport("/admin/billing/shadow?days=7", []);
  const d = res?.data;
  return (
    <Panel title="Shadow check (last 7 days)" sub="Businesses in shadow mode whose new per-app answer gave less than today's plan. It must be zero before any business moves.">
      {!d ? <p className="muted pf-pad">Loading…</p> : <>
        <div className="pf-stats pf-pad">
          <Stat label="Businesses checked" value={String(d.businesses)} />
          <Stat label="With less under apps" value={String(d.businessesWithLess)} tone={d.businessesWithLess ? "action" : undefined} />
          <Stat label="Reports" value={`${d.lessReports} less / ${d.reports}`} />
        </div>
        <Table rows={d.latest || []} rowKey="tenantId" minWidth={560} empty={<Empty icon="check" title="No differences" />} columns={[
          { key: "b", label: "Business", render: (x) => x.business || x.tenantId },
          { key: "l", label: "Less", num: true, render: (x) => x.less },
          { key: "at", label: "Last seen", num: true, render: (x) => fdatetime(x.at) },
        ]} />
      </>}
    </Panel>
  );
}
