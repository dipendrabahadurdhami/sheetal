// The Settings menu: every business setting in one list, also searchable with Ctrl K.
// How it works: the settings most businesses use are always shown; the ones set once or rarely (marked `more`) fold under "More settings",
// which opens by itself on one of those pages and remembers being opened. Search (Ctrl K) still finds every setting.

import { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { can } from "@sheetal/shared/core/rbac";
import { Icon } from "@sheetal/shared/core/icons";

export const settingsSections = (role, t) => [
  { group: "Business", items: [
    { id: "profile", to: "/business/settings/profile", icon: "building-2", label: t("bsettings.profile"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "general name pan vat tax address phone email" },
    { id: "verification", to: "/business/settings/verification", icon: "badge-check", label: "Verification", perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "verify kyc documents registration pan certificate badge" },
    { id: "branding", to: "/business/settings/branding", icon: "palette", label: t("bsettings.branding"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "colour color logo receipt brand" },
    { id: "branches", to: "/business/branches", icon: "git-branch", label: t("nav.branches"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "branch office location" },
    { id: "roles", to: "/business/settings/roles", icon: "key-round", label: "Roles and access", perm: "workspace.role.read+workspace.role.create+workspace.role.update+workspace.role.delete", keywords: "roles permissions access staff team" },
    { id: "approvals", more: true, to: "/business/approvals/rules", icon: "shield-check", label: "Approvals", perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "approval approve second person maker checker rules limit refund" },
    { id: "apps", more: true, to: "/business/settings/apps", icon: "layout-grid", label: "App settings", perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "apps app settings expenses approval limit" },
  ] },
  { group: "Plan and money", items: [
    { id: "billing", to: "/business/billing", icon: "credit-card", label: t("nav.plan"), perm: "workspace.billing.manage", keywords: "plan subscription upgrade billing invoice starter business pro" },
    { id: "payments", to: "/business/settings/payments", icon: "wallet", label: t("bsettings.payments"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "esewa khalti fonepay bank payout qr advance cash" },
  ] },
  { group: "Channels and AI", items: [
    { id: "channels", more: true, to: "/business/channels", icon: "message-circle", label: t("nav.bizChannels"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "whatsapp group alerts email facebook instagram messenger web chat" },
    { id: "notifications", to: "/business/settings/notifications", icon: "bell", label: t("bsettings.notifications"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "alerts whatsapp email quiet daily" },
    { id: "ai", more: true, to: "/business/ai-accounts", icon: "sparkles", label: t("nav.aiAccounts"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "ai chatgpt openai gemini claude elevenlabs voice key free" },
  ] },
  { group: "Listings and documents", items: [
    { id: "listings", more: true, to: "/business/settings/listings", icon: "house", label: t("bsettings.listings"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "visibility watermark phone renew" },
    { id: "documents", more: true, to: "/business/settings/documents", icon: "file-pen-line", label: t("bsettings.documents"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "agreement esign witness stamp" },
  ] },
  { group: "Website and data", items: [
    { id: "domains", more: true, to: "/business/domains", icon: "globe", label: t("nav.domains"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "dns website domain email addresses info support" },
    { id: "developers", more: true, to: "/business/developers", icon: "code", label: t("nav.developers"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "api webhook key embed" },
    { id: "data", more: true, to: "/business/data", icon: "database", label: t("nav.data"), perm: "workspace.settings.update+workspace.profile.update+workspace.branding.update+workspace.branch.create+workspace.branch.update+workspace.branch.delete", keywords: "import export backup csv" },
  ] },
].map((g) => ({ ...g, items: g.items.filter((i) => can(role, i.perm)) })).filter((g) => g.items.length);

export function SettingsShell({ role, children }) {
  const t = useT();
  const { path } = useRouter();
  const groups = settingsSections(role, t);
  const isOn = (i) => path === i.to || path.startsWith(i.to + "/") || (i.id === "profile" && path === "/business/settings");
  const main = groups.map((g) => ({ ...g, items: g.items.filter((i) => !i.more) })).filter((g) => g.items.length);
  const more = groups.flatMap((g) => g.items.filter((i) => i.more));
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("sheetal_settings_more") === "1"; } catch { return false; } });
  const showMore = open || more.some(isOn);
  const toggle = () => { const v = !showMore; setOpen(v); try { localStorage.setItem("sheetal_settings_more", v ? "1" : "0"); } catch { /* storage off */ } };
  const link = (i) => { const on = isOn(i); return <Link key={i.id} to={i.to} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}><Icon name={i.icon} size={16} />{i.label}</Link>; };
  return (
    <div className="pf-settings pf-settings-hub">
      <nav className="pf-settings-nav" aria-label={t("nav.settings")}>
        {main.map((g) => (
          <div key={g.group} className="pf-settings-group">
            <span className="pf-nav-group">{g.group}</span>
            {g.items.map(link)}
          </div>
        ))}
        {more.length > 0 && (
          <div className="pf-settings-group">
            <button type="button" className="pf-settings-more" aria-expanded={showMore} onClick={toggle}>
              <Icon name="sliders-horizontal" size={16} /><span>More settings</span><small className="muted">{more.length}</small><Icon name={showMore ? "chevron-up" : "chevron-down"} size={15} />
            </button>
            {showMore && more.map(link)}
          </div>
        )}
      </nav>
      <div className="pf-settings-body">{children}</div>
    </div>
  );
}
