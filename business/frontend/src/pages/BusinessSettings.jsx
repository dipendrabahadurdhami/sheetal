import React, { useState } from "react";
import { isLive, profileOf, saveProfile } from "../live";
import { BrandFromLogo } from "./BrandFromLogo";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Badge, Field, Input, PageHead, Panel, SaveBar, Select, Seg, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { Advanced } from "./planBits";
import { Link } from "@sheetal/shared/core/router";

// Brand presets stay inside the logo palette by default; businesses may also enter their own hex.
export const BRAND_PRESETS = ["#9D1D21", "#EA2229", "#59595B", "#1F6F5C", "#1E4E8C", "#7A4B12", "#5B3B8C", "#0F766E"];

export const defaultTenantSettings = (tenant) => ({
  profile: { displayName: tenant.name, city: tenant.city || "", phone: tenant.phone || "", email: tenant.email || "", address: tenant.address ?? (tenant.city ? `${tenant.city}, Nepal` : ""), pan: tenant.pan || "", vatRegistered: tenant.vatRegistered ?? true, website: tenant.website || "" },
  branding: { useBrand: false, color: "#9D1D21", logoText: tenant.name.split(" ").map((w) => w[0]).slice(0, 2).join(""), receiptHeader: tenant.name, receiptFooter: "Thank you. Please visit again.", showPoweredBy: true },
  payments: {
    mode: "shetal", // shetal = Sheetal collects and pays out; own = money goes straight to the business
    payoutBank: { bank: "", holder: tenant.owner, account: "", branch: tenant.city }, // filled in by the business
    own: { fonepay: { on: true, merchant: "", qr: null }, esewa: { on: false, merchant: "" }, khalti: { on: false, key: "" }, bankQr: { on: true, bank: "", qr: null }, cash: { on: true } },
    advancePct: 30, autoReceipt: true, partialAllowed: true,
  },
  notifications: { newBooking: { app: true, sms: true, email: true, wa: true }, payment: { app: true, sms: false, email: true, wa: true }, lead: { app: true, sms: false, email: false, wa: true }, agreement: { app: true, sms: true, email: true, wa: false }, dailySummary: true, quietHours: true },
  listings: { defaultVisibility: "public", autoRenew: true, watermark: true, showPhone: "after_login" },
  documents: { defaultLang: "both", witnesses: 2, esign: "otp", stampSlot: true, bsDates: true },
});

