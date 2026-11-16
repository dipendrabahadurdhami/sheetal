// Business → AI (P3-FE-6, MB 10): where the business's AI stands (off with a preview, Sheetal AI, or its own key), the Sheetal AI credits meter,
// the Sheetal AI plans (into the cart), the business's own AI accounts for Claude, OpenAI, Gemini and ElevenLabs, the preferred provider and the
// "If my key fails, use Sheetal AI" switch.
// Where it fits: /business/ai-accounts for a business on per-app billing (BusinessApp.jsx); a business on today's plans keeps LiveAiAccounts.jsx.
// How it works: GET /marketplace (plans and this business's plan), GET /v1/ai/credits (state, balance, grants, this month, settings),
// GET/PUT/POST/DELETE /v1/ai/connections/:id (the Integration Center at business scope), PUT /v1/ai/settings. A plan goes into the cart
// (Cart.jsx) as the hidden app "sheetal_ai". Bodies come from aiLogic.js.
// Rules: a key field is write-only: the page sends it once, clears it, and never shows a saved key (only "Key saved"). The meter is the server's.

import React, { useEffect, useState } from "react";
import { fdate } from "@sheetal/shared/core/format";
import { useRouter } from "@sheetal/shared/core/router";
import { Badge, Button, Empty, Field, Input, PageHead, Panel, Seg, Stat, Toggle, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { bizApi } from "../api";
import { useCart } from "./Cart";
import { addToCart, rsPaisa, textOf } from "./marketplaceLogic";
import { OWN_AI, SHEETAL_AI_APP, connText, meterOf, ownKeyBody, pauseBody, planItem, settingsBody, stateOf } from "./aiLogic";

export function AiPlan({ tenant }) {
  const toast = useToast();
  const { navigate } = useRouter();
  const [, setCart] = useCart(tenant.id);
  const [market, setMarket] = useState(null);
  const [credits, setCredits] = useState(null);
  const [conns, setConns] = useState(null);
  const [period, setPeriod] = useState(1);
  const [busy, setBusy] = useState(false);

  const load = () => {
    bizApi("GET", "/marketplace").then((r) => setMarket(r.data)).catch((e) => toast(e.message));
    bizApi("GET", "/ai/credits").then((r) => setCredits(r.data)).catch(() => setCredits(false));
    bizApi("GET", "/ai/connections").then((r) => setConns(r.data)).catch(() => setConns(false));
  };
  useEffect(() => { load(); }, [tenant.id]);
  const run = (method, path, body) => { setBusy(true); return bizApi(method, path, body).then((r) => { toast(r.message || "Done."); load(); return r; }).catch((e) => { toast(e.message); }).finally(() => setBusy(false)); };

  if (!market) return <p className="muted pf-pad">Loading AI…</p>;
  const plans = market.catalog.ai?.plans || [];
  const mine = market.mine?.[SHEETAL_AI_APP];
  const st = stateOf(credits?.state);
  const m = meterOf(credits || {});
  const settings = credits?.settings || { preferred: "auto", fallbackToSheetal: false };
  const liveText = (conns || []).filter((c) => c.connection.state === "live" && c.spec.id !== "voice.elevenlabs");

  return (
    <>
      <PageHead title="AI" sub="Every app has AI: use Sheetal AI with credits, or connect your own AI account." />
      <div className={`pf-alert ${st.tone === "done" ? "done" : "progress"}`}><Icon name="sparkles" size={18} /><div><b>{st.title}</b><span>{st.text}</span></div></div>

      <div className="pf-split">
        <Panel title="Sheetal AI credits" className="grow" pad>
          {credits === false ? <p className="muted" style={{ margin: 0 }}>Only people who manage billing can see the credits.</p> : !credits ? <p className="muted">Loading…</p> : <>
            <div className="pf-stats">
              <Stat label="Credits left" value={m.left.toLocaleString("en-IN")} note={m.nextExpiry ? `First expiry ${fdate(m.nextExpiry)}` : "No credits"} />
              <Stat label="Used this month" value={m.usedThisMonth.toLocaleString("en-IN")} note={`${credits.thisMonth.sheetalUses} Sheetal AI uses · ${credits.thisMonth.ownUses} on your key`} />
            </div>
            <div className="pf-meter" style={{ marginTop: 12 }}>
              <div className="pf-meter-top"><span>Left of what you have</span><b className="tnum">{m.left.toLocaleString("en-IN")} / {m.total.toLocaleString("en-IN")}</b></div>
              <div className="bar" role="img" aria-label={`${m.left} of ${m.total} credits left`}><i style={{ width: `${m.pctLeft}%` }} /></div>
            </div>
          </>}
        </Panel>
        <Panel title="How AI is used" className="side" pad>
          <div className="pf-stack">
            <Field label="Use first">
              <select className="select" value={settings.preferred} disabled={busy} aria-label="Preferred AI"
                onChange={(e) => run("PUT", "/ai/settings", settingsBody(e.target.value, settings.fallbackToSheetal))}>
                <option value="auto">Any of my connected accounts</option>
                {OWN_AI.filter((p) => p.kind === "text").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <div className="pf-row-actions" style={{ justifyContent: "space-between" }}>
              <span className="small">If my own key fails, use Sheetal AI credits</span>
              <Toggle checked={settings.fallbackToSheetal} disabled={busy} label="If my own key fails, use Sheetal AI credits" onChange={(v) => run("PUT", "/ai/settings", settingsBody(settings.preferred, v))} />
            </div>
            {!liveText.length && <p className="small muted" style={{ margin: 0 }}>No own account is on yet: Sheetal AI (or the preview) is used.</p>}
          </div>
        </Panel>
      </div>

      <Panel title="Sheetal AI plans" sub="Credits every month. Prices include 13% VAT." actions={<Seg label="Billing period" value={period} onChange={setPeriod} options={[{ id: 1, label: "Monthly" }, { id: 12, label: "Yearly" }]} />}>
        {!plans.length ? <Empty icon="sparkles" title="No Sheetal AI plans yet" /> : (
          <div className="pf-plan-grid pf-pad">{plans.map((p) => {
            const yours = mine?.installed && mine.edition === p.key;
            return (
              <div key={p.key} className={`card pf-plan ${yours ? "cur" : ""}`}>
                <div className="pf-plan-top"><h3>{textOf(p.name)}</h3>{yours && <Badge tone="done">Your plan</Badge>}</div>
                <div className="pf-price-line"><b className="tnum" data-paisa={period === 12 ? p.priceYearPaisa : p.priceMonthPaisa}>{rsPaisa(period === 12 ? p.priceYearPaisa : p.priceMonthPaisa)}</b><span>{period === 12 ? "a year" : "a month"}</span></div>
                <span className="small">{p.creditsPerMonth.toLocaleString("en-IN")} credits a month</span>
                <div className="pf-plan-foot"><Button block variant={yours ? "outline" : "primary"} disabled={!market.salesEnabled || market.mode !== "apps" || (yours && mine.periodMonths === period)}
                  onClick={() => { setCart((c) => addToCart(c, planItem(p.key, period, mine))); navigate("/business/marketplace/cart"); }}>{yours ? (mine.periodMonths === period ? "Your plan" : "Switch period") : "Add to cart"}</Button></div>
              </div>
            );
          })}</div>
        )}
        {market.catalog.ai?.topup && <p className="small muted pf-pad" style={{ marginTop: 0 }}>Top-ups ({rsPaisa(market.catalog.ai.topup.priceGrossPaisa)} for {market.catalog.ai.topup.credits.toLocaleString("en-IN")} credits) open with the next billing update.</p>}
        {!market.salesEnabled && <p className="small muted pf-pad" style={{ marginTop: 0 }}>Buying opens soon.</p>}
      </Panel>

      <Panel title="Your own AI accounts" sub="Your key is stored sealed. It is never shown again, not even to you or Sheetal.">
        {conns === false ? <p className="muted pf-pad">Only people who change business settings can connect AI accounts.</p> : !conns ? <p className="muted pf-pad">Loading…</p> : (
          <ul className="pf-list">{OWN_AI.map((p) => <OwnKey key={p.id} p={p} c={conns.find((x) => x.spec.id === p.id)} busy={busy} run={run} />)}</ul>
        )}
      </Panel>
    </>
  );
}

/** One provider: the key (write-only) and its other fields, Test, Switch on, Pause, Disconnect. */
function OwnKey({ p, c, busy, run }) {
  const [values, setValues] = useState({});
  if (!c) return null;
  const st = c.connection.state;
  const [label, tone] = connText(st);
  const fields = c.spec.fields || [];
  const path = `/ai/connections/${p.id}`;
  const save = () => run("PUT", path, ownKeyBody(values, c.connection.version)).then(() => setValues({}));
  const any = Object.values(values).some((v) => String(v || "").trim());
  return (
    <li style={{ alignItems: "flex-start" }}>
      <Icon name={p.kind === "voice" ? "phone-call" : "sparkles"} size={18} />
      <div className="pf-stack" style={{ flex: 1 }}>
        <div className="pf-row-actions" style={{ justifyContent: "space-between" }}><b>{p.name}</b><Badge tone={tone}>{label}</Badge></div>
        {c.connection.health?.message && st === "live" && <span className="small muted">{c.connection.health.message}</span>}
        <div className="pf-row-actions" style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
          {fields.map((f) => (
            <Field key={f.key} label={f.secret ? (st === "none" || st === "draft" ? f.label.en : `${f.label.en} (saved; type a new one to replace it)`) : f.label.en} hint={f.secret ? p.hint : undefined}>
              <Input type={f.secret ? "password" : "text"} autoComplete="off" aria-label={`${p.name} ${f.label.en}`} value={values[f.key] ?? ""} maxLength={f.maxLength || 400}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
            </Field>
          ))}
        </div>
        <div className="pf-row-actions" style={{ justifyContent: "flex-start" }}>
          <Button size="sm" disabled={busy || !any} onClick={save}>Save</Button>
          {st !== "none" && st !== "draft" && <Button size="sm" variant="outline" disabled={busy} onClick={() => run("POST", `${path}/test`)}>Test</Button>}
          {st === "test_passed" && <Button size="sm" disabled={busy} onClick={() => run("POST", `${path}/go-live`)}>Switch on</Button>}
          {st === "live" && <Button size="sm" variant="outline" disabled={busy} onClick={() => run("POST", `${path}/pause`, pauseBody("Paused by the business"))}>Pause</Button>}
          {st === "paused" && <Button size="sm" variant="outline" disabled={busy} onClick={() => run("POST", `${path}/resume`)}>Resume</Button>}
          {st !== "none" && st !== "draft" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`Disconnect ${p.name}? The key is deleted.`)) run("DELETE", path); }}>Disconnect</Button>}
        </div>
      </div>
    </li>
  );
}
