// The cart and checkout of the marketplace (MB 14.1, P3-FE-1): several apps and add-ons in one cart become one payment.
// Where it fits: /business/marketplace/cart (BusinessApp.jsx), opened from the Marketplace and Subscriptions pages; useCart() is shared by them.
// How it works: the cart lives in the browser's drafts (UI state only, per business) as the API's own items. Every change asks
// POST /subscriptions/quote again and QuotePanel shows that answer: lines, proration notes, discount, VAT and total. A coupon is checked with
// POST /coupons/check. Paying sends POST /subscriptions/checkout with the payment method Sheetal has live (from GET /billing), then goes to
// the gateway (or the bank-transfer receipt form); the tax invoice appears on the return page and in Subscriptions.
// Rules: the screen never adds up money: every number comes from the quote (MB 14.2). Bodies are built in marketplaceLogic.js and match the
// API's .strict() rules (bodies.ts). The cart is emptied once the invoice exists (an unpaid one stays payable in Subscriptions).

import React, { useCallback, useEffect, useState } from "react";
import { useStore } from "@sheetal/shared/core/store";
import { useLang, useT } from "@sheetal/shared/core/i18n";
import { fdate } from "@sheetal/shared/core/format";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { Badge, Button, Empty, Field, Input, PageHead, Panel, Seg, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";
import { workRefresh } from "../live";
import { goToGateway, ManualProof } from "./LiveBilling";
import { checkoutBody, errorKey, itemLabel, quoteBody, removeFromCart, rsPaisa, setCartPeriod, textOf } from "./marketplaceLogic";

const METHOD_ICON = { esewa: "wallet", khalti: "wallet", fonepay: "qr-code", manual: "landmark" };

/** The cart of the open business, kept with the browser's drafts (UI state only). Returns [cart, setCart] where setCart takes a function. */
export function useCart(tenantId) {
  const { db, update } = useStore();
  const key = `cart:${tenantId}`;
  const cart = db.drafts?.[key] || { items: [] };
  const setCart = useCallback((fn) => update((d) => {
    d.drafts = d.drafts || {};
    const next = fn(d.drafts[key] || { items: [] });
    if (next.items.length) d.drafts[key] = next; else delete d.drafts[key];
  }), [key, update]);
  return [cart, setCart];
}

/** The quote as the API answered it. Only shows numbers from `quote`; it never computes a total itself. */
export function QuotePanel({ quote, compact, summary }) {
  const t = useT();
  const lang = useLang();
  if (!quote) return null;
  // A plan (`summary` = { title, normalPaisa, onOffer }): one clear price first; the line per app stays under "See the breakdown".
  const lines = (
      <ul className="pf-list">
        {quote.lines.map((l, i) => (
          <li key={i}>
            <div className="pf-two" style={{ flex: 1 }}>
              <b>{textOf(l.description, lang)}{l.qty > 1 ? ` × ${l.qty}` : ""}</b>
              {!compact && l.periodStart && <small className="muted">{fdate(l.periodStart)} – {fdate(l.periodEnd)}</small>}
            </div>
            <span className="tnum" data-paisa={l.grossPaisa}>{rsPaisa(l.grossPaisa)}</span>
          </li>
        ))}
      </ul>);
  return (
    <div className="pf-stack">
      {summary ? <>
        <div className="pf-quote-sum">
          <span className="muted small">{summary.title}</span>
          <b className="tnum" data-paisa={quote.totalPaisa}>{rsPaisa(quote.totalPaisa)}</b>
          {summary.onOffer && summary.normalPaisa ? <span className="small muted"><s className="tnum">{rsPaisa(summary.normalPaisa)}</s> normal price</span> : null}
          <span className="small muted">VAT included ({rsPaisa(quote.vatPaisa)})</span>
        </div>
        <details className="pf-quote-more"><summary>See the breakdown</summary>{lines}</details>
      </> : lines}
      {!summary && <dl className="pf-kv">
        {quote.discountPaisa > 0 && <><dt>{t("mkt.discount")}</dt><dd className="tnum" data-paisa={-quote.discountPaisa}>{rsPaisa(-quote.discountPaisa)}</dd></>}
        <dt>{t("mkt.subtotal")}</dt><dd className="tnum" data-paisa={quote.subtotalPaisa}>{rsPaisa(quote.subtotalPaisa)}</dd>
        <dt>{t("mkt.vat")}</dt><dd className="tnum" data-paisa={quote.vatPaisa}>{rsPaisa(quote.vatPaisa)}</dd>
        <dt><b>{t("mkt.total")}</b></dt><dd className="tnum" data-paisa={quote.totalPaisa}><b>{rsPaisa(quote.totalPaisa)}</b></dd>
        {quote.carryPaisa > 0 && <><dt>{t("mkt.carry")}</dt><dd className="tnum" data-paisa={quote.carryPaisa}>{rsPaisa(quote.carryPaisa)}</dd></>}
      </dl>}
      {[...quote.notes.map((x) => ["progress", "info", x]), ...quote.warnings.map((x) => ["action", "circle-alert", x]), ...quote.errors.map((x) => ["problem", "circle-alert", x])].map(([tone, icon, x], i) => (
        <p key={i} className={`pf-hint pf-tone-${tone}`} role={tone === "problem" ? "alert" : undefined}><Icon name={icon} size={13} />{textOf(x, lang)}</p>
      ))}
    </div>
  );
}

export function CartPage({ tenant }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const { navigate } = useRouter();
  const [cart, setCart] = useCart(tenant.id);
  const [market, setMarket] = useState(null);
  const [billing, setBilling] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState("");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(null);

  useEffect(() => {
    bizApi("GET", "/marketplace").then((r) => setMarket(r.data)).catch((e) => toast(e.message));
    bizApi("GET", "/billing").then((r) => setBilling(r.data)).catch(() => setBilling({ methods: [], bank: null }));
  }, [tenant.id]);

  const items = JSON.stringify(cart.items);
  useEffect(() => {
    if (!cart.items.length || market?.mode !== "apps") { setQuote(null); return; }
    let live = true;
    setQuoteError(null);
    bizApi("POST", "/subscriptions/quote", quoteBody(cart, applied))
      .then((r) => { if (live) setQuote(r.data); })
      .catch((e) => { if (live) { setQuote(null); setQuoteError(errorKey(e) ? t(errorKey(e)) : e.message); } });
    return () => { live = false; };
  }, [items, applied, market?.mode]);

  const checkCoupon = () => {
    if (!code.trim()) return;
    bizApi("POST", "/coupons/check", quoteBody(cart, code)).then((r) => {
      if (r.data.ok) { setApplied(code.trim().toUpperCase()); toast(t("mkt.couponOk", { v: rsPaisa(r.data.discountPaisa) })); }
      else toast(r.data.reason);
    }).catch((e) => toast(e.message));
  };

  const pay = (provider) => {
    setBusy(true);
    bizApi("POST", "/subscriptions/checkout", checkoutBody(cart, provider, applied)).then((r) => {
      setCart(() => ({ items: [] }));
      if (r.data.paid) { toast(r.message); workRefresh(); navigate("/business/billing"); return; }
      if (r.data.method === "manual") { setManual({ ...r.data, label: t("mkt.cartTitle") }); setBusy(false); return; }
      goToGateway(r.data);
    }).catch((e) => { toast(errorKey(e) ? t(errorKey(e)) : e.message); setBusy(false); });
  };

  if (!market) return <p className="muted pf-pad">{t("mkt.loading")}</p>;
  const yearly = cart.items.some((x) => (x.kind === "subscribe" || x.kind === "change") && x.periodMonths === 12);
  const hasPeriod = cart.items.some((x) => x.kind === "subscribe" || x.kind === "change");
  const methods = billing?.methods || [];
  const canPay = market.mode === "apps" && market.salesEnabled && quote && !quote.errors.length && !busy;

  return (
    <>
      <PageHead title={t("mkt.cartTitle")} sub={t("mkt.cartSub")} back={<Link to="/business/marketplace" className="fb-back"><Icon name="arrow-left" size={16} />{t("mkt.title")}</Link>} />
      {market.mode !== "apps" && <div className="pf-alert progress"><Icon name="info" size={18} /><div><b>{t("mkt.notYetTitle")}</b><span>{t("mkt.err_mode")}</span></div></div>}
      {market.mode === "apps" && !market.salesEnabled && <div className="pf-alert progress"><Icon name="clock" size={18} /><div><b>{t("mkt.salesOffTitle")}</b><span>{t("mkt.err_salesOff")}</span></div></div>}
      {!cart.items.length ? (
        <Panel pad><Empty icon="shopping-cart" title={t("mkt.cartEmpty")} action={<Button icon="layout-grid" onClick={() => navigate("/business/marketplace")}>{t("mkt.browse")}</Button>}>{t("mkt.cartEmptyText")}</Empty></Panel>
      ) : (
        <div className="pf-split">
          <Panel title={t("mkt.inCart", { n: cart.items.length })} className="grow"
            actions={hasPeriod && <Seg label={t("mkt.period")} value={yearly ? 12 : 1} onChange={(m) => setCart((c) => setCartPeriod(c, m))} options={[{ id: 1, label: t("mkt.monthly") }, { id: 12, label: t("mkt.yearly") }]} />}>
            <ul className="pf-list">
              {cart.items.map((x, i) => (
                <li key={`${x.kind}-${x.appId || x.addonKey}`}>
                  <div className="pf-two" style={{ flex: 1 }}><b>{itemLabel(x, market.catalog, lang)}{x.kind === "addon" && x.qty > 1 ? ` × ${x.qty}` : ""}</b>
                    <small className="muted">{t(`mkt.kind_${x.kind}`)}{x.periodMonths ? ` · ${x.periodMonths === 12 ? t("mkt.yearly") : t("mkt.monthly")}` : ""}</small></div>
                  <Button size="sm" variant="ghost" icon="trash-2" aria-label={t("mkt.remove")} onClick={() => setCart((c) => removeFromCart(c, i))}>{t("mkt.remove")}</Button>
                </li>
              ))}
            </ul>
            <div className="pf-pad pf-stack">
              <Field label={t("mkt.coupon")} hint={applied ? t("mkt.couponApplied", { code: applied }) : undefined}>
                <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
                  <Input value={code} maxLength={32} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") checkCoupon(); }} aria-label={t("mkt.coupon")} />
                  <Button variant="outline" icon="ticket" onClick={checkCoupon} disabled={!code.trim()}>{t("mkt.apply")}</Button>
                  {applied && <Button variant="ghost" onClick={() => { setApplied(""); setCode(""); }}>{t("mkt.removeCoupon")}</Button>}
                </div>
              </Field>
            </div>
          </Panel>
          <Panel title={t("mkt.summary")} className="side" pad>
            {quoteError ? <p className="pf-hint pf-tone-problem" role="alert"><Icon name="circle-alert" size={13} />{quoteError}</p> : quote ? <QuotePanel quote={quote} /> : <p className="muted">{t("mkt.quoting")}</p>}
            {quote && <p className="small muted">{t("mkt.vatIncluded")}</p>}
            <div className="pf-stack" style={{ marginTop: 12 }}>
              <b>{t("mkt.payWith")}</b>
              {methods.map((m) => (
                <button key={m.id} type="button" className="pf-choice" disabled={!canPay} onClick={() => pay(m.id)}>
                  <Icon name={METHOD_ICON[m.id] || "credit-card"} size={20} />
                  <span className="pf-two" style={{ flex: 1 }}><b>{m.name}{m.test ? ` (${t("mkt.testMode")})` : ""}</b>
                    <small>{m.id === "manual" ? t("mkt.payManual") : t("mkt.payGateway", { name: m.name })}</small></span>
                  <Icon name="arrow-right" size={16} />
                </button>
              ))}
              {!methods.length && <Empty icon="wallet" title={t("mkt.noMethods")}>{t("mkt.noMethodsText")}</Empty>}
              {quote && quote.totalPaisa === 0 && market.salesEnabled && <Button icon="check" disabled={!canPay} onClick={() => pay("manual")}>{t("mkt.getFree")}</Button>}
              <p className="small muted" style={{ margin: 0 }}>{t("mkt.safe")}</p>
              {quote?.dueAt && <Badge tone="neutral" icon="calendar-days">{t("mkt.dueBy", { d: fdate(quote.dueAt) })}</Badge>}
            </div>
          </Panel>
        </div>
      )}
      <ManualProof manual={manual} bank={billing?.bank} onClose={() => { setManual(null); navigate("/business/billing"); }} onSent={() => { setManual(null); navigate("/business/billing"); }} />
    </>
  );
}
