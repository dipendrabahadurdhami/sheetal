// Property tools: land unit converter, EMI and other calculators.

import { useMemo, useState } from "react";
import { useSEO } from "../utils/seo";
import { ToolCalc } from "../market/SiteRows";
import { NavLink, useParams } from "react-router-dom";
import { Calculator, Ruler, TrendingUp, KeyRound, Landmark, Receipt, Wallet } from "lucide-react";
import { PageHead } from "../components/ui";
import { fmtFull, fmtPrice } from "../utils/format";

const TOOLS = [["emi", "Home loan EMI", Calculator], ["units", "Land unit converter", Ruler], ["land-price", "Land price estimator", Landmark], ["property-tax", "Property tax estimator", Receipt], ["roi", "Rental yield", TrendingUp], ["rent-vs-buy", "Rent vs buy", KeyRound], ["afford", "Affordability", Wallet], ["invest-return", "Investment return", TrendingUp], ["host-income", "Host income", Wallet], ["pay-schedule", "Project payment schedule", Landmark]];

const ZONES = [
  ["Kathmandu Valley", [["Naxal / Lazimpat / Baluwatar", 3e6, 12e6], ["Maharajgunj / Bansbari", 2e6, 6e6], ["Koteshwor / Tinkune", 1.2e6, 3.5e6], ["Imadol / Bhaisepati / Thasikhel", 8e5, 2.5e6], ["Budhanilkantha / Tokha", 6e5, 1.8e6], ["Godawari / Lubhu", 4e5, 1.2e6]]],
  ["Lalitpur / Patan", [["Patan Core / Mangalbazar", 1.5e6, 5e6], ["Ekantakuna / Sanepa", 1e6, 3e6], ["Tikathali / Harisiddhi", 5e5, 1.5e6]]],
  ["Bhaktapur", [["Bhaktapur Core", 6e5, 2e6], ["Suryabinayak / Balkot", 4e5, 1e6]]],
  ["Pokhara", [["Lakeside / Birauta", 8e5, 3e6], ["Pokhara Urban Outskirts", 4e5, 1.2e6]]],
  ["Terai Cities (per kattha)", [["Birgunj City Core", 8e5, 3e6, 1], ["Butwal / Siddharthanagar", 6e5, 2e6, 1], ["Bharatpur / Chitwan", 5e5, 1.8e6, 1], ["Dhangadhi / Nepalgunj", 3e5, 1e6, 1], ["Terai Agricultural Land", 1e5, 4e5, 1]]],
];
const SQM = { aana: 31.795, ropani: 508.72, kattha: 338.63, "sq.ft": 0.0929 };
const USE = [["Residential", 1], ["Commercial", 1.35], ["Mixed use", 1.15], ["Agricultural", 0.45]];

function LandPrice() {
  const [z, setZ] = useState(0), [a, setA] = useState(0), [use, setUse] = useState(0), [v, setV] = useState(4), [u, setU] = useState("aana");
  const area = ZONES[z][1][a] || ZONES[z][1][0];
  const base = area[3] ? SQM.kattha : SQM.aana;
  const sqm = v * SQM[u], mult = USE[use][1];
  const lo = (area[1] * mult / base) * sqm, hi = (area[2] * mult / base) * sqm;
  return (
    <div className="grid-2" style={{ gap: 40 }}>
      <div className="stack" style={{ gap: 18 }}>
        <div className="field"><label>Region</label><select className="select" value={z} onChange={(e) => { setZ(+e.target.value); setA(0); }}>{ZONES.map(([r], i) => <option key={r} value={i}>{r}</option>)}</select></div>
        <div className="field"><label>Area</label><select className="select" value={a} onChange={(e) => setA(+e.target.value)}>{ZONES[z][1].map(([l], i) => <option key={l} value={i}>{l}</option>)}</select></div>
        <div className="field"><label>Land use</label><div className="seg" style={{ flexWrap: "wrap" }}>{USE.map(([l], i) => <button key={l} className={use === i ? "on" : ""} onClick={() => setUse(i)}>{l}</button>)}</div></div>
        <div className="field"><label>Land size</label><div className="row" style={{ gap: 8 }}><input className="input tnum" type="number" value={v} onChange={(e) => setV(+e.target.value)} /><select className="select" style={{ maxWidth: 140 }} value={u} onChange={(e) => setU(e.target.value)}>{Object.keys(SQM).map((k) => <option key={k}>{k}</option>)}</select></div></div>
      </div>
      <div className="result-box stack" style={{ gap: 14 }}>
        <div><span className="small muted">Estimated market value</span><b className="tnum">{fmtPrice(lo)} – {fmtPrice(hi)}</b></div>
        <div className="small muted tnum">Base rate {fmtPrice(area[1])} – {fmtPrice(area[2])} per {area[3] ? "kattha" : "aana"}{mult !== 1 ? ` · ${mult > 1 ? "+" : ""}${Math.round((mult - 1) * 100)}% for ${USE[use][0].toLowerCase()}` : ""}</div>
        <p className="tiny muted">General market benchmarks. Road access, shape and frontage can move the price a lot. Government valuation (मूल्याङ्कन) usually differs from market rate.</p>
      </div>
    </div>
  );
}

