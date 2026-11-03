import React, { useState } from "react";
import { isStaffLive, liveAdmin } from "../live";
import { OTAS, otaSettings } from "@sheetal/shared/data/ota";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore, uid } from "@sheetal/shared/core/store";
import { can, PLATFORM_PERMS } from "@sheetal/shared/core/rbac";
import { TODAY, inDays } from "@sheetal/shared/core/format";
import { Button, Field, Input, PageHead, Panel, Select, Tabs, ToggleRow, useToast, Badge } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { TeamPanel } from "@sheetal/shared/components/TeamPanel";
import { INTEGRATIONS, STATUS_LABEL, STATUS_TONE, integrationsOf, statusOf, stepsOf } from "@sheetal/shared/data/integrations";
import { RoleEditor } from "@sheetal/shared/components/RoleEditor";

export function AdminStaff({ role }) {
  const t = useT();
  const { db, update } = useStore();
  const [tab, setTab] = useState("staff");
  const counts = {};
  db.platformStaff.forEach((m) => { counts[m.roleId] = (counts[m.roleId] || 0) + 1; });
  const manage = can(role, "staff.manage");
  const toast = useToast();
  // Live: people and their staff role come from the admin API; roles are the fixed staff roles (not editable yet).
  const live = isStaffLive() ? liveAdmin(toast) : null;
  const liveTeam = live && {
    onInvite: (list) => live.inviteStaff(list),
    onUpdateMember: (id, patch) => { if (patch.roleId) live.setStaffRole(id, patch.roleId).catch(() => {}); else if (patch.status) toast("Remove them from staff instead; they are signed out at once."); },
    onRemoveMember: (id) => live.removeStaff(id).catch(() => {}),
    onRestoreMember: () => toast("Add them again to bring them back."),
    onResend: () => {}, onRevoke: () => {},
  };

  return (
    <>
      <PageHead title={t("staff.title")} sub={t("staff.sub")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "staff", label: t("staff.people"), icon: "users" }, { id: "roles", label: t("roles.title"), icon: "key-round" }]} />
      {tab === "staff" && (
        <TeamPanel members={db.platformStaff} invites={db.platformInvites} roles={db.platformRoles} groups={PLATFORM_PERMS} seats={{ limit: -1 }}
          canManage={manage} activity={db.platformActivity}
          onInvite={(list) => update((d) => { list.forEach((i) => d.platformInvites.unshift({ id: uid("pi"), ...i, by: d.session.userName, sent: TODAY, expires: `${inDays(7)}T10:00`, status: "pending" })); })}
          onUpdateMember={(id, patch) => update((d) => { Object.assign(d.platformStaff.find((m) => m.id === id), patch); })}
          onRemoveMember={(id) => update((d) => { d.platformStaff = d.platformStaff.filter((m) => m.id !== id); })}
          onRestoreMember={(m, at) => update((d) => { if (!d.platformStaff.some((x) => x.id === m.id)) d.platformStaff.splice(at >= 0 ? at : d.platformStaff.length, 0, m); })}
          dataKind="staff"
          {...(liveTeam || {})}
          onResend={(id) => update((d) => { Object.assign(d.platformInvites.find((i) => i.id === id), { status: "pending", sent: TODAY, expires: `${inDays(7)}T10:00` }); })}
          onRevoke={(id) => update((d) => { d.platformInvites.find((i) => i.id === id).status = "revoked"; })} />
      )}
      {tab === "roles" && (
        <RoleEditor roles={db.platformRoles} groups={PLATFORM_PERMS} counts={counts} canManage={can(role, "roles.manage") && !live}
          onCreate={(r) => { const id = uid("p-role"); update((d) => { d.platformRoles.push({ id, key: id, system: false, ...r }); }); return id; }}
          onSave={(r) => update((d) => { d.platformRoles[d.platformRoles.findIndex((x) => x.id === r.id)] = r; })}
          onDelete={(id) => update((d) => { d.platformRoles = d.platformRoles.filter((x) => x.id !== id); })} />
      )}
    </>
  );
}

