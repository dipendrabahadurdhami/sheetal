// The upgrade prompts every app shares (MB 14.2, P3-FE-2): LimitBanner (80% of a limit), UpgradePanel (a hard stop or a paid feature),
// EditionBadge (a "Full" chip on a paid feature), AiLocked (a locked AI preview), ReadOnlyBanner (a paused or ended subscription), and
// BillingPrompts, which shows the UpgradePanel when any API call fails with a billing error.
// Where it fits: the business panel shell (BusinessApp.jsx) mounts BillingPrompts and ReadOnlyBanner for a business on `apps` (and the
// panel, without the 80% banner, on `shadow`); apps put LimitBanner, EditionBadge and AiLocked on their own pages.
// How it works: plain components; the numbers come from the server (`details` of the error, or GET /entitlements). Links go to the
// marketplace drawer (/business/marketplace?app=<id>), billing and the data export.
// Rules: never a modal over unsaved work (the panel is a card at the bottom of the screen); the same words everywhere; no model call in
// AiLocked; browser storage only for "dismissed" (UI state).

import React, { useEffect, useState } from "react";
import { Icon } from "@sheetal/shared/core/icons";
import { useT } from "@sheetal/shared/core/i18n";
import { Link } from "@sheetal/shared/core/router";
import { bannerVisible, onBillingError, pctUsed } from "./errors.js";

/** Paisa as "Rs. 700" / "Rs. 700.50" (integers only). */
export const rsPaisa = (p) => {
  const v = Math.round(Number(p) || 0), a = Math.abs(v), ps = a % 100;
  return `${v < 0 ? "− " : ""}Rs. ${Math.floor(a / 100).toLocaleString("en-IN")}${ps ? `.${String(ps).padStart(2, "0")}` : ""}`;
};
const words = (k) => { const s = String(k || "").replace(/[_.]+/g, " ").trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; };
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch { return {}; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: the banner just shows again */ } },
};

/** At 80% of a limit, under the page title: dismiss hides it for 7 days. `used`/`limit` come from the page's data and GET /entitlements. */
export function LimitBanner({ appId, limitKey, label, used, limit, formOpen, now }) {
  const t = useT();
  const key = `sheetal_limit_${appId}_${limitKey}`;
  const [seen, setSeen] = useState(() => store.get(key));
  if (!bannerVisible({ used, limit, seen, now, formOpen })) return null;
  const full = pctUsed(used, limit) >= 100;
  const dismiss = () => { const v = { ...seen, dismissedAt: Date.now() }; store.set(key, v); setSeen(v); };
  return (
    <div className={`pf-alert ${full ? "action" : "progress"}`} role="status">
      <Icon name="circle-alert" size={18} />
      <div><b>{full ? t("bp.limitFull", { what: label || words(limitKey) }) : t("bp.limitNear", { what: label || words(limitKey) })}</b>
        <span className="tnum">{t("bp.used", { used: Number(used).toLocaleString("en-IN"), limit: Number(limit).toLocaleString("en-IN") })}</span></div>
      <div className="pf-row-actions">
        <Link to={`/business/marketplace?app=${appId}`} className="btn btn-primary btn-sm">{t("bp.upgrade")}</Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>{t("bp.dismiss")}</button>
      </div>
    </div>
  );
}

/** What happened, the exact numbers, the next edition and its price, Upgrade and Not now (MB 14.2). */
export function UpgradePanel({ prompt, appName, editionName, onClose }) {
  const t = useT();
  if (!prompt) return null;
  const to = prompt.appId ? `/business/marketplace?app=${prompt.appId}` : "/business/marketplace";
  const title = prompt.kind === "limit" ? t("bp.limitTitle") : prompt.kind === "feature" ? t("bp.featureTitle") : prompt.kind === "app" ? t("bp.appTitle") : t("bp.readOnlyTitle");
  return (
    <aside className="card pf-pad pf-stack" role="alert" aria-label={title}
      style={{ position: "fixed", right: 16, bottom: 16, left: "auto", maxWidth: "min(420px, calc(100vw - 32px))", zIndex: 60 }}>
      <div className="pf-row-actions" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <b>{title}</b>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t("bp.notNow")} onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <span>{prompt.message}</span>
      {prompt.kind === "limit" && prompt.limit != null && prompt.used != null && (
        <span className="small tnum">{t("bp.used", { used: prompt.used.toLocaleString("en-IN"), limit: prompt.limit.toLocaleString("en-IN") })}</span>
      )}
      {prompt.tryEdition && (
        <span className="small">{prompt.tryPricePaisa != null
          ? t("bp.tryWith", { app: appName || "", edition: editionName || words(prompt.tryEdition), v: rsPaisa(prompt.tryPricePaisa) })
          : t("bp.tryWithNoPrice", { app: appName || "", edition: editionName || words(prompt.tryEdition) })}</span>
      )}
      <div className="pf-row-actions" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t("bp.notNow")}</button>
        <Link to={prompt.kind === "read_only" ? "/business/billing" : to} className="btn btn-primary btn-sm" onClick={onClose}>{prompt.kind === "read_only" ? t("bp.renew") : t("bp.upgrade")}</Link>
      </div>
    </aside>
  );
}

/** Shows the UpgradePanel when any API call fails with a billing error. `names(appId, editionId)` gives display names from the catalog. */
export function BillingPrompts({ names }) {
  const [prompt, setPrompt] = useState(null);
  useEffect(() => onBillingError(setPrompt), []);
  const n = prompt && names ? names(prompt.appId, prompt.tryEdition) : {};
  return <UpgradePanel prompt={prompt} appName={n.app} editionName={n.edition} onClose={() => setPrompt(null)} />;
}

/** A "Full" chip on a paid feature with a short tooltip; clicking opens the same drawer as the marketplace. */
export function EditionBadge({ appId, label }) {
  const t = useT();
  return (
    <Link to={`/business/marketplace?app=${appId}`} className="pf-badge progress" title={t("bp.badgeTip")} aria-label={`${label || t("bp.full")}: ${t("bp.badgeTip")}`}>
      <Icon name="sparkles" size={13} />{label || t("bp.full")}
    </Link>
  );
}

/** A locked AI feature: a sample of what it would write and "Turn on AI". Never calls a model. */
export function AiLocked({ sample, title }) {
  const t = useT();
  return (
    <section className="card pf-pad pf-stack" aria-label={title || t("bp.aiTitle")}>
      <b><Icon name="sparkles" size={15} /> {title || t("bp.aiTitle")}</b>
      {sample && <blockquote className="small muted" style={{ margin: 0, opacity: 0.75 }} aria-label={t("bp.aiSample")}>{sample}</blockquote>}
      <span className="small">{t("bp.aiText")}</span>
      <div><Link to="/business/ai-accounts" className="btn btn-primary btn-sm">{t("bp.aiOn")}</Link></div>
    </section>
  );
}

/** At the top of an app that can't take changes: explains, links to billing and to the export. */
export function ReadOnlyBanner({ appName, access }) {
  const t = useT();
  if (access !== "read_only" && access !== "locked") return null;
  return (
    <div className="pf-alert action" role="status">
      <Icon name="lock" size={18} />
      <div><b>{access === "locked" ? t("bp.lockedTitle", { app: appName }) : t("bp.readOnlyBanner", { app: appName })}</b><span>{t("bp.readOnlyText")}</span></div>
      <div className="pf-row-actions">
        <Link to="/business/billing" className="btn btn-primary btn-sm">{t("bp.renew")}</Link>
        <Link to="/business/data" className="btn btn-ghost btn-sm">{t("bp.export")}</Link>
      </div>
    </div>
  );
}
