// Subscriptions: the billing page of a business on per-app billing (MB 14.1, P3-FE-1). Each app with its edition, status, next renewal,
// price and limits; the next invoice preview; invoices and credit notes (pay, view); add-ons; the price-protection card; links to AI and to
// "Download my data". Cancel, undo (resume) and remove.
// Where it fits: /business/billing (BusinessApp.jsx) shows this page when GET /entitlements says the business is on "apps"; a business on
// today's plans keeps BusinessBilling.jsx (LiveBilling, LiveAddons) unchanged.
// How it works: GET /billing/overview (subscriptions, invoices, lock), GET /marketplace (names, editions, statuses), GET /entitlements (limits)
// and GET /billing (the payment methods Sheetal has live). The next invoice is POST /subscriptions/quote with a renewal of each paid app.
// Paying an open invoice is POST /subscriptions/invoices/pay, then the gateway or the bank-transfer receipt form (LiveBilling.jsx).
// Rules: every number comes from the API (MB 14.2). Remove never deletes data (the API says so); cancel keeps the app to the period end.
// Usage bars need the usage per limit, which /entitlements doesn't give yet: the limits are shown as numbers until it does.

import React, { useEffect, useState } from "react";
import { useLang, useT } from "@sheetal/shared/core/i18n";
import { fdate } from "@sheetal/shared/core/format";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { config } from "@sheetal/shared/core/config";
import { Badge, Button, Confirm, Drawer, Empty, PageHead, Panel, Table, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";
import { workRefresh } from "../live";
import { goToGateway, ManualProof } from "./LiveBilling";
import { QuotePanel, useCart } from "./Cart";
import { PriceProtection } from "./PriceProtection";
import { addonItem, addToCart, errorKey, invoiceTitle, payInvoiceBody, renewItems, rsPaisa, statusOf, textOf } from "./marketplaceLogic";

const METHOD_ICON = { esewa: "wallet", khalti: "wallet", fonepay: "qr-code", manual: "landmark" };

export function Subscriptions({ tenant }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const { navigate } = useRouter();
  const [, setCart] = useCart(tenant.id);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [next, setNext] = useState(null);
  const [pay, setPay] = useState(null); // an open invoice
  const [manual, setManual] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: "cancel" | "remove", appId }
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([
    bizApi("GET", "/billing/overview"), bizApi("GET", "/marketplace"),
    bizApi("GET", "/entitlements").catch(() => ({ data: { apps: [] } })), bizApi("GET", "/billing").catch(() => ({ data: { methods: [], bank: null } })),
  ]).then(([o, m, e, b]) => { setData({ ...o.data, market: m.data, ent: e.data, methods: b.data.methods || [], bank: b.data.bank }); setError(null); })
    .catch((x) => setError(x.message));
  useEffect(() => { load(); }, [tenant.id]);

  // The next invoice: a renewal of each app paid by the period (the same quote the renewal invoice will use).
  const renew = data ? renewItems(data.subscriptions) : [];
  const renewKey = JSON.stringify(renew);
  useEffect(() => {
    if (!renew.length) { setNext(null); return; }
    bizApi("POST", "/subscriptions/quote", { items: renew }).then((r) => setNext(r.data)).catch(() => setNext(null));
  }, [renewKey]);

  if (error) return <Empty icon="circle-alert" title={t("mkt.loadError")} action={<Button onClick={load}>{t("mkt.tryAgain")}</Button>}>{error}</Empty>;
  if (!data) return <p className="muted pf-pad">{t("mkt.loading")}</p>;

  const catalog = data.market.catalog;
  const appOf = (id) => catalog.apps.find((a) => a.id === id);
  const editionName = (appId, id) => textOf(appOf(appId)?.editions?.find((e) => e.id === id)?.name, lang) || id;
  const limitsOf = (appId) => data.ent.apps?.find((a) => a.appId === appId)?.limits || {};
  const open = data.invoices.filter((i) => i.status === "open" && i.kind === "subscription");
  const subs = data.subscriptions.filter((s) => s.installed);

  const act = (path, body) => {
    setBusy(true);
    bizApi("POST", path, body).then((r) => { toast(r.message); load(); workRefresh(); })
      .catch((e) => toast(errorKey(e) ? t(errorKey(e)) : e.message)).finally(() => { setBusy(false); setConfirm(null); });
  };
  const startPay = (provider) => {
    setBusy(true);
    bizApi("POST", "/subscriptions/invoices/pay", payInvoiceBody(pay.id, provider)).then((r) => {
      if (r.data.method === "manual") { setManual({ ...r.data, label: invoiceTitle(pay, t) }); setPay(null); setBusy(false); return; }
      goToGateway(r.data);
    }).catch((e) => { toast(errorKey(e) ? t(errorKey(e)) : e.message); setBusy(false); });
  };

  return (
    <>
      <PageHead title={t("mkt.subsTitle")} sub={t("mkt.subsSub")}
        actions={<><Button variant="outline" icon="layout-grid" onClick={() => navigate("/business/marketplace")}>{t("mkt.addApps")}</Button></>} />
      <PriceProtection lock={data.lock} catalog={catalog} />
      {open.map((i) => (
        <div key={i.id} className="pf-alert action"><Icon name="receipt" size={18} />
          <div><b>{t("mkt.invoiceReady", { v: rsPaisa(i.totalPaisa) })}</b><span>{t("mkt.dueBy", { d: fdate(i.dueAt) })}</span></div>
          <Button size="sm" icon="credit-card" onClick={() => setPay(i)}>{t("mkt.payNow")}</Button>
        </div>
      ))}

      <Panel title={t("mkt.yourApps")}>
        <Table rows={subs} rowKey="appId" minWidth={720} empty={<Empty icon="layout-grid" title={t("mkt.noApps")} action={<Button onClick={() => navigate("/business/marketplace")}>{t("mkt.browse")}</Button>}>{t("mkt.noAppsText")}</Empty>} columns={[
          { key: "app", label: t("mkt.app"), render: (s) => <span className="pf-two"><b>{textOf(appOf(s.appId)?.name, lang) || s.appId}</b><small>{editionName(s.appId, s.editionId)}</small></span> },
          { key: "st", label: t("mkt.status"), render: (s) => { const st = statusOf(appOf(s.appId) || {}, data.market.mine[s.appId]); return <Badge tone={st.tone}>{t(st.key, { n: st.days })}</Badge>; } },
          { key: "next", label: t("mkt.renews"), num: true, render: (s) => (s.status === "trialing" ? t("mkt.trialUntil", { d: fdate(s.trialEndsAt) }) : s.periodMonths != null ? (s.cancelAtPeriodEnd ? t("mkt.endsOn", { d: fdate(s.currentPeriodEnd) }) : fdate(s.currentPeriodEnd)) : "—") },
          { key: "price", label: t("mkt.price"), num: true, align: "right", render: (s) => (s.periodMonths != null ? `${rsPaisa(s.priceGrossPaisa)} / ${s.periodMonths === 12 ? t("mkt.year") : t("mkt.month")}` : t("mkt.free")) },
          { key: "lim", label: t("mkt.limits"), render: (s) => { const l = Object.entries(limitsOf(s.appId)); return l.length ? <small>{l.map(([k, v]) => `${k.replace(/[_.]+/g, " ")}: ${v == null ? t("mkt.unlimited") : Number(v).toLocaleString("en-IN")}`).join(" · ")}</small> : "—"; } },
          { key: "x", label: "", align: "right", render: (s) => (
            <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
              <Button size="sm" variant="ghost" onClick={() => navigate(`/business/marketplace?app=${s.appId}`)}>{t("mkt.change")}</Button>
              {s.cancelAtPeriodEnd ? <Button size="sm" variant="outline" icon="rotate-ccw" disabled={busy} onClick={() => act(`/subscriptions/${s.appId}/resume`)}>{t("mkt.resume")}</Button>
                : (s.periodMonths != null || s.status === "trialing") && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm({ kind: "cancel", appId: s.appId, trial: s.status === "trialing", end: s.currentPeriodEnd })}>{t("mkt.cancel")}</Button>}
              {(s.periodMonths == null || s.cancelAtPeriodEnd) && s.status !== "trialing" && <Button size="sm" variant="ghost" icon="archive" disabled={busy} onClick={() => setConfirm({ kind: "remove", appId: s.appId })}>{t("mkt.removeApp")}</Button>}
            </div>
          ) },
        ]} />
      </Panel>

      <div className="pf-split">
        <Panel title={t("mkt.nextInvoice")} sub={t("mkt.nextInvoiceSub")} className="grow" pad>
          {next ? <QuotePanel quote={next} compact /> : <p className="muted" style={{ margin: 0 }}>{t("mkt.nothingRenews")}</p>}
        </Panel>
        <Panel title={t("mkt.more")} className="side">
          <ul className="pf-list">
            <li><Icon name="sparkles" size={16} /><div style={{ flex: 1 }}><b>{t("mkt.ai")}</b><span className="small muted">{t("mkt.aiText")}</span></div><Link to="/business/ai-accounts" className="btn btn-ghost btn-sm">{t("mkt.open")}</Link></li>
            <li><Icon name="download" size={16} /><div style={{ flex: 1 }}><b>{t("mkt.myData")}</b><span className="small muted">{t("mkt.myDataText")}</span></div><Link to="/business/data" className="btn btn-ghost btn-sm">{t("mkt.open")}</Link></li>
          </ul>
        </Panel>
      </div>

      {catalog.addons?.length > 0 && <Panel title={t("mkt.addons")} sub={t("mkt.addonsSub")}>
        <ul className="pf-list">{catalog.addons.map((a) => (
          <li key={a.key}><div style={{ flex: 1 }} className="pf-two"><b>{textOf(a.name, lang)}</b><small className="muted">{t("mkt.addonPrice", { m: rsPaisa(a.priceMonthPaisa), y: rsPaisa(a.priceYearPaisa) })}</small></div>
            <Button size="sm" variant="outline" icon="shopping-cart" disabled={!data.market.salesEnabled} onClick={() => { setCart((c) => addToCart(c, addonItem(a.key))); navigate("/business/marketplace/cart"); }}>{t("mkt.addToCart")}</Button></li>
        ))}</ul>
      </Panel>}

      <Panel title={t("mkt.invoices")}>
        <Table rows={data.invoices} minWidth={620} empty={<Empty icon="receipt" title={t("mkt.noInvoices")} />} columns={[
          { key: "n", label: t("mkt.invoice"), render: (i) => <span className="pf-two"><b className="tnum">{invoiceTitle(i, t)}</b><small>{i.lines.map((l) => textOf(l.description, lang)).join(", ")}</small></span> },
          { key: "d", label: t("mkt.date"), num: true, render: (i) => fdate(i.issuedAt || i.dueAt) },
          { key: "a", label: t("mkt.amount"), num: true, align: "right", render: (i) => rsPaisa(i.totalPaisa) },
          { key: "s", label: t("mkt.status"), render: (i) => <Badge tone={i.status === "paid" ? "done" : i.status === "open" ? "action" : "neutral"}>{t(`mkt.inv_${i.status}`)}</Badge> },
          { key: "x", label: "", align: "right", render: (i) => <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
            {i.status === "open" && i.kind === "subscription" && <Button size="sm" onClick={() => setPay(i)}>{t("mkt.pay")}</Button>}
            <Button size="sm" variant="ghost" icon="printer" onClick={() => printAppInvoice(i, t, lang, toast)}>{t("mkt.view")}</Button></div> },
        ]} />
      </Panel>

      <Drawer open={!!pay} onClose={() => !busy && setPay(null)} title={t("mkt.howPay")} sub={pay ? `${invoiceTitle(pay, t)} · ${rsPaisa(pay.totalPaisa)}` : ""}>
        {pay && <div className="pf-stack">
          {data.methods.map((m) => (
            <button key={m.id} type="button" className="pf-choice" disabled={busy} onClick={() => startPay(m.id)}>
              <Icon name={METHOD_ICON[m.id] || "credit-card"} size={20} /><span className="pf-two" style={{ flex: 1 }}><b>{m.name}{m.test ? ` (${t("mkt.testMode")})` : ""}</b>
                <small>{m.id === "manual" ? t("mkt.payManual") : t("mkt.payGateway", { name: m.name })}</small></span><Icon name="arrow-right" size={16} />
            </button>
          ))}
          {!data.methods.length && <Empty icon="wallet" title={t("mkt.noMethods")}>{t("mkt.noMethodsText")}</Empty>}
          <p className="small muted" style={{ margin: 0 }}>{t("mkt.safe")}</p>
        </div>}
      </Drawer>
      <ManualProof manual={manual} bank={data.bank} onClose={() => setManual(null)} onSent={() => { setManual(null); load(); }} />
      <Confirm open={!!confirm} onClose={() => setConfirm(null)} danger={confirm?.kind === "remove"}
        title={confirm?.kind === "remove" ? t("mkt.removeTitle") : t("mkt.cancelTitle")} confirmLabel={confirm?.kind === "remove" ? t("mkt.removeApp") : t("mkt.cancel")}
        onConfirm={() => act(`/subscriptions/${confirm.appId}/${confirm.kind}`, confirm.kind === "cancel" ? {} : undefined)}>
        {confirm?.kind === "remove" ? t("mkt.removeText") : confirm?.trial ? t("mkt.cancelTrialText") : t("mkt.cancelText", { d: fdate(confirm?.end) })}
      </Confirm>
    </>
  );
}

