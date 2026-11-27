// Business settings on the business API: profile, branding, payments, notifications, listing defaults and documents.
// Where it fits: Business → Settings. Moved here from business/frontend/src/pages/BusinessSettings.jsx in P2-W6 (that file is the shim, which passes in the
// logo-and-colours editor (`Branding`) and the listing-code field (`CodePrefix`), both Business pages an app may not import, and the panel's reload).
// How it works: useApiGet loads GET /workspace/settings; every tab saves on the server: the profile (PATCH /workspace/profile: it shows on the website,
// bills and invoices) and payments, notifications, listing defaults, documents and receipt texts as settings sections (PUT /workspace/settings/:section).
// A Khalti key comes back as "••••••••" and can only be replaced. After a save `onChanged` reloads the panel's copy (business name, settings cache).
// Rules: nothing is kept in the browser; the server checks every field and the page shows its reasons next to the fields.

import React, { useState } from "react";
import { bizApi, fileToBase64 } from "@sheetal/sdk/client";
import { useApiGet } from "@sheetal/sdk/hooks";
import { SERVER_SECTIONS, defaultTenantSettings, mergeSettings } from "../settingsModel.js";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Badge, Field, Input, PageHead, Panel, SaveBar, Select, Seg, ToggleRow, useToast } from "@sheetal/ui/primitives";
import { Icon } from "@sheetal/shared/core/icons";
import { Link } from "@sheetal/shared/core/router";

