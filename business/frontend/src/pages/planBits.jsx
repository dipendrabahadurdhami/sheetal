import React from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { Icon } from "@sheetal/shared/core/icons";
import { Link } from "@sheetal/shared/core/router";

// Plan feature keys (same list the super admin uses for plans)
export { PLAN_FEATURES as FEATURES } from "@sheetal/shared/core/plans";

// Shown instead of a page the current plan doesn't include, or when the listing limit is reached.
export function UpgradeNeeded({ cap }) {
  const t = useT();
  return (
    <div className="card pf-empty-card">
      <div className="pf-empty"><Icon name="rocket" size={40} strokeWidth={1.4} />
        <h3>{t(cap ? "plan.capTitle" : "plan.upTitle")}</h3>
        <p>{cap ? (cap === 1 ? t("plan.capText") : t("plan.capTextPaid", { n: cap })) : t("plan.upText")}</p>
        <Link to="/business/billing" className="btn btn-primary"><Icon name="layers" size={16} />{t("plan.upCta")}</Link>
      </div>
    </div>
  );
}

// "Advanced" fold used in settings pages
export function Advanced({ open, onToggle, children }) {
  const t = useT();
  return (
    <div className={`pf-advanced ${open ? "open" : ""}`}>
      <button type="button" onClick={onToggle} aria-expanded={open}><Icon name="sliders-horizontal" size={15} />{t("common.advanced")}<Icon name="chevron-down" size={15} /></button>
      {open && <div className="pf-stack">{children}</div>}
    </div>
  );
}