/** Opens a printable copy of an app invoice or credit note (Print → Save as PDF), from the overview's own lines. */
async function printAppInvoice(i, t, lang, toast) {
  let extra = {};
  try { extra = (await bizApi("GET", `/billing/invoices/${i.id}`)).data || {}; } catch { /* the lines below are enough to show it */ }
  const w = window.open("", "_blank");
  if (!w) return toast(t("mkt.popups"));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const b = extra.billedTo || {};
  const title = i.number ? `${i.kind === "credit" ? t("mkt.creditNote") : t("mkt.taxInvoice")} ${i.number}` : t("mkt.toPayInvoice");
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;color:#111}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}td:last-child,th:last-child{text-align:right}.muted{color:#666}.tot td{font-weight:700}@media print{button{display:none}}</style>
    <img src="${esc(config.logo)}" alt="Sheetal Property" style="height:34px"><h1>${esc(title)}</h1><p class="muted">${i.issuedAt ? esc(fdate(i.issuedAt)) : `${esc(t("mkt.dueBy", { d: fdate(i.dueAt) }))}`}${i.paidAt ? ` · ${esc(t("mkt.inv_paid"))} ${esc(fdate(i.paidAt))}` : ""}</p>
    ${b.name ? `<p><b>${esc(t("mkt.billedTo"))}</b><br>${esc(b.name)}${b.pan ? `<br>PAN ${esc(b.pan)}` : ""}${b.address ? `<br>${esc(b.address)}` : ""}</p>` : ""}
    <table><tr><th>${esc(t("mkt.item"))}</th><th>${esc(t("mkt.amount"))}</th></tr>${i.lines.map((l) => `<tr><td>${esc(textOf(l.description, lang))}${l.qty > 1 ? ` × ${l.qty}` : ""}${l.periodStart ? `<br><span class="muted">${esc(fdate(l.periodStart))} – ${esc(fdate(l.periodEnd))}</span>` : ""}</td><td>${esc(rsPaisa(l.grossPaisa))}</td></tr>`).join("")}
    <tr><td>${esc(t("mkt.subtotal"))}</td><td>${esc(rsPaisa(i.subtotalPaisa))}</td></tr><tr><td>${esc(t("mkt.vat"))}</td><td>${esc(rsPaisa(i.vatPaisa))}</td></tr><tr class="tot"><td>${esc(t("mkt.total"))}</td><td>${esc(rsPaisa(i.totalPaisa))}</td></tr></table>
    <p class="muted">${esc(t("mkt.vatIncluded"))}</p>${extra.seller ? `<p class="muted">${esc(extra.seller.name)} · ${esc(extra.seller.email)}</p>` : ""}<button type="button" onclick="print()">${esc(t("mkt.print"))}</button>`);
  w.document.close();
}
