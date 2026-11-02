import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { Modal } from "./ui";

// Asked once per account after the first sign-in. Answers are kept in "sheetal_prefs".
const GOALS = [["buy", "Buy a home or land"], ["rent", "Rent a place"], ["sell", "Sell or rent out my property"], ["stay", "Book a stay"], ["invest", "Invest"]];
const CITIES = ["Kathmandu", "Lalitpur", "Bhaktapur", "Pokhara", "Chitwan", "Other"];
const BUDGETS = { buy: ["Under 1 crore", "1 to 3 crore", "3 to 5 crore", "Above 5 crore"], rent: ["Under Rs. 20,000 a month", "Rs. 20,000 to 50,000", "Above Rs. 50,000"] };
const keyOf = (u) => `sheetal_onboarded_${u.id || u.email}`;

export function Onboarding() {
  const { user, toast } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState("");
  const [city, setCity] = useState("");
  const [budget, setBudget] = useState("");
  useEffect(() => { if (!user) return; try { if (!localStorage.getItem(keyOf(user))) setOpen(true); } catch { /* storage off */ } }, [user]);
  if (!user || !open) return null;
  const total = BUDGETS[goal] ? 3 : 2;
  const last = step === total - 1;
  const ok = [goal, city, budget][step];
  const finish = (skip) => {
    try { localStorage.setItem(keyOf(user), "1"); if (!skip) localStorage.setItem("sheetal_prefs", JSON.stringify({ goal, city, budget })); } catch { /* storage off */ }
    setOpen(false);
    if (skip) return;
    toast("Saved. We'll show you matches first.");
    const where = city && city !== "Other" ? `?keyword=${encodeURIComponent(city)}` : "";
    nav(goal === "sell" ? "/post-property" : goal === "stay" ? "/stays" : goal === "invest" ? "/investment" : where ? `/search${where}` : goal === "rent" ? "/rent" : "/sale");
  };
  const titles = ["What brings you to Sheetal?", "Which city?", goal === "rent" ? "Monthly budget" : "Budget"];
  const opts = [GOALS, CITIES.map((c) => [c, c]), (BUDGETS[goal] || []).map((b) => [b, b])][step];
  const val = [goal, city, budget][step];
  const pick = [setGoal, setCity, setBudget][step];
  return (
    <Modal open onClose={() => finish(true)}>
      <div className="stack" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny muted tnum">Step {step + 1} of {total}</span>
          <h2 style={{ fontSize: 24, paddingRight: 40 }}>{titles[step]}</h2>
          <p className="muted small">{step === 0 ? `Welcome${user.user_name ? ", " + user.user_name : ""}. Two quick questions so we can show you the right places first.` : "You can change this any time."}</p>
        </div>
        <div className="onb-grid" role="radiogroup" aria-label={titles[step]}>
          {opts.map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={val === k} className={`chip ${val === k ? "active" : ""}`} onClick={() => pick(k)}>{l}</button>)}
        </div>
        <div className="row between">
          <button type="button" className="btn btn-ghost" onClick={() => (step ? setStep(step - 1) : finish(true))}>{step ? "Back" : "Skip for now"}</button>
          <button type="button" className="btn btn-primary" disabled={!ok} onClick={() => (last ? finish(false) : setStep(step + 1))}>{last ? "Show me matches" : "Continue"}</button>
        </div>
      </div>
    </Modal>
  );
}