const MUNI = [["Kathmandu Metropolitan City", 0.008, "Metro"], ["Lalitpur Metropolitan City", 0.007, "Metro"], ["Bhaktapur Municipality", 0.006, "Sub-Metro"], ["Pokhara Metropolitan City", 0.006, "Metro"], ["Birgunj Metropolitan City", 0.005, "Metro"], ["Bharatpur Metropolitan City", 0.005, "Metro"], ["Other Sub-Metropolitan City", 0.005, "Sub-Metro"], ["Municipality (Nagar Palika)", 0.004, "Municipal"], ["Rural Municipality (Gaun Palika)", 0.002, "Rural"]];
function PropertyTax() {
  const [m, setM] = useState(0), [val, setVal] = useState(15000000), [govt, setGovt] = useState(""), [use, setUse] = useState("own"), [rent, setRent] = useState(40000), [years, setYears] = useState(6);
  const muni = MUNI[m], g = Number(govt) || val * 0.6;
  const house = g * muni[1];
  const annualRent = rent * 12;
  const rentalTax = use === "rented" ? annualRent * 0.1 : use === "commercial" ? annualRent * 0.15 : use === "mixed" ? annualRent * 0.05 : 0;
  const fee = muni[2] === "Metro" ? 3000 : muni[2] === "Sub-Metro" ? 2000 : 1000;
  const regPct = muni[2] === "Metro" ? 0.05 : muni[2] === "Sub-Metro" ? 0.045 : 0.04;
  const reg = g * regPct, stamp = g * 0.005, comm = val * 0.015, cgt = use === "own" ? 0 : val * 0.25 * (years >= 5 ? 0.025 : 0.05);
  const Row = ({ l, v, note }) => <div className="row between" style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}><span className="small">{l}{note && <span className="tiny muted" style={{ display: "block" }}>{note}</span>}</span><strong className="tnum" style={{ fontWeight: 500, color: "var(--text-strong)", whiteSpace: "nowrap" }}>{fmtFull(Math.round(v))}</strong></div>;
  return (
    <div className="grid-2" style={{ gap: 40 }}>
      <div className="stack" style={{ gap: 18 }}>
        <div className="field"><label>Municipality</label><select className="select" value={m} onChange={(e) => setM(+e.target.value)}>{MUNI.map(([l], i) => <option key={l} value={i}>{l}</option>)}</select></div>
        <Slider label="Market value" value={val} set={setVal} min={1000000} max={100000000} step={500000} fmt={fmtPrice} />
        <div className="field"><label>Government valuation (optional)</label><input className="input tnum" type="number" placeholder={`Auto: ~${fmtFull(Math.round(val * 0.6))}`} value={govt} onChange={(e) => setGovt(e.target.value)} /></div>
        <div className="field"><label>Use</label><select className="select" value={use} onChange={(e) => setUse(e.target.value)}><option value="own">Own residence</option><option value="rented">Rented to tenants</option><option value="commercial">Commercial / business</option><option value="mixed">Partly rented</option></select></div>
        {use !== "own" && <Slider label="Monthly rent" value={rent} set={setRent} min={5000} max={500000} step={1000} fmt={fmtFull} />}
        <Slider label="Years owned" value={years} set={setYears} min={1} max={30} step={1} fmt={(v) => `${v} years`} />
      </div>
      <div className="result-box stack" style={{ gap: 4 }}>
        <span className="small muted">Yearly tax</span>
        <Row l="House & land tax" v={house} note={`${(muni[1] * 100).toFixed(1)}% of government value`} />
        {rentalTax > 0 && <Row l="Rental income tax" v={rentalTax} note={use === "commercial" ? "15% of rent" : "10% of rent"} />}
        <Row l="Municipal service fee" v={fee} />
        <div className="row between" style={{ padding: "12px 0 20px" }}><strong>Total per year</strong><strong className="tnum" style={{ fontSize: 24, color: "var(--text-strong)" }}>{fmtFull(Math.round(house + rentalTax + fee))}</strong></div>
        <span className="small muted">If you sell</span>
        <Row l="Registration fee" v={reg} note={`${(regPct * 100).toFixed(1)}% of government value`} />
        <Row l="Stamp duty" v={stamp} note="0.5%" />
        <Row l="Agent commission" v={comm} note="~1.5%, negotiable" />
        <Row l="Capital gains tax" v={cgt} note={use === "own" ? "Exempt for primary residence" : years >= 5 ? "2.5% (held 5+ years)" : "5% (under 5 years)"} />
        <p className="tiny muted" style={{ marginTop: 12 }}>Estimates based on IRD Nepal and municipal rates. Confirm with your ward office or tax advisor.</p>
      </div>
    </div>
  );
}

