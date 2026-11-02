import { Check, Crown, X } from "lucide-react";
import { PERIODS } from "@sheetal/shared/core/plans";
import { fmtFull, planFeatures } from "../utils/format";

// Plan cards used by the Plans page and My profile → Plan. Plans come from GET /subscription-plans
// (Starter, Business, Pro); each carries its price for every billing period.
const periodLabel = (m) => (m === 1 ? "1 month" : m === 12 ? "1 year" : `${m} months`);

export function PeriodPicker({ value, onChange }) {
  return (
    <div className="seg plan-periods" role="radiogroup" aria-label="Billing period">
      {PERIODS.map((p) => (
        <button key={p.months} type="button" role="radio" aria-checked={value === p.months} className={value === p.months ? "on" : ""} onClick={() => onChange(p.months)}>
          {periodLabel(p.months)}{p.save ? <small> save {p.save}%</small> : null}
        </button>
      ))}
    </div>
  );
}

export function PlanCards({ plans, months, current, busy, onChoose, chooseLabel = "Choose plan" }) {
  const curPrice = plans.find((x) => String(x.name).toLowerCase() === current)?.price;
  return (
    <div className="plans-grid plans-3">
      {plans.map((pl, i) => {
        const isCur = !!current && current === String(pl.name).toLowerCase();
        const per = pl.periods?.find((x) => x.months === months) || { months: 1, price: pl.price, saving: 0 };
        const free = !Number(pl.price);
        return (
          <div key={pl.id} className={`plan-card${isCur ? " is-current" : ""}${i === plans.length - 1 ? " is-top" : ""}`}>
            <div className="plan-head">
              <span className="plan-ico"><Crown size={18} strokeWidth={1.7} /></span>
              <span className="tier">{pl.name}</span>
              {isCur && <span className="tag tag-soft">Current</span>}
            </div>
            <div className="plan-price tnum">{free ? "Free" : fmtFull(per.price)}<small>{free ? " · renews every month" : ` / ${periodLabel(per.months)}`}</small></div>
            {/* Always one line here (empty when there is nothing to say), so the buttons and lists line up across cards. */}
            <span className="small plan-save tnum">{free ? "Free, no card needed" : per.saving > 0 ? `You save ${fmtFull(per.saving)} (${fmtFull(Math.round(per.price / per.months))} a month)` : " "}</span>
            <button className={isCur ? "btn btn-outline btn-block" : "btn btn-primary btn-block"} disabled={isCur || busy === pl.id} style={{ marginTop: 4 }} onClick={() => onChoose(pl, per.months)}>
              {isCur ? "Current plan" : busy === pl.id ? "Sending…" : curPrice != null && pl.price < curPrice ? "Switch to this plan" : chooseLabel}
            </button>
            {/* Every row in the same order on each card, so the three cards line up. */}
            <ul className="plan-feats">{planFeatures(pl).map(([on, t]) => <li key={t} className={on ? "" : "off"}>{on ? <Check size={15} /> : <X size={15} />}<span>{t}</span></li>)}</ul>
          </div>
        );
      })}
    </div>
  );
}
