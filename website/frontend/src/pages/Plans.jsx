import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useApp } from "../context/AppContext";
import { api } from "../api/endpoints";
import { toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { PageHead } from "../components/ui";
import { PeriodPicker, PlanCards } from "../components/PlanCards";
import { useSEO } from "../utils/seo";

// Public subscription page: anyone can see the plans; choosing one asks to sign in first,
// then sends the same upgrade request as My account → Plan.
const TYPES = [["agency", "Agencies"], ["hotel", "Hotels"], ["host", "Hosts"], ["developer", "Developers"], ["sponsor", "Sponsors"]];

export default function Plans() {
  useSEO("Plans", "Starter is free. Business and Pro plans for agencies, hotels, hosts, developers and sponsors, by the month or the year.");
  const { user, setAuth, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const type = TYPES.some(([k]) => k === params.get("type")) ? params.get("type") : "agency";
  const [months, setMonths] = useState(12);
  const { data, loading } = useAsync(() => api.plans(type).then(toList), [type]);
  const [busy, setBusy] = useState(null);
  const pending = useRef(null);
  const plans = data?.items || [];
  const current = type === "agency" ? String(user?.plan || "").toLowerCase() : "";

  const send = async (pl, m) => {
    setBusy(pl.id);
    try { const r = await api.requestUpgrade(pl.id, m); toast(r?.message || `Request sent for ${pl.name}. Our team will contact you.`); }
    catch { toast("Could not send the request. Please try again."); }
    setBusy(null);
  };
  const choose = (pl, m) => { if (!user) { pending.current = [pl, m]; setAuth("login"); return; } send(pl, m); };
  // finish the request right after a successful sign-in
  useEffect(() => { if (user && pending.current) { const [pl, m] = pending.current; pending.current = null; send(pl, m); } }, [user]);

  return (
    <>
      <div className="tools-hero plans-hero"><PageHead crumbs={[{ label: "Plans" }]} title="Plans for every business">Start free with one listing. Upgrade to Business or Pro when you need more.</PageHead></div>
      <div className="container section-sm">
        {/* Business type on the left, billing period on the right: the row spans the same width as the cards. */}
        <div className="plans-bar">
          <div className="seg plan-periods" role="tablist" aria-label="Business type">
            {TYPES.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={type === k} className={type === k ? "on" : ""} onClick={() => setParams({ type: k })}>{l}</button>)}
          </div>
          <PeriodPicker value={months} onChange={setMonths} />
        </div>
        {!user && (
          <div className="plans-note">
            <LogIn size={16} />
            <span>You can compare plans now. You will be asked to sign in when you choose one.</span>
          </div>
        )}
        {loading ? <div className="plans-grid plans-3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="sk" style={{ height: 320, borderRadius: "var(--r)" }} />)}</div>
          : <PlanCards plans={plans} months={months} current={current} busy={busy} onChoose={choose} chooseLabel={user ? "Request this plan" : "Sign in to choose"} />}
        <p className="small muted" style={{ textAlign: "center", marginTop: 24 }}>Already a business? Manage your plan in <Link to="/my-profile?tab=plan" className="link">My account</Link> or your <a href="/business/billing" className="link">business workspace</a>.</p>
      </div>
    </>
  );
}