const Slider = ({ label, value, set, min, max, step, fmt }) => (
  <div className="field">
    <div className="row between"><label>{label}</label><b className="tnum" style={{ color: "var(--text-strong)", fontWeight: 500 }}>{fmt ? fmt(value) : value}</b></div>
    <input className="range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
  </div>
);

function Emi() {
  const [P, setP] = useState(8000000), [r, setR] = useState(10.5), [y, setY] = useState(20);
  const m = r / 1200, n = y * 12;
  const emi = m ? (P * m * (1 + m) ** n) / ((1 + m) ** n - 1) : P / n;
  const total = emi * n, interest = total - P;
  return (
    <div className="grid-2" style={{ gap: 40 }}>
      <div className="stack" style={{ gap: 24 }}>
        <Slider label="Loan amount" value={P} set={setP} min={500000} max={50000000} step={100000} fmt={fmtPrice} />
        <Slider label="Interest rate" value={r} set={setR} min={6} max={16} step={0.1} fmt={(v) => `${v.toFixed(1)}%`} />
        <Slider label="Tenure" value={y} set={setY} min={1} max={30} step={1} fmt={(v) => `${v} years`} />
      </div>
      <div className="result-box stack" style={{ gap: 18 }}>
        <div><span className="small muted">Monthly EMI</span><b className="tnum">{fmtFull(Math.round(emi))}</b></div>
        <div className="bar"><i style={{ width: `${(P / total) * 100}%` }} /><i style={{ flex: 1 }} /></div>
        <div className="row between small"><span>Principal <b className="tnum">{fmtPrice(P)}</b></span><span>Interest <b className="tnum">{fmtPrice(interest)}</b></span></div>
        <div className="small muted">Total payable {fmtFull(Math.round(total))}</div>
      </div>
    </div>
  );
}

// 1 ropani = 16 aana = 5476 sq.ft · 1 aana = 4 paisa · 1 paisa = 4 dam
// 1 bigha = 20 kattha = 72900 sq.ft · 1 kattha = 20 dhur
const UNITS = { ropani: 5476, aana: 342.25, paisa: 85.5625, dam: 21.390625, bigha: 72900, kattha: 3645, dhur: 182.25, "sq.ft": 1, "sq.m": 10.7639 };
function Units() {
  const [v, setV] = useState(4), [u, setU] = useState("aana");
  const sqft = v * UNITS[u];
  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="row-wrap" style={{ gap: 12 }}>
        <input className="input tnum" type="number" style={{ maxWidth: 200 }} value={v} onChange={(e) => setV(Number(e.target.value))} />
        <select className="select" style={{ maxWidth: 200 }} value={u} onChange={(e) => setU(e.target.value)}>{Object.keys(UNITS).map((k) => <option key={k}>{k}</option>)}</select>
      </div>
      <div className="grid-4">{Object.keys(UNITS).filter((k) => k !== u).map((k) => (
        <div key={k} className="result-box" style={{ padding: 18 }}><span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".12em" }}>{k}</span><b className="tnum" style={{ fontSize: 24 }}>{+(sqft / UNITS[k]).toFixed(3)}</b></div>
      ))}</div>
      <p className="small muted">Hill system: 1 ropani = 16 aana = 64 paisa = 256 dam. Terai system: 1 bigha = 20 kattha = 400 dhur.</p>
    </div>
  );
}

