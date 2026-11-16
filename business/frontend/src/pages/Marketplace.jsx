// The business marketplace (MB 14.1, P3-FE-1): every app as a card, with search and category filters, popular apps for the business type
// first; Install free, Try 14 days and Upgrade; a drawer that compares an app's editions (limits, features, monthly and yearly price,
// "you save 2 months") and puts the choice in the cart.
// Where it fits: /business/marketplace (BusinessApp.jsx); ?app=<id> opens that app's drawer (the website's "Start free" links here, BE-11).
// How it works: GET /marketplace gives the public catalog and this business's apps. Install and trial call the API at once; buying goes
// through the cart (Cart.jsx). Changing the edition of an app already paid for calls POST /subscriptions/:appId/change: a downgrade waits for
// the period end, an upgrade answers 402 payment_needed and goes to the cart as a "change" item.
// Rules: the cards show only the catalog's numbers (MB 14.2). A business still on today's plans sees the cards to look at, with a note, and
// no buttons that change anything (the API would answer 409 billing_mode). "Coming soon" apps can't be bought.

import React, { useEffect, useState } from "react";
import { useLang, useT } from "@sheetal/shared/core/i18n";
import { fdate } from "@sheetal/shared/core/format";
import { useRouter } from "@sheetal/shared/core/router";
import { Badge, Button, Drawer, Empty, PageHead, SearchInput, Seg, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";
import { workRefresh } from "../live";
import { useCart } from "./Cart";
import { addToCart, cardActions, categoriesOf, changeBody, errorKey, freeEdition, monthsSaved, paidEditions, priceLine, rsPaisa, statusOf, subscribeItem, textOf, visibleApps } from "./marketplaceLogic";

/** A limit's value from the catalog: a number, or unlimited (null or -1). */
const limitValue = (v, t) => (v == null || v === -1 ? t("mkt.unlimited") : Number(v).toLocaleString("en-IN"));
/** A limit or feature key as words ("max_rooms" → "Max rooms"); the catalog has no label for them yet. */
const words = (k) => { const s = String(k).replace(/[_.]+/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

export function Marketplace({ tenant, openApp }) {
  const t = useT();
  const lang = useLang();
  const toast = useToast();
  const { navigate } = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [drawer, setDrawer] = useState(openApp || null);
  const [busy, setBusy] = useState(false);
  const [cart, setCart] = useCart(tenant.id);

  const load = () => bizApi("GET", "/marketplace").then((r) => { setData(r.data); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [tenant.id]);
  useEffect(() => { if (openApp) setDrawer(openApp); }, [openApp]);

  if (error) return <Empty icon="circle-alert" title={t("mkt.loadError")} action={<Button onClick={load}>{t("mkt.tryAgain")}</Button>}>{error}</Empty>;
  if (!data) return <p className="muted pf-pad">{t("mkt.loading")}</p>;

  const apps = data.catalog.apps;
  const shown = visibleApps(apps, { q, category, type: tenant.type });
  const cats = categoriesOf(apps);
  const opts = { mode: data.mode, salesEnabled: data.salesEnabled };

  const act = (path, body, after) => {
    setBusy(true);
    bizApi("POST", path, body).then((r) => { toast(r.message); load(); workRefresh(); after?.(); })
      .catch((e) => toast(errorKey(e) ? t(errorKey(e)) : e.message)).finally(() => setBusy(false));
  };
  const install = (app) => act(`/subscriptions/${app.id}/install`);
  const trial = (app) => act(`/subscriptions/${app.id}/trial`, {});
  const choose = (app, edition, periodMonths) => {
    const mine = data.mine[app.id];
    if (mine?.installed && mine.periodMonths != null) {
      // Already paid for: a downgrade or a year-to-month switch is scheduled; an upgrade needs payment, so it goes to the cart.
      setBusy(true);
      bizApi("POST", `/subscriptions/${app.id}/change`, changeBody(edition.id, periodMonths)).then((r) => { toast(r.message); load(); setDrawer(null); })
        .catch((e) => {
          if (e.code === "payment_needed") { setCart((c) => addToCart(c, subscribeItem(app.id, edition.id, periodMonths, mine))); navigate("/business/marketplace/cart"); }
          else toast(errorKey(e) ? t(errorKey(e)) : e.message);
        }).finally(() => setBusy(false));
      return;
    }
    setCart((c) => addToCart(c, subscribeItem(app.id, edition.id, periodMonths, mine)));
    toast(t("mkt.added", { name: textOf(app.name, lang) }));
    setDrawer(null);
  };
  const open = apps.find((a) => a.id === drawer);

  return (
    <>
      <PageHead title={t("mkt.title")} sub={t("mkt.sub")}
        actions={<Button variant={cart.items.length ? "primary" : "outline"} icon="shopping-cart" onClick={() => navigate("/business/marketplace/cart")}>{t("mkt.cart")}{cart.items.length ? ` (${cart.items.length})` : ""}</Button>} />
      {data.mode !== "apps" && <div className="pf-alert progress"><Icon name="info" size={18} /><div><b>{t("mkt.notYetTitle")}</b><span>{t("mkt.err_mode")}</span></div></div>}
      {data.mode === "apps" && !data.salesEnabled && <div className="pf-alert progress"><Icon name="clock" size={18} /><div><b>{t("mkt.salesOffTitle")}</b><span>{t("mkt.salesOffText")}</span></div></div>}
      <div className="pf-stack" style={{ marginBottom: 16 }}>
        <SearchInput value={q} onChange={setQ} placeholder={t("mkt.search")} />
        <div className="pf-chips" role="group" aria-label={t("mkt.categories")}>
          {["all", ...cats].map((c) => <button key={c} type="button" className={`chip ${category === c ? "active" : ""}`} aria-pressed={category === c} onClick={() => setCategory(c)}>{t(`mkt.cat_${c}`)}</button>)}
        </div>
      </div>
      {!shown.length ? <Empty icon="search" title={t("mkt.noMatch")} /> : (
        <div className="pf-plan-grid">
          {shown.map((app) => <AppCard key={app.id} app={app} mine={data.mine[app.id]} opts={opts} busy={busy} onInstall={install} onTrial={trial} onOpen={() => setDrawer(app.id)} />)}
        </div>
      )}
      <EditionDrawer app={open} mine={open ? data.mine[open.id] : null} opts={opts} busy={busy} onClose={() => setDrawer(null)} onChoose={choose} onInstall={install} onTrial={trial} />
    </>
  );
}

function AppCard({ app, mine, opts, busy, onInstall, onTrial, onOpen }) {
  const t = useT();
  const lang = useLang();
  const st = statusOf(app, mine);
  const price = priceLine(app);
  const actions = cardActions(app, mine, opts);
  return (
    <article className="card pf-plan" aria-labelledby={`app-${app.id}`}>
      <div className="pf-plan-top">
        <span className="pf-two" style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Icon name={app.icon || "puzzle"} size={22} /><h3 id={`app-${app.id}`}>{textOf(app.name, lang)}</h3></span>
        <Badge tone={st.tone}>{t(st.key, { n: st.days })}</Badge>
      </div>
      {app.tagline && <p className="small muted" style={{ margin: 0 }}>{textOf(app.tagline, lang)}</p>}
      <div className="pf-price-line">
        {price.free && <b>{t("mkt.free")}</b>}
        {price.fromMonthPaisa != null && <span>{price.free ? t("mkt.orFrom", { v: rsPaisa(price.fromMonthPaisa) }) : t("mkt.from", { v: rsPaisa(price.fromMonthPaisa) })}</span>}
        {mine?.status === "trialing" && mine.trialEndsAt && <span className="small muted">{t("mkt.trialUntil", { d: fdate(mine.trialEndsAt) })}</span>}
      </div>
      <div className="pf-plan-foot pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
        {actions.includes("install") && <Button size="sm" icon="download" disabled={busy} onClick={() => onInstall(app)}>{t("mkt.installFree")}</Button>}
        {actions.includes("trial") && <Button size="sm" variant="outline" icon="sparkles" disabled={busy} onClick={() => onTrial(app)}>{t("mkt.tryDays", { n: app.trialDays })}</Button>}
        {actions.includes("upgrade") && <Button size="sm" variant="outline" icon="shopping-cart" onClick={onOpen}>{t("mkt.upgrade")}</Button>}
        {actions.includes("change") && <Button size="sm" variant="outline" icon="layers" onClick={onOpen}>{t("mkt.change")}</Button>}
        {actions.includes("view") && <Button size="sm" variant="ghost" onClick={onOpen}>{t("mkt.compare")}</Button>}
        {actions.includes("notify") && <span className="small muted">{t("mkt.soonText")}</span>}
      </div>
    </article>
  );
}

/** Compares an app's editions side by side and lets the person pick one (MB 14.1). */
export function EditionDrawer({ app, mine, opts, busy, onClose, onChoose, onInstall, onTrial }) {
  const t = useT();
  const lang = useLang();
  const [period, setPeriod] = useState(mine?.periodMonths === 12 ? 12 : 1);
  useEffect(() => { setPeriod(mine?.periodMonths === 12 ? 12 : 1); }, [app?.id]);
  if (!app) return <Drawer open={false} onClose={onClose} />;
  const eds = app.editions || [];
  const limitKeys = [...new Set(eds.flatMap((e) => Object.keys(e.limits || {})))];
  const featureKeys = [...new Set(eds.flatMap((e) => e.features || []))];
  const actions = cardActions(app, mine, opts);
  const current = mine?.installed ? mine.edition : null;
  const canBuy = opts.mode === "apps" && opts.salesEnabled && app.availability !== "coming_soon";
  return (
    <Drawer open onClose={onClose} title={textOf(app.name, lang)} sub={app.tagline ? textOf(app.tagline, lang) : undefined}>
      <div className="pf-stack">
        {paidEditions(app).length > 0 && <Seg label={t("mkt.period")} value={period} onChange={setPeriod} options={[{ id: 1, label: t("mkt.monthly") }, { id: 12, label: t("mkt.yearly") }]} />}
        <div className="pf-table-wrap"><table className="table pf-table" style={{ minWidth: 120 + eds.length * 150 }}>
          <caption className="small muted" style={{ textAlign: "left" }}>{t("mkt.compareCaption")}</caption>
          <thead><tr><th scope="col">{t("mkt.edition")}</th>{eds.map((e) => <th key={e.id} scope="col">{textOf(e.name, lang) || words(e.id)}{current === e.id ? ` · ${t("mkt.yours")}` : ""}</th>)}</tr></thead>
          <tbody>
            <tr><th scope="row">{t("mkt.priceMonth")}</th>{eds.map((e) => <td key={e.id} className="tnum">{e.free ? t("mkt.free") : rsPaisa(e.priceMonthPaisa)}</td>)}</tr>
            <tr><th scope="row">{t("mkt.priceYear")}</th>{eds.map((e) => <td key={e.id} className="tnum">{e.free ? t("mkt.free") : <>{rsPaisa(e.priceYearPaisa)}{monthsSaved(e) ? <><br /><small className="muted">{t("mkt.save", { n: monthsSaved(e) })}</small></> : null}</>}</td>)}</tr>
            {limitKeys.map((k) => <tr key={k}><th scope="row">{words(k)}</th>{eds.map((e) => <td key={e.id} className="tnum">{k in (e.limits || {}) ? limitValue(e.limits[k], t) : "—"}</td>)}</tr>)}
            {featureKeys.map((f) => <tr key={f}><th scope="row">{words(f)}</th>{eds.map((e) => <td key={e.id}>{(e.features || []).includes(f) ? <span role="img" aria-label={t("mkt.included")}><Icon name="check" size={15} /></span> : <span role="img" aria-label={t("mkt.notIncluded")}><Icon name="minus" size={15} /></span>}</td>)}</tr>)}
            <tr><th scope="row" />{eds.map((e) => (
              <td key={e.id}>
                {e.free ? (actions.includes("install") && freeEdition(app)?.id === e.id ? <Button size="sm" disabled={busy} onClick={() => onInstall(app)}>{t("mkt.installFree")}</Button> : null)
                  : canBuy ? <Button size="sm" disabled={busy || (current === e.id && mine?.periodMonths === period)} onClick={() => onChoose(app, e, period)}>{current === e.id && mine?.periodMonths === period ? t("mkt.yours") : mine?.periodMonths != null ? t("mkt.switch") : t("mkt.addToCart")}</Button> : null}
              </td>
            ))}</tr>
          </tbody>
        </table></div>
        {actions.includes("trial") && <Button variant="outline" icon="sparkles" disabled={busy} onClick={() => onTrial(app)}>{t("mkt.tryDaysLong", { n: app.trialDays })}</Button>}
        {app.availability === "coming_soon" && <p className="pf-hint"><Icon name="clock" size={13} />{t("mkt.soonText")}</p>}
        {opts.mode !== "apps" && <p className="pf-hint"><Icon name="info" size={13} />{t("mkt.err_mode")}</p>}
        <p className="small muted" style={{ margin: 0 }}>{t("mkt.vatIncluded")}</p>
      </div>
    </Drawer>
  );
}