export function BusinessSettings({ tenant, tab: tabProp }) {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const saved = db.tenantSettings[tenant.id] || defaultTenantSettings(tenant);
  const [s, setS] = useState(() => structuredClone(saved));
  const tab = ["profile", "branding", "payments", "notifications", "listings", "documents", "voice"].includes(tabProp) ? tabProp : "profile";
  const [adv, setAdv] = useState(false);
  const plan = db.plans.find((p) => p.id === tenant.planId);
  const allowOwn = db.platformSettings.ownGatewayTypes?.includes?.(tenant.type) ?? true;
  const set = (path, v) => setS((x) => { const n = structuredClone(x); const ks = path.split("."); let o = n; ks.slice(0, -1).forEach((k) => (o = o[k])); o[ks.at(-1)] = v; return n; });
  const get = (path) => path.split(".").reduce((o, k) => o?.[k], s);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState({});
  const save = async () => {
    // Signed in: the profile is saved on the server (it shows on the website, bills and invoices); the other
    // settings stay with the panel for now.
    if (isLive(tenant.id) && JSON.stringify(s.profile) !== JSON.stringify(saved.profile)) {
      setBusy(true);
      try {
        const r = await saveProfile(s.profile);
        const p = r.data;
        update((d) => {
          const x = d.tenants.find((y) => y.id === tenant.id);
          if (x) Object.assign(x, { name: p.name, city: p.city || "", address: p.address || "", phone: p.phone || "", email: p.email || "", pan: p.pan || "", vatRegistered: p.vatRegistered, website: p.website || "" });
          d.tenantSettings[tenant.id] = { ...s, profile: profileOf(x) };
        });
        setErrs({});
        toast(r.message);
      } catch (e) {
        setErrs(Object.fromEntries(Object.entries(e.errors || {}).map(([k, m]) => [k, [].concat(m)[0]])));
        toast(e.message);
      } finally { setBusy(false); }
      return;
    }
    update((d) => { d.tenantSettings[tenant.id] = s; });
    toast(t("settings.toastSaved"));
  };
  React.useEffect(() => setAdv(false), [tab]);

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
              {isLive(tenant.id) ? <BrandFromLogo tenant={tenant} canEdit paid={!!plan.price} /> : <>
              <ToggleRow title={t("brand.use")} sub={t("brand.useSub")} checked={get("branding.useBrand")} onChange={(v) => set("branding.useBrand", v)} />
              <Field label={t("brand.color")}>
                <div className="pf-swatches">
                  {BRAND_PRESETS.map((c) => <button key={c} type="button" style={{ background: c }} className={get("branding.color") === c ? "on" : ""} aria-label={c} aria-pressed={get("branding.color") === c} onClick={() => set("branding.color", c)} />)}
                  <label className="pf-swatch-custom"><input type="color" value={get("branding.color")} onChange={(e) => set("branding.color", e.target.value)} aria-label={t("brand.custom")} /><span className="tnum">{get("branding.color")}</span></label>
                </div>
              </Field>
              <div className="pf-grid-2 tight">
                <Field label={t("brand.logoText")} hint={t("brand.logoHint")}><Input value={get("branding.logoText")} maxLength={3} onChange={(e) => set("branding.logoText", e.target.value.toUpperCase())} /></Field>
                <Field label={t("brand.logo")}><label className="btn btn-outline"><input type="file" accept="image/*" hidden /><Icon name="upload" size={16} />{t("brand.uploadLogo")}</label></Field>
              </div>
              <BrandPreview s={s} tenant={tenant} />
              </>}
              <h4 className="pf-subhead">Receipts</h4>
              <Advanced open={adv} onToggle={() => setAdv(!adv)}>
                <Field label={t("brand.receiptHeader")}><Input value={get("branding.receiptHeader")} onChange={(e) => set("branding.receiptHeader", e.target.value)} /></Field>
                <Field label={t("brand.receiptFooter")}><Input value={get("branding.receiptFooter")} onChange={(e) => set("branding.receiptFooter", e.target.value)} /></Field>
                <ToggleRow title={t("brand.poweredBy")} sub={plan.features.api ? t("brand.poweredBySub") : t("brand.poweredByLocked")} checked={get("branding.showPoweredBy")} disabled={!plan.features.api} onChange={(v) => set("branding.showPoweredBy", v)} />
              </Advanced>
            </>}

            {tab === "payments" && <>
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
                        {(k === "fonepay" || k === "bankQr") && <Field label={t("pay.qr")}><label className="btn btn-outline"><input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && set(`payments.own.${k}.qr`, e.target.files[0].name)} /><Icon name="qr-code" size={16} />{get(`payments.own.${k}.qr`) || t("pay.uploadQr")}</label></Field>}
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
                    <span role="cell" key={c}><input type="checkbox" checked={s.notifications[ev][c]} onChange={(e) => set(`notifications.${ev}.${c}`, e.target.checked)} aria-label={`${t(`notif.ev_${ev}`)} ${t(`notif.${c}`)}`} /></span>
                  ))}</div>
                ))}
              </div>
              <ToggleRow title={t("notif.daily")} sub={t("notif.dailySub")} checked={get("notifications.dailySummary")} onChange={(v) => set("notifications.dailySummary", v)} />
              <ToggleRow title={t("notif.quiet")} sub={t("notif.quietSub")} checked={get("notifications.quietHours")} onChange={(v) => set("notifications.quietHours", v)} />
            </>}

            {tab === "listings" && <>
              <Field label={t("bsettings.defaultVisibility")} hint={t("bsettings.defaultVisibilityHint")}>
                <Seg value={get("listings.defaultVisibility")} onChange={(v) => set("listings.defaultVisibility", v)} options={["public", "unlisted", "private"].map((x) => ({ id: x, label: t(`vis.${x}`) }))} />
              </Field>
              <Field label={t("bsettings.showPhone")}><Seg value={get("listings.showPhone")} onChange={(v) => set("listings.showPhone", v)} options={["always", "after_login", "never"].map((x) => ({ id: x, label: t(`bsettings.phone_${x}`) }))} /></Field>
              <ToggleRow title={t("bsettings.watermark")} sub={t("bsettings.watermarkSub")} checked={get("listings.watermark")} onChange={(v) => set("listings.watermark", v)} />
              <ToggleRow title={t("bsettings.autoRenew")} sub={t("bsettings.autoRenewSub")} checked={get("listings.autoRenew")} onChange={(v) => set("listings.autoRenew", v)} />
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
      <SaveBar dirty={dirty} onSave={save} onDiscard={() => setS(structuredClone(saved))} />
    </>
  );
}

function BrandPreview({ s, tenant }) {
  const t = useT();
  const c = s.branding.color;
  return (
    <div className="pf-brand-prev" style={{ "--brand": c }}>
      <div className="pf-brand-prev-side"><span className="pf-ws-logo" style={{ background: c }}>{s.branding.logoText}</span><b>{s.profile.displayName}</b></div>
      <div className="pf-brand-prev-body">
        <div className="pf-brand-prev-receipt">
          <b>{s.branding.receiptHeader}</b><span className="tiny muted tnum">PAN {s.profile.pan}</span>
          <div className="pf-rcpt-line"><span>Deluxe room × 2 nights</span><span className="tnum">Rs. 13,000</span></div>
          <div className="pf-rcpt-line"><span>Breakfast × 2</span><span className="tnum">Rs. 1,600</span></div>
          <div className="pf-rcpt-line total"><span>{t("pos.total")}</span><span className="tnum">Rs. 16,498</span></div>
          <span className="tiny muted">{s.branding.receiptFooter}</span>
        </div>
        <button type="button" className="pf-brand-btn" style={{ background: c }}>{t("pos.charge")}</button>
        {s.branding.showPoweredBy && <span className="tiny muted">{t("brand.poweredByText")}</span>}
      </div>
    </div>
  );
}