function Roi() {
  const [price, setPrice] = useState(25000000), [rent, setRent] = useState(70000), [cost, setCost] = useState(10), [growth, setGrowth] = useState(6);
  const net = rent * 12 * (1 - cost / 100);
  const yieldPct = (net / price) * 100;
  return (
    <div className="grid-2" style={{ gap: 40 }}>
      <div className="stack" style={{ gap: 24 }}>
        <Slider label="Property price" value={price} set={setPrice} min={2000000} max={100000000} step={500000} fmt={fmtPrice} />
        <Slider label="Monthly rent" value={rent} set={setRent} min={5000} max={500000} step={1000} fmt={fmtFull} />
        <Slider label="Yearly costs (tax, repairs)" value={cost} set={setCost} min={0} max={40} step={1} fmt={(v) => `${v}% of rent`} />
        <Slider label="Expected price growth" value={growth} set={setGrowth} min={0} max={15} step={0.5} fmt={(v) => `${v}% / year`} />
      </div>
      <div className="result-box stack" style={{ gap: 18 }}>
        <div><span className="small muted">Net rental yield</span><b className="tnum">{yieldPct.toFixed(2)}%</b></div>
        <div><span className="small muted">Total yearly return incl. growth</span><b className="tnum">{(yieldPct + growth).toFixed(2)}%</b></div>
        <div className="small muted">Net rent per year {fmtFull(Math.round(net))}</div>
      </div>
    </div>
  );
}

function Afford() {
  const [income, setIncome] = useState(200000), [other, setOther] = useState(0), [down, setDown] = useState(5000000), [rate, setRate] = useState(10.5), [yrs, setYrs] = useState(20);
  const r = useMemo(() => {
    const maxEmi = Math.max(0, income * 0.5 - other); // banks usually allow total EMIs up to ~50% of income
    const m = rate / 1200, n = yrs * 12;
    const loanByIncome = maxEmi * ((1 + m) ** n - 1) / (m * (1 + m) ** n);
    const loanByLtv = down / 0.3 * 0.7; // loan up to ~70% of the property value
    const loan = Math.min(loanByIncome, loanByLtv);
    const emi = loan * m * (1 + m) ** n / ((1 + m) ** n - 1);
    return { maxEmi, loan, emi, price: loan + down, limit: loanByIncome < loanByLtv ? "your income" : "your down payment" };
  }, [income, other, down, rate, yrs]);
  return (
    <div className="grid-2" style={{ gap: 40 }}>
      <div className="stack" style={{ gap: 24 }}>
        <Slider label="Monthly household income" value={income} set={setIncome} min={30000} max={2000000} step={5000} fmt={fmtFull} />
        <Slider label="Existing loan EMIs per month" value={other} set={setOther} min={0} max={500000} step={1000} fmt={fmtFull} />
        <Slider label="Down payment available" value={down} set={setDown} min={500000} max={50000000} step={100000} fmt={fmtPrice} />
        <Slider label="Loan interest" value={rate} set={setRate} min={6} max={16} step={0.1} fmt={(v) => `${v.toFixed(1)}%`} />
        <Slider label="Loan term" value={yrs} set={setYrs} min={5} max={30} step={1} fmt={(v) => `${v} years`} />
      </div>
      <div className="result-box stack" style={{ gap: 18 }}>
        <div><span className="small muted">You can look at homes up to</span><b className="tnum">{fmtPrice(r.price)}</b></div>
        <div className="row between small"><span>Loan amount</span><b className="tnum">{fmtPrice(r.loan)}</b></div>
        <div className="row between small"><span>Monthly EMI</span><b className="tnum">{fmtFull(Math.round(r.emi))}</b></div>
        <div className="row between small"><span>Max EMI the bank may allow</span><b className="tnum">{fmtFull(Math.round(r.maxEmi))}</b></div>
        <p className="tiny muted">Limited by {r.limit}. Assumes banks allow total EMIs up to 50% of income and lend up to 70% of the property value. Confirm with your bank.</p>
      </div>
    </div>
  );
}

