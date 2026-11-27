// Plans: the three Sheetal Technology software packs (Starter, Business, Pro) for 1 month, 6 months or 1 year, and paying for one.
// Where it fits: /business/plans (BusinessApp.jsx), for people who manage billing. The packs, their software and every price come from
// GET /packs (the catalog Admin -> Pricing edits); the screen never adds up money: the summary is POST /packs/quote's answer.
// How it works: pick a length, compare the packs (the offer price with the normal price crossed out), "Choose" opens the summary with the
// payment methods Sheetal has live (GET /billing); paying sends POST /packs/checkout and goes to the gateway or the bank-transfer form, the
// same way as the cart. Listing on the website (Sheetal CMS) is free with or without a pack.

import React, { useEffect, useState } from "react";
import { takePick } from "../siteAuth";
import { fdate } from "@sheetal/shared/core/format";
import { Badge, Button, Drawer, Empty, PageHead, Panel, Seg, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { useRouter } from "@sheetal/shared/core/router";
import { bizApi } from "../api";
import { goToGateway, ManualProof } from "./LiveBilling";
import { QuotePanel } from "./Cart";
import { rsPaisa, textOf } from "./marketplaceLogic";

const METHOD_ICON = { esewa: "wallet", khalti: "wallet", fonepay: "qr-code", manual: "landmark" };
const LENGTHS = [{ id: 1, label: "Monthly" }, { id: 6, label: "6 months" }, { id: 12, label: "1 year" }];
const per = { 1: "a month", 6: "for 6 months", 12: "for 1 year" };

export function Plans({ tenant }) {
  const toast = useToast();
  const { navigate } = useRouter();
  const [d, setD] = useState(null);
  const [billing, setBilling] = useState(null);
  const [months, setMonths] = useState(12);
  const [pick, setPick] = useState(null);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(null);

  useEffect(() => {
    // A plan chosen before signing in (BusinessStart.jsx) opens straight away, ready to pay.
    const chosen = takePick();
    bizApi("GET", "/packs").then((r) => {
      setD(r.data);
      if (chosen?.packId && r.data.packs?.some((p) => p.id === chosen.packId)) { setMonths(chosen.months || 12); setPick(chosen.packId); }
      else if (r.data.current?.months) setMonths(r.data.current.months);
    }).catch((e) => toast(e.message));
    bizApi("GET", "/billing").then((r) => setBilling(r.data)).catch(() => setBilling({ methods: [], bank: null }));
  }, [tenant.id]);

  // The summary for the chosen pack and length, from the server.
  useEffect(() => {
    if (!pick) { setQuote(null); return; }
    let live = true;
    setQuote(null);
    bizApi("POST", "/packs/quote", { packId: pick, months }).then((r) => live && setQuote(r.data)).catch((e) => { if (live) { toast(e.message); setPick(null); } });
    return () => { live = false; };
  }, [pick, months]);

  if (!d) return <p className="muted pf-pad">Loading plans…</p>;
  const sw = Object.fromEntries(d.software.map((s) => [s.id, s]));
  const paidSoftware = d.software.filter((s) => !s.free);
  const canBuy = d.mode === "apps" && d.salesEnabled;
  const methods = billing?.methods || [];
  const chosen = d.packs.find((p) => p.id === pick);

  const pay = (provider) => {
    setBusy(true);
    bizApi("POST", "/packs/checkout", { packId: pick, months, provider }).then((r) => {
      if (r.data.method === "manual") { setManual({ ...r.data, label: `${textOf(chosen.name)} plan` }); setBusy(false); return; }
      goToGateway(r.data);
    }).catch((e) => { toast(e.message); setBusy(false); });
  };

  return (
    <>
      <PageHead title="Plans" sub="Sheetal Technology software for your business, in three simple plans. Posting on the website stays free." />
      {d.current && <div className="pf-alert done"><Icon name="badge-check" size={18} /><div><b>You are on {textOf(d.packs.find((p) => p.id === d.current.packId)?.name) || d.current.packId}</b><span>Paid until {fdate(d.current.periodEnd)}. It renews {d.current.months === 12 ? "every year" : d.current.months === 6 ? "every 6 months" : "every month"}.</span></div></div>}
      {d.mode !== "apps" && <div className="pf-alert progress"><Icon name="info" size={18} /><div><b>Plans arrive soon for your business</b><span>Sheetal moves your business to the new plans first. Until then, see what each plan has.</span></div></div>}
      {d.mode === "apps" && !d.salesEnabled && <div className="pf-alert progress"><Icon name="clock" size={18} /><div><b>Plans open soon</b><span>Sheetal isn't taking payments yet. You can compare the plans now.</span></div></div>}

      <div className="pf-row-actions" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12, margin: "4px 0 16px" }}>
        <Seg label="How long" value={months} onChange={setMonths} options={LENGTHS} />
        <span className="small muted">Prices include 13% VAT. 6 months saves about 10%, 1 year about 20%.</span>
      </div>

      <div className="pf-plan-grid">
        {d.packs.map((p) => {
          const pr = p.periods.find((x) => x.months === months);
          const mine = d.current?.packId === p.id;
          return (
            <section key={p.id} className={`card pf-plan ${mine ? "cur" : ""}`} aria-label={`${textOf(p.name)} plan`}>
              <div className="pf-plan-top">
                <h3>{textOf(p.name)}</h3>
                {mine ? <Badge tone="done" icon="check">Your plan</Badge> : p.highlight ? <Badge tone="progress" icon="star">Most popular</Badge> : null}
              </div>
              <span className="small muted">{textOf(p.tagline)}</span>
              <div>
                {pr.onOffer && <Badge tone="action" icon="tag">{textOf(p.offerLabel) || "Offer"}</Badge>}
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  <b className="tnum" style={{ fontSize: 28, color: "var(--text-strong)" }}>{rsPaisa(pr.pricePaisa)}</b>
                  <span className="small muted">{per[months]}</span>
                </div>
                {pr.onOffer && <span className="small muted tnum"><s>{rsPaisa(pr.normalPaisa)}</s> normal price</span>}
                {months > 1 && <div className="small muted tnum">{rsPaisa(Math.round(pr.pricePaisa / months / 100) * 100)} a month</div>}
              </div>
              <ul className="pf-plan-feats">
                <li><Icon name="check" size={15} />{textOf(sw.cms?.name) || "Sheetal CMS"} (free for everyone)</li>
                {paidSoftware.map((s) => {
                  const has = p.software.includes(s.id);
                  const soon = has && s.apps.length > 0 && s.apps.every((a) => a.comingSoon);
                  return <li key={s.id} className={has ? "" : "off"}><Icon name={has ? "check" : "x"} size={15} />{textOf(s.name)}{soon ? " · coming soon" : ""}</li>;
                })}
              </ul>
              <div className="pf-plan-foot">
                <Button block icon={mine ? "refresh-cw" : "arrow-right"} disabled={!canBuy || mine} onClick={() => setPick(p.id)}>{mine ? "Your plan" : `Choose ${textOf(p.name)}`}</Button>
              </div>
            </section>
          );
        })}
      </div>

      <Panel title="What each software does" pad style={{ marginTop: 16 }}>
        <ul className="pf-list">
          {d.software.map((s) => (
            <li key={s.id}><Icon name={s.icon || "box"} size={18} />
              <span className="pf-two" style={{ flex: 1 }}><b>{textOf(s.name)}{s.free ? " · free" : ""}</b><small className="muted">{textOf(s.tagline)}</small></span>
            </li>
          ))}
        </ul>
      </Panel>

      <Drawer open={!!pick} onClose={() => { if (!busy) setPick(null); }} title={chosen ? `${textOf(chosen.name)} · ${LENGTHS.find((l) => l.id === months).label}` : ""}>
        {!quote ? <p className="muted">Working out the price…</p> : (
          <div className="pf-stack">
            <QuotePanel quote={quote} compact summary={{ title: `${textOf(chosen?.name)} plan, ${LENGTHS.find((l) => l.id === months).label.toLowerCase()}`, normalPaisa: quote.normalPaisa, onOffer: quote.onOffer }} />
            <b>Pay with</b>
            {methods.map((m) => (
              <button key={m.id} type="button" className="pf-choice" disabled={busy || quote.errors.length > 0} onClick={() => pay(m.id)}>
                <Icon name={METHOD_ICON[m.id] || "credit-card"} size={20} />
                <span className="pf-two" style={{ flex: 1 }}><b>{m.name}{m.test ? " (test mode)" : ""}</b><small>{m.id === "manual" ? "Pay by bank transfer and send the receipt" : `Pay securely with ${m.name}`}</small></span>
                <Icon name="arrow-right" size={16} />
              </button>
            ))}
            {!methods.length && <Empty icon="wallet" title="No payment method is open yet">Please contact Sheetal to pay.</Empty>}
            <p className="small muted" style={{ margin: 0 }}>You get a tax invoice by email once it's paid. Your apps switch on at once.</p>
          </div>
        )}
      </Drawer>
      <ManualProof manual={manual} bank={billing?.bank} onClose={() => { setManual(null); navigate("/business/billing"); }} onSent={() => { setManual(null); navigate("/business/billing"); }} />
    </>
  );
}