export function SettingsPage({ tenant, tab: tabProp, Branding, CodePrefix, onChanged }) {
  const t = useT();
  const { db } = useStore();
  const toast = useToast();
  const loaded = useApiGet("/workspace/settings");
  const { checkups: _checkups, ...sections } = loaded.data || {};
  const saved = mergeSettings(defaultTenantSettings(tenant), sections);
  const savedKey = JSON.stringify(saved);
  const [s, setS] = useState(() => structuredClone(saved));
  const tab = ["profile", "branding", "payments", "notifications", "listings", "documents", "voice"].includes(tabProp) ? tabProp : "profile";
  const [adv, setAdv] = useState(false);
  const plan = db.plans.find((p) => p.id === tenant.planId);
  const allowOwn = db.platformSettings.ownGatewayTypes?.includes?.(tenant.type) ?? true;
  const set = (path, v) => setS((x) => { const n = structuredClone(x); const ks = path.split("."); let o = n; ks.slice(0, -1).forEach((k) => (o = o[k] = o[k] ?? {})); o[ks.at(-1)] = v; return n; });
  const get = (path) => path.split(".").reduce((o, k) => o?.[k], s);
  const dirty = JSON.stringify(s) !== savedKey;
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState({});
  // When the saved settings change (loaded from the server, or just saved), the form follows unless it has edits.
  const lastSaved = React.useRef(savedKey);
  const adopt = React.useRef(false);
  React.useEffect(() => {
    if (adopt.current || JSON.stringify(s) === lastSaved.current) setS(structuredClone(saved));
    adopt.current = false;
    lastSaved.current = savedKey;
  }, [savedKey]);

  const save = async () => {
    setBusy(true);
    try {
      let msg = t("settings.toastSaved");
      if (JSON.stringify(s.profile) !== JSON.stringify(saved.profile)) {
        const p = s.profile;
        const r = await bizApi("PATCH", "/workspace/profile", {
          name: p.displayName?.trim(), city: p.city ?? "", address: p.address ?? "", phone: p.phone ?? "", email: p.email ?? "",
          pan: p.pan ?? "", vatRegistered: !!p.vatRegistered, website: p.website ?? "",
        });
        msg = r.message;
      }
      for (const sec of SERVER_SECTIONS) {
        if (JSON.stringify(s[sec]) === JSON.stringify(saved[sec])) continue;
        const r = await bizApi("PUT", `/workspace/settings/${sec}`, s[sec]);
        msg = r.message;
      }
      loaded.refresh();
      onChanged?.();
      adopt.current = true;
      setErrs({});
      toast(msg);
    } catch (e) {
      setErrs(Object.fromEntries(Object.entries(e.errors || {}).map(([k, m]) => [k, [].concat(m)[0]])));
      toast(e.message);
    } finally { setBusy(false); }
  };
  const pickQr = async (k, file) => {
    try { set(`payments.own.${k}.qr`, (await bizApi("POST", "/workspace/settings/qr", { data: await fileToBase64(file) })).data.url); toast("QR uploaded. Save to keep it."); } catch (e) { toast(e.message); }
  };
  const qrLabel = (k) => { const q = get(`payments.own.${k}.qr`); return q ? (String(q).startsWith("http") ? "Change QR" : q) : t("pay.uploadQr"); };
  React.useEffect(() => setAdv(false), [tab]);

  if (!loaded.data) return loaded.error ? <PageHead title={t("bsettings.title")} sub={loaded.error.message} /> : <div className="sk" style={{ height: 420, borderRadius: "var(--r)" }} />;
  return (
    <>
      <PageHead title={t("bsettings.title")} sub={t("bsettings.sub")}
        actions={!dirty && <span className="small muted">{t("common.allSaved")}</span>} />
      <Panel title={t(`bsettings.${tab}`)} sub={t(`bsettings.${tab}Sub`)} pad className="grow">
          <div className="pf-stack">
            {tab === "voice" && <div className="pf-note"><Icon name="phone-call" size={16} /><span>The AI voice assistant has its own page now, with setup steps and call history: <Link to="/business/voice" className="link">open AI voice assistant</Link>.</span></div>}
            {tab === "profile" && <>
              <div className="pf-grid-2 tight">
                <Field label={t("bsettings.displayName")} error={errs.name}><Input value={get("profile.displayName")} onChange={(e) => set("profile.displayName", e.target.value)} /></Field>
                <Field label={t("tenant.pan")} hint="9 digits" error={errs.pan}><Input className="input tnum" value={get("profile.pan")} onChange={(e) => set("profile.pan", e.target.value.replace(/\D/g, "").slice(0, 9))} /></Field>
              </div>
              <div className="pf-grid-2 tight">
                <Field label={t("common.phone")} error={errs.phone}><Input className="input tnum" value={get("profile.phone")} onChange={(e) => set("profile.phone", e.target.value)} /></Field>
                <Field label={t("common.email")} error={errs.email}><Input value={get("profile.email")} onChange={(e) => set("profile.email", e.target.value)} /></Field>
              </div>
              <div className="pf-grid-2 tight">
                <Field label="City" error={errs.city}><Input value={get("profile.city") ?? ""} onChange={(e) => set("profile.city", e.target.value)} placeholder="e.g. Kathmandu" /></Field>
                <Field label="Website" hint="Your own site, if you have one" error={errs.website}><Input value={get("profile.website") ?? ""} onChange={(e) => set("profile.website", e.target.value)} placeholder="https://" /></Field>
              </div>
              <Field label={t("bsettings.address")} error={errs.address}><Input value={get("profile.address")} onChange={(e) => set("profile.address", e.target.value)} /></Field>
              <ToggleRow title={t("bsettings.vat")} sub={t("bsettings.vatSub")} checked={get("profile.vatRegistered")} onChange={(v) => set("profile.vatRegistered", v)} />
            </>}

            {tab === "branding" && <>
              {Branding && <Branding tenant={tenant} canEdit paid={!!plan?.price} />}
              <h4 className="pf-subhead">Receipts</h4>
              <Advanced open={adv} onToggle={() => setAdv(!adv)}>
                <Field label={t("brand.receiptHeader")}><Input value={get("branding.receiptHeader")} onChange={(e) => set("branding.receiptHeader", e.target.value)} /></Field>
                <Field label={t("brand.receiptFooter")}><Input value={get("branding.receiptFooter")} onChange={(e) => set("branding.receiptFooter", e.target.value)} /></Field>
                <ToggleRow title={t("brand.poweredBy")} sub={plan.features.api ? t("brand.poweredBySub") : t("brand.poweredByLocked")} checked={get("branding.showPoweredBy")} disabled={!plan.features.api} onChange={(v) => set("branding.showPoweredBy", v)} />
              </Advanced>
            </>}

            {tab === "payments" && <>
              {/* Investments on the website: off = visitors send an enquiry; on = an "Invest" form that records a pledge with the amount. */}
              <ToggleRow title="Raise funds online for my investments" sub={get("payments.raiseFunds") ? "On: your investment pages show an Invest form. People pledge an amount; you get it in your Inbox and send them the agreement and payment details." : "Off: your investment pages show only the enquiry form, and you get leads."} checked={!!get("payments.raiseFunds")} onChange={(v) => set("payments.raiseFunds", v)} />
              <div className="pf-mode-pick" role="radiogroup">
                {["shetal", "own"].map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={get("payments.mode") === m} className={get("payments.mode") === m ? "on" : ""} disabled={m === "own" && !allowOwn} onClick={() => set("payments.mode", m)}>
                    <Icon name={m === "shetal" ? "shield-check" : "qr-code"} size={22} /><b>{t(`pay.mode_${m}`)}</b><span>{t(`pay.mode_${m}Sub`, { pct: db.platformSettings.commission[tenant.type === "hotel" || tenant.type === "host" ? "stays" : tenant.type === "developer" ? "projects" : tenant.type === "sponsor" ? "investments" : "agency"] })}</span>
                  </button>
                ))}
              </div>
              {get("payments.mode") === "shetal" ? <>
                <h4 className="pf-subhead">{t("pay.payoutTo")}</h4>
                <div className="pf-grid-2 tight">
                  <Field label={t("pay.bank")}><Select value={get("payments.payoutBank.bank")} onChange={(v) => set("payments.payoutBank.bank", v)} options={db.catalog.banks.map((b) => ({ id: b.en, label: b.en }))} /></Field>
                  <Field label={t("pay.holder")} hint={t("pay.holderHint")}><Input value={get("payments.payoutBank.holder")} onChange={(e) => set("payments.payoutBank.holder", e.target.value)} /></Field>
                </div>
                <div className="pf-note"><Icon name="calendar-days" size={16} />{t("pay.payoutSchedule", { day: t(`day.${db.platformSettings.payoutDay}`), hold: db.platformSettings.payoutHoldDays })}</div>
              </> : <>
                {[["fonepay", "Fonepay QR"], ["esewa", "eSewa"], ["khalti", "Khalti"], ["bankQr", t("pay.bankQr")], ["cash", t("pay.cash")]].map(([k, name]) => (
                  <div key={k} className="pf-gateway">
                    <ToggleRow title={name} sub={t(`pay.gw_${k}`)} checked={get(`payments.own.${k}.on`)} onChange={(v) => set(`payments.own.${k}.on`, v)} />
                    {get(`payments.own.${k}.on`) && k !== "cash" && (
                      <div className="pf-gateway-body">
                        {k !== "bankQr" && <Field label={t("pay.merchantId")}><Input className="input tnum" value={get(`payments.own.${k}.${k === "khalti" ? "key" : "merchant"}`) || ""} onChange={(e) => set(`payments.own.${k}.${k === "khalti" ? "key" : "merchant"}`, e.target.value)} placeholder={t("pay.merchantPh")} /></Field>}
                        {(k === "fonepay" || k === "bankQr") && <Field label={t("pay.qr")}><label className="btn btn-outline"><input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) pickQr(k, f); }} /><Icon name="qr-code" size={16} />{qrLabel(k)}</label></Field>}
                        <Badge tone={get(`payments.own.${k}.${k === "khalti" ? "key" : "merchant"}`) || get(`payments.own.${k}.qr`) ? "done" : "action"}>{get(`payments.own.${k}.${k === "khalti" ? "key" : "merchant"}`) || get(`payments.own.${k}.qr`) ? t("pay.connected") : t("pay.notConnected")}</Badge>
                      </div>
                    )}
                  </div>
                ))}
                <div className="pf-note"><Icon name="info" size={16} />{t("pay.ownNote")}</div>
              </>}
              <Advanced open={adv} onToggle={() => setAdv(!adv)}>
                <Field label={t("pay.advance")}><Seg value={String(get("payments.advancePct"))} onChange={(v) => set("payments.advancePct", Number(v))} options={["0", "20", "30", "50", "100"].map((x) => ({ id: x, label: `${x}%` }))} /></Field>
                <ToggleRow title={t("pay.partial")} sub={t("pay.partialSub")} checked={get("payments.partialAllowed")} onChange={(v) => set("payments.partialAllowed", v)} />
                <ToggleRow title={t("pay.autoReceipt")} sub={t("pay.autoReceiptSub")} checked={get("payments.autoReceipt")} onChange={(v) => set("payments.autoReceipt", v)} />
              </Advanced>
            </>}

            {tab === "notifications" && <>
              <div className="pf-notif-grid" role="table">
                <div role="row" className="head"><span role="columnheader">{t("notif.event")}</span>{["app", "email", "wa"].map((c) => <span key={c} role="columnheader">{t(`notif.${c}`)}</span>)}</div>
                {Object.keys(s.notifications).filter((k) => typeof s.notifications[k] === "object").map((ev) => (
                  <div role="row" key={ev}><span role="cell">{t(`notif.ev_${ev}`)}</span>{["app", "email", "wa"].map((c) => (
                    <span role="cell" key={c}><input type="checkbox" checked={!!s.notifications[ev][c]} onChange={(e) => set(`notifications.${ev}.${c}`, e.target.checked)} aria-label={`${t(`notif.ev_${ev}`)} ${t(`notif.${c}`)}`} /></span>
                  ))}</div>
                ))}
              </div>
              <Advanced open={adv} onToggle={() => setAdv(!adv)}>
                <ToggleRow title={t("notif.daily")} sub={t("notif.dailySub")} checked={get("notifications.dailySummary")} onChange={(v) => set("notifications.dailySummary", v)} />
                <ToggleRow title={t("notif.quiet")} sub={t("notif.quietSub")} checked={get("notifications.quietHours")} onChange={(v) => set("notifications.quietHours", v)} />
              </Advanced>
            </>}

            {tab === "listings" && <>
              {CodePrefix && <CodePrefix tenantId={tenant.id} />}
              <Field label={t("bsettings.defaultVisibility")} hint={t("bsettings.defaultVisibilityHint")}>
                <Seg value={get("listings.defaultVisibility")} onChange={(v) => set("listings.defaultVisibility", v)} options={["public", "unlisted", "private"].map((x) => ({ id: x, label: t(`vis.${x}`) }))} />
              </Field>
              <Field label={t("bsettings.showPhone")}><Seg value={get("listings.showPhone")} onChange={(v) => set("listings.showPhone", v)} options={["always", "after_login", "never"].map((x) => ({ id: x, label: t(`bsettings.phone_${x}`) }))} /></Field>
              <Advanced open={adv} onToggle={() => setAdv(!adv)}>
                <ToggleRow title={t("bsettings.watermark")} sub={t("bsettings.watermarkSub")} checked={get("listings.watermark")} onChange={(v) => set("listings.watermark", v)} />
                <ToggleRow title={t("bsettings.autoRenew")} sub={t("bsettings.autoRenewSub")} checked={get("listings.autoRenew")} onChange={(v) => set("listings.autoRenew", v)} />
              </Advanced>
            </>}

            {tab === "documents" && <>
              <Field label={t("ag.langField")}><Seg value={get("documents.defaultLang")} onChange={(v) => set("documents.defaultLang", v)} options={[{ id: "ne", label: "नेपाली" }, { id: "en", label: "English" }, { id: "both", label: t("ag.both") }]} /></Field>
              <Field label={t("ag.esign")}><Seg value={get("documents.esign")} onChange={(v) => set("documents.esign", v)} options={["otp", "draw", "print"].map((x) => ({ id: x, label: t(`ag.esign_${x}`) }))} /></Field>
              <Field label={t("ag.witnesses")}><Seg value={String(get("documents.witnesses"))} onChange={(v) => set("documents.witnesses", Number(v))} options={["0", "1", "2"].map((x) => ({ id: x, label: x }))} /></Field>
              <ToggleRow title={t("ag.bs")} sub={t("ag.bsSub")} checked={get("documents.bsDates")} onChange={(v) => set("documents.bsDates", v)} />
              <ToggleRow title={t("ag.stamp")} sub={t("ag.stampSub")} checked={get("documents.stampSlot")} onChange={(v) => set("documents.stampSlot", v)} />
            </>}
          </div>
        </Panel>
      <SaveBar dirty={dirty && !busy} onSave={save} onDiscard={() => setS(structuredClone(saved))} />
    </>
  );
}

/** The "Advanced" fold under a settings group (the same as the panel's planBits Advanced). */
function Advanced({ open, onToggle, children }) {
  const t = useT();
  return (
    <div className={`pf-advanced ${open ? "open" : ""}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}><Icon name="sliders-horizontal" size={15} />{t("common.advanced")}<Icon name="chevron-down" size={15} /></button>
      {open && <div className="pf-stack">{children}</div>}
    </div>
  );
}