// Platform settings. Separate from each business's own settings (/business/settings).
// Every section shows the basics first; "Advanced" reveals the rest.
export function AdminSettings() {
  const t = useT();
  const { db, update, reset } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState("general");
  const base = { ...db.platformSettings, ota: otaSettings(db) };
  const [s, setS] = useState(() => structuredClone(base));
  const [adv, setAdv] = useState(false);
  const set = (path, v) => setS((x) => { const n = structuredClone(x); const ks = path.split("."); let o = n; ks.slice(0, -1).forEach((k) => (o = o[k])); o[ks.at(-1)] = v; return n; });
  const dirty = JSON.stringify(s) !== JSON.stringify(base);
  const save = () => { update((d) => { d.platformSettings = s; }); toast(t("settings.toastSaved")); };
  const tabs = ["general", "domains", "payments", "money", "channels", "messaging", "languages", "security", "subscriptions"];

  return (
    <>
      <PageHead title={t("psettings.title")} sub={t("psettings.sub")}
        actions={<><span className="small muted">{dirty ? t("common.unsaved") : t("common.allSaved")}</span><Button disabled={!dirty} onClick={save}>{t("common.save")}</Button></>} />
      <div className="pf-settings">
        <nav className="pf-settings-nav" aria-label={t("psettings.title")}>
          {tabs.map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setAdv(false); }}><Icon name={ICON[k]} size={16} />{k === "channels" ? "Other sites" : k === "messaging" ? "Email and messaging" : t(`psettings.${k}`)}</button>)}
        </nav>
        <Panel title={tab === "channels" ? "Selling on other sites" : tab === "messaging" ? "Email and messaging" : t(`psettings.${tab}`)} sub={tab === "messaging" ? "Status of every connected service." : tab === "channels" ? "Booking.com, Airbnb and others, sold under Sheetal's partner accounts. These numbers are shown to businesses before they post." : t(`psettings.${tab}Sub`)} pad className="grow">
          <div className="pf-stack">
            {tab === "general" && <>
              <div className="pf-grid-2 tight"><In s={s} set={set} k="siteName" label={t("psettings.siteName")} /><In s={s} set={set} k="supportEmail" label={t("psettings.supportEmail")} /></div>
              <div className="pf-grid-2 tight"><In s={s} set={set} k="supportPhone" label={t("psettings.supportPhone")} />
                <Field label={t("psettings.timezone")}><Select value={s.timezone} onChange={(v) => set("timezone", v)} options={[{ id: "Asia/Kathmandu", label: "Nepal (UTC+05:45)" }]} /></Field></div>
              <ToggleRow title={t("psettings.showBS")} sub={t("psettings.showBSSub")} checked={s.showBS} onChange={(v) => set("showBS", v)} />
            </>}
            {tab === "domains" && <>
              <div className="pf-note"><Icon name="info" size={16} />{t("psettings.domainsNote")}</div>
              <div className="pf-grid-2 tight"><In s={s} set={set} k="mainDomain" label={t("psettings.mainDomain")} /><In s={s} set={set} k="adminPath" label={t("psettings.adminPath")} hint={t("psettings.adminPathHint")} /></div>
              <div className="pf-grid-2 tight"><In s={s} set={set} k="businessPath" label={t("psettings.businessPath")} /><In s={s} set={set} k="businessDomain" label={t("psettings.businessDomain")} hint={t("psettings.businessDomainHint")} /></div>
              <ToggleRow title={t("psettings.businessDomainLive")} sub={t("psettings.businessDomainLiveSub")} checked={s.businessDomainLive} onChange={(v) => set("businessDomainLive", v)} />
            </>}
            {tab === "payments" && <>
              {[["national", ["fonepay", "esewa", "khalti", "imepay", "connectips", "prabhupay", "nps_card", "bank", "cash"]], ["international", ["visa_mc", "unionpay", "paypal", "stripe", "alipay"]]].map(([grp, keys]) => (
                <React.Fragment key={grp}><h4 className="pf-subhead">{t(`psettings.gw_${grp}`)}</h4>
                  {keys.map((g) => <ToggleRow key={g} title={t(`gateway.${g}`)} sub={t(`gatewaydesc.${g}`)} checked={!!s.gateways[g]} onChange={(v) => set(`gateways.${g}`, v)} />)}</React.Fragment>
              ))}
              <Advanced open={adv} onToggle={() => setAdv(!adv)}>
                <div className="pf-grid-2 tight"><In s={s} set={set} k="gatewayKeys.khalti_public" label="Khalti public key" /><In s={s} set={set} k="gatewayKeys.khalti_secret" label="Khalti secret key" /></div>
                <div className="pf-grid-2 tight"><In s={s} set={set} k="gatewayKeys.esewa_merchant" label="eSewa merchant code" /><In s={s} set={set} k="gatewayKeys.fonepay_merchant" label="Fonepay merchant ID" /></div>
              </Advanced>
            </>}
            {tab === "money" && <>
              <div className="pf-grid-2 tight"><In s={s} set={set} k="vat" num label={t("psettings.vat")} /><In s={s} set={set} k="serviceCharge" num label={t("psettings.serviceCharge")} /></div>
              <Field label={t("psettings.payoutDay")}><Select value={s.payoutDay} onChange={(v) => set("payoutDay", v)} options={["sunday", "monday", "wednesday", "friday"].map((d) => ({ id: d, label: t(`day.${d}`) }))} /></Field>
              <Advanced open={adv} onToggle={() => setAdv(!adv)}>
                <h4 className="pf-subhead">{t("psettings.commission")}</h4>
                <div className="pf-grid-2 tight">{Object.keys(s.commission).map((k) => <In s={s} set={set} key={k} k={`commission.${k}`} num label={t(`psettings.comm_${k}`)} />)}</div>
                <In s={s} set={set} k="payoutHoldDays" num label={t("psettings.payoutHold")} hint={t("psettings.payoutHoldHint")} />
              </Advanced>
            </>}
            {tab === "channels" && <>
              <div className="pf-note"><Icon name="info" size={16} /><span>Partner accounts, contracts and the request queue are in <a className="link" href={window.location.hash.startsWith("#/") ? "#/admin/channels" : "/admin/channels"}>Channel manager</a>.</span></div>
              <div className="pf-table-wrap"><table className="table pf-table pf-ota-set" style={{ minWidth: 640 }}>
                <thead><tr><th>Site</th><th>Offer to businesses</th><th style={{ textAlign: "right" }}>Site fee %</th><th style={{ textAlign: "right" }}>Sheetal fee %</th><th style={{ textAlign: "right" }}>Suggested price +%</th></tr></thead>
                <tbody>{OTAS.map((o) => (
                  <tr key={o.id}><td><b className="pf-strong">{o.name}</b></td>
                    <td><button type="button" role="switch" aria-checked={s.ota.sites[o.id].on} aria-label={o.name} className={`pf-switch ${s.ota.sites[o.id].on ? "on" : ""}`} onClick={() => set(`ota.sites.${o.id}.on`, !s.ota.sites[o.id].on)}><span /></button></td>
                    {["commission", "fee", "markup"].map((k) => <td key={k} style={{ textAlign: "right" }}><input className="input tnum" style={{ width: 84, textAlign: "right" }} inputMode="decimal" value={s.ota.sites[o.id][k]} onChange={(e) => set(`ota.sites.${o.id}.${k}`, Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} aria-label={`${o.name} ${k}`} /></td>)}
                  </tr>))}</tbody></table></div>
              <div className="pf-grid-2 tight"><In s={s} set={set} k="ota.payoutDays" num label="Pay businesses after check-out (days)" hint="Site money reaches Sheetal first, then goes out with the normal payout." /><In s={s} set={set} k="ota.minPhotos" num label="Photos needed before posting" /></div>
              <ToggleRow title="Hotels can ask" sub="Show “Sell on other sites” on hotel listings" checked={s.ota.types.hotel} onChange={(v) => set("ota.types.hotel", v)} />
              <ToggleRow title="Hosts and homestays can ask" sub="Show “Sell on other sites” on host listings" checked={s.ota.types.host} onChange={(v) => set("ota.types.host", v)} />
            </>}
            {tab === "messaging" && <>
              <div className="pf-note"><Icon name="plug" size={16} /><span>Email (own system on Cloudflare), WhatsApp, Facebook and Instagram, Google and AI are connected step by step in the <a className="link" href={window.location.hash.startsWith("#/") ? "#/admin/integrations" : "/admin/integrations"}>Setup center</a>.</span></div>
              <ul className="pf-list">{INTEGRATIONS.filter((x) => !x.to).map((x) => { const st = statusOf(stepsOf(x.id, integrationsOf(db)[x.id], db)); return (
                <li key={x.id}><span className="pf-li-ico"><Icon name={x.icon} size={16} /></span><div><b>{x.name}</b><span className="small muted">{x.sub}</span></div><Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge></li>); })}</ul>
            </>}
            {tab === "languages" && <>
              <ToggleRow title="English" sub={t("psettings.langDefaultSub")} checked={s.languages.en} disabled onChange={() => {}} />
              <ToggleRow title="नेपाली (Nepali)" sub={t("psettings.langNeSub")} checked={s.languages.ne} onChange={(v) => set("languages.ne", v)} />
              <Field label={t("psettings.defaultLang")}><Select value={s.defaultLang} onChange={(v) => set("defaultLang", v)} options={[{ id: "en", label: "English" }, { id: "ne", label: "नेपाली" }]} /></Field>
            </>}
            {tab === "security" && <>
              <ToggleRow title={t("psettings.staff2fa")} sub={t("psettings.staff2faSub")} checked={s.security.staff2fa} onChange={(v) => set("security.staff2fa", v)} />
              <ToggleRow title={t("psettings.business2fa")} sub={t("psettings.business2faSub")} checked={s.security.business2fa} onChange={(v) => set("security.business2fa", v)} />
              <Advanced open={adv} onToggle={() => setAdv(!adv)}>
                <div className="pf-grid-2 tight"><In s={s} set={set} k="security.sessionHours" num label={t("psettings.session")} /><In s={s} set={set} k="security.ipAllow" label={t("psettings.ipAllow")} hint={t("psettings.ipAllowHint")} /></div>
              </Advanced>
            </>}
            {tab === "subscriptions" && <>
              <div className="pf-grid-2 tight"><In s={s} set={set} k="trialDays" num label={t("psettings.trialDays")} /><In s={s} set={set} k="graceDays" num label={t("psettings.graceDays")} /></div>
              <ToggleRow title={t("psettings.autoSuspend")} sub={t("psettings.autoSuspendSub")} checked={s.autoSuspend} onChange={(v) => set("autoSuspend", v)} />
              <ToggleRow title={t("psettings.kycRequired")} sub={t("psettings.kycRequiredSub")} checked={s.kycRequired} onChange={(v) => set("kycRequired", v)} />
              <div className="pf-panel-foot" style={{ margin: "8px -24px -24px" }}>
                <span className="small muted">{t("psettings.resetDemoSub")}</span>
                <Button variant="outline" icon="rotate-ccw" onClick={() => { reset(); toast(t("psettings.toastReset")); }}>{t("psettings.resetDemo")}</Button>
              </div>
            </>}
          </div>
        </Panel>
      </div>
    </>
  );
}

