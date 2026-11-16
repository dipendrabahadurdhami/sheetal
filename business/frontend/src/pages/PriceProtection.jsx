// The price-protection card (MB 14.1, P3-FE-1): for a business moved from today's Starter / Business / Pro plans to apps (BE-10), it shows
// the protected price, which apps it covers and when the protection ends; from 60 days before the end, "Choose the apps you keep".
// Where it fits: at the top of the Subscriptions page (Subscriptions.jsx), from `lock` in GET /billing/overview.
// How it works: lockView() in marketplaceLogic.js works out the days left; the numbers are the server's.
// Rules: shown only when the business has a lock; nothing here changes a subscription.

import React from "react";
import { useLang, useT } from "@sheetal/shared/core/i18n";
import { fdate } from "@sheetal/shared/core/format";
import { Link } from "@sheetal/shared/core/router";
import { Icon } from "@sheetal/shared/core/icons";
import { lockView, rsPaisa, textOf } from "./marketplaceLogic";

export function PriceProtection({ lock, catalog, now }) {
  const t = useT();
  const lang = useLang();
  const v = lockView(lock, now);
  if (!v) return null;
  const names = v.coversApps.map((id) => textOf(catalog?.apps?.find((a) => a.id === id)?.name, lang) || id);
  return (
    <section className={`pf-alert ${v.chooseNow && !v.ended ? "action" : "done"}`} aria-labelledby="pp-title">
      <Icon name="shield-check" size={18} />
      <div>
        <b id="pp-title">{v.ended ? t("mkt.ppEnded") : t("mkt.ppTitle")}</b>
        <span>{t("mkt.ppText", { v: rsPaisa(v.monthlyGrossPaisa), d: fdate(v.lockEnd) })}</span>
        {names.length > 0 && <span className="small">{t("mkt.ppCovers", { apps: names.join(", ") })}</span>}
        {!v.ended && v.chooseNow && <span className="small">{t("mkt.ppChooseText", { n: v.daysLeft })}</span>}
      </div>
      {!v.ended && v.chooseNow && <Link to="/business/marketplace" className="btn btn-primary btn-sm">{t("mkt.ppChoose")}</Link>}
    </section>
  );
}