function RentVsBuy() {
  const [price, setPrice] = useState(20000000), [rent, setRent] = useState(45000), [years, setYears] = useState(10), [rate, setRate] = useState(10.5), [growth, setGrowth] = useState(6);
  const r = useMemo(() => {
    const down = price * 0.3, loan = price - down, m = rate / 1200, n = 240;
    const emi = (loan * m * (1 + m) ** n) / ((1 + m) ** n - 1);
    let bal = loan, paid = down;
    for (let i = 0; i < years * 12; i++) { const int = bal * m; bal -= emi - int; paid += emi; }
    const value = price * (1 + growth / 100) ** years;
    let rentPaid = 0; for (let y = 0; y < years; y++) rentPaid += rent * 12 * 1.05 ** y;
    return { buyCost: paid - (value - Math.max(bal, 0)), rentPaid, emi };
  }, [price, rent, years, rate, growth]);
  const buy = r.buyCost < r.rentPaid;
  return (
    <div className="grid-2" style={{ gap: 40 }}>
      <div className="stack" style={{ gap: 24 }}>
        <Slider label="Home price" value={price} set={setPrice} min={3000000} max={80000000} step={500000} fmt={fmtPrice} />
        <Slider label="Rent for a similar home" value={rent} set={setRent} min={5000} max={300000} step={1000} fmt={fmtFull} />
        <Slider label="Years you will stay" value={years} set={setYears} min={1} max={20} step={1} fmt={(v) => `${v} years`} />
        <Slider label="Loan interest" value={rate} set={setRate} min={6} max={16} step={0.1} fmt={(v) => `${v.toFixed(1)}%`} />
        <Slider label="Price growth" value={growth} set={setGrowth} min={0} max={15} step={0.5} fmt={(v) => `${v}% / year`} />
      </div>
      <div className="result-box stack" style={{ gap: 18 }}>
        <div><span className="small muted">Better choice over {years} years</span><b>{buy ? "Buying" : "Renting"}</b></div>
        <div className="row between small"><span>{r.buyCost < 0 ? "Net gain from buying" : "Net cost of buying"}</span><b className="tnum">{fmtPrice(Math.abs(r.buyCost))}</b></div>
        <div className="row between small"><span>Total rent paid</span><b className="tnum">{fmtPrice(r.rentPaid)}</b></div>
        <p className="tiny muted">Assumes 30% down payment, 20-year loan (EMI {fmtFull(Math.round(r.emi))}) and rent rising 5% a year.</p>
      </div>
    </div>
  );
}

export default function Tools() {
  const { tool = "emi" } = useParams();
  const cur = TOOLS.find(([k]) => k === tool) || TOOLS[0];
  useSEO(cur[1], `Free ${cur[1].toLowerCase()} for property in Nepal.`);
  const Comp = { afford: Afford, emi: Emi, units: Units, "land-price": LandPrice, "property-tax": PropertyTax, roi: Roi, "rent-vs-buy": RentVsBuy, "invest-return": () => <ToolCalc kind="invest-return" />, "host-income": () => <ToolCalc kind="host-income" />, "pay-schedule": () => <ToolCalc kind="pay-schedule" /> }[cur[0]];
  return (
    <>
      <div className="tools-hero"><PageHead crumbs={[{ label: "Tools" }]} kicker="Calculators" title={cur[1]}>Quick estimates to plan your purchase. Confirm final numbers with your bank or agent.</PageHead></div>
      <div className="container section-sm">
        <div className="tabs">{TOOLS.map(([k, l, I]) => <NavLink key={k} to={`/tools/${k}`} className={({ isActive }) => (isActive ? "on" : "")}><I size={16} />{l}</NavLink>)}</div>
        <div className="card card-pad" style={{ padding: "clamp(20px, 4vw, 44px)" }}><Comp /></div>
      </div>
    </>
  );
}