function In({ k, label, hint, num, s, set }) {
  return <Field label={label} hint={hint}><Input className={`input ${num ? "tnum" : ""}`} value={k.split(".").reduce((o, p) => o[p], s)} onChange={(e) => set(k, num ? Number(e.target.value.replace(/[^\d.]/g, "")) : e.target.value)} /></Field>;
}

const ICON = { general: "settings", domains: "globe", payments: "credit-card", money: "percent", channels: "network", messaging: "message-square", languages: "languages", security: "shield-check", subscriptions: "layers" };

export function Advanced({ open, onToggle, children }) {
  const t = useT();
  return (
    <div className={`pf-advanced ${open ? "open" : ""}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}><Icon name="sliders-horizontal" size={15} />{t("common.advanced")}<Icon name="chevron-down" size={15} /></button>
      {open && <div className="pf-stack">{children}</div>}
    </div>
  );
}

// Listing setup: the options every listing form shows.
const CAT_GROUPS = [
  ["categories", "home"], ["facilities", "home"], ["nearby", "home"], ["environments", "home"], ["exteriorLooks", "home"], ["furnishing", "home"],
  ["interiorLooks", "home"], ["facing", "home"], ["propertyStatus", "home"], ["roadType", "home"], ["ownershipDocs", "home"], ["boosts", "home"],
  ["tenants", "rent"], ["utilities", "rent"], ["leaseTerms", "rent"],
  ["stayTypesHotel", "stay"], ["stayTypesUnit", "stay"], ["roomTypes", "stay"], ["bedTypes", "stay"], ["stayAmenities", "stay"], ["houseRules", "stay"], ["cancellation", "stay"],
  ["projectTypes", "project"], ["unitTypes", "project"], ["projectAmenities", "project"], ["banks", "project"],
  ["investTypes", "invest"], ["returnTypes", "invest"], ["payoutFrequency", "invest"],
  ["districts", "location"],
];

export function AdminCatalog() {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const [group, setGroup] = useState("home");
  const [key, setKey] = useState("facilities");
  const [en, setEn] = useState(""); const [ne, setNe] = useState("");
  const items = db.catalog[key] || [];
  const add = () => {
    if (!en.trim()) return;
    update((d) => { d.catalog[key].push({ id: en.trim().toLowerCase().replace(/\W+/g, "_"), en: en.trim(), ne: ne.trim() || en.trim(), icon: "circle-check" }); });
    setEn(""); setNe(""); toast(t("catalog.toastAdded"));
  };
  return (
    <>
      <PageHead title={t("catalog.title")} sub={t("catalog.sub")} />
      <div className="pf-settings">
        <nav className="pf-settings-nav">
          {["home", "rent", "stay", "project", "invest", "location"].map((g) => (
            <React.Fragment key={g}>
              <span className="pf-nav-group">{t(`catalog.g_${g}`)}</span>
              {CAT_GROUPS.filter(([, gg]) => gg === g).map(([k]) => <button key={k} className={key === k ? "on" : ""} onClick={() => { setKey(k); setGroup(g); }}>{t(`catalog.${k}`)}<span className="pf-count">{(db.catalog[k] || []).length}</span></button>)}
            </React.Fragment>
          ))}
        </nav>
        <Panel title={t(`catalog.${key}`)} sub={t("catalog.itemsSub", { n: items.length })} className="grow">
          <ul className="pf-cat-list">
            {items.map((it, i) => (
              <li key={it.id}>
                <span className="pf-cat-ico"><Icon name={it.icon} size={18} /></span>
                <span className="pf-two"><b>{it.en}</b><small>{it.ne}</small></span>
                <code className="tiny muted">{it.id}</code>
                <div className="pf-row-actions">
                  <button className="btn btn-ghost btn-icon" aria-label={t("catalog.up")} disabled={i === 0} onClick={() => update((d) => { const a = d.catalog[key]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; })}><Icon name="arrow-up" size={15} /></button>
                  <button className="btn btn-ghost btn-icon" aria-label={t("common.delete")} onClick={() => update((d) => { d.catalog[key].splice(i, 1); })}><Icon name="trash-2" size={15} /></button>
                </div>
              </li>
            ))}
          </ul>
          <div className="pf-panel-foot">
            <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder={t("catalog.enPh")} style={{ flex: 1 }} />
            <Input value={ne} onChange={(e) => setNe(e.target.value)} placeholder={t("catalog.nePh")} style={{ flex: 1 }} />
            <Button icon="plus" onClick={add}>{t("common.add")}</Button>
          </div>
        </Panel>
      </div>
      <p className="pf-hint"><Badge tone="neutral" icon="info">{t(`catalog.g_${group}`)}</Badge> {t("catalog.note")}</p>
    </>
  );
}
