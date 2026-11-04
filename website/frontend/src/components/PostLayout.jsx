// The layout of the post-a-property flow: steps, progress and the side summary.

import { Link } from "react-router-dom";
import { Check, Tag, KeyRound, BedDouble, Building2, HandCoins, ShieldCheck, ImageIcon, MapPin } from "lucide-react";
import { fmtPrice } from "../utils/format";

const TYPES = [["sell", "Sell", Tag], ["rent", "Rent out", KeyRound], ["stay", "Stay", BedDouble], ["project", "Project", Building2], ["invest", "Investment", HandCoins]];
const CSS = `
.pl{max-width:1280px;margin:0 auto;padding:24px clamp(16px,3vw,32px) 120px}
.pl-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px 24px;flex-wrap:wrap;margin-bottom:20px}
.pl-head h1{font-size:clamp(24px,2.4vw,30px);margin:0 0 4px}.pl-head p{margin:0}
.pl-types{display:flex;gap:4px;padding:4px;border:1px solid var(--line);border-radius:12px;background:var(--surface,transparent);flex-wrap:wrap}
.pl-types a{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:9px;font-size:14px;font-weight:500;color:var(--text);text-decoration:none}
.pl-types a:hover{color:var(--text-strong);background:var(--card,rgba(0,0,0,.04))}
.pl-types a.on{background:var(--c-red);color:#fff}
.pl-grid{display:grid;grid-template-columns:240px minmax(0,1fr) 300px;gap:24px;align-items:start}
.pl-rail{position:sticky;top:96px;display:flex;flex-direction:column;gap:2px;padding:8px;border:1px solid var(--line);border-radius:14px}
.pl-rail button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;cursor:pointer;font-size:14px;color:var(--muted,var(--text))}
.pl-rail button:disabled{cursor:default;opacity:.6}
.pl-rail button.on{background:var(--card,rgba(0,0,0,.04));color:var(--text-strong);font-weight:600}
.pl-rail button i{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-size:12px;font-weight:600;border:1.5px solid var(--line-strong)}
.pl-rail button.on i{border-color:var(--c-red);color:var(--c-red)}
.pl-rail button.done i{background:var(--c-red);border-color:var(--c-red);color:#fff}
.pl-rail small{display:block;font-size:12px;font-weight:400;color:var(--muted,inherit)}
.pl-card{border:1px solid var(--line);border-radius:16px;background:var(--card,transparent);overflow:hidden}
.pl-card-head{padding:22px 28px;border-bottom:1px solid var(--line)}
.pl-card-head h2{font-size:19px;margin:0 0 4px}.pl-card-head p{margin:0}
.pl-card-body{padding:24px 28px 28px;display:flex;flex-direction:column;gap:22px}
.pl-card-body .form-grid{gap:18px 20px}
.pl-side{position:sticky;top:96px;display:flex;flex-direction:column;gap:16px}
.pl-prev{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--card,transparent)}
.pl-prev-img{aspect-ratio:4/3;background:var(--surface,rgba(0,0,0,.05));display:grid;place-items:center;color:var(--muted,inherit)}
.pl-prev-img img{width:100%;height:100%;object-fit:cover;display:block}
.pl-prev-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:6px}
.pl-prev-body b{font-size:16px;color:var(--text-strong);line-height:1.3}
.pl-prev-price{font-size:18px;font-weight:600;color:var(--c-red)}
.pl-prev-facts{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.pl-prev-facts span{font-size:12px;padding:3px 8px;border-radius:999px;background:var(--surface,rgba(0,0,0,.05))}
.pl-note{display:flex;gap:10px;padding:14px 16px;border-radius:14px;border:1px solid var(--line);font-size:13px;line-height:1.5}
.pl-note svg{flex:none;color:var(--c-red);margin-top:2px}
.pl-opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.pl-opt{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:6px;padding:14px 16px;border:1.5px solid var(--line);border-radius:12px;font-size:14px;font-weight:500;color:var(--text-strong)}
.pl-opt small{font-weight:400;font-size:12px;color:var(--muted,inherit);line-height:1.4}
.pl-opt svg{color:var(--c-red)}
.pl-opt:hover{border-color:var(--line-strong)}
.pl-opt.on{border-color:var(--c-red);box-shadow:0 0 0 3px color-mix(in srgb,var(--c-red) 14%,transparent)}
.pl-opt:focus-visible{outline:2px solid var(--c-red);outline-offset:2px}
.pl-lbl{font-size:14px;font-weight:600;color:var(--text-strong);margin:0 0 8px;display:block}
.pl-hint{font-size:12.5px;color:var(--muted,inherit);margin:6px 0 0}
.pl-tagin{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px;border:1px solid var(--line-strong);border-radius:10px;min-height:48px}
.pl-tagin input{flex:1;min-width:160px;border:0;outline:0;background:transparent;font:inherit;padding:6px;color:inherit}
.pl-tag{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:var(--c-red);color:#fff;font-size:13px}
.pl-tag button{all:unset;cursor:pointer;display:grid;place-items:center}
.pl-sum{border:1px solid var(--line);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px;background:var(--card,transparent)}
.pl-sum h4{margin:0;font-size:16px;line-height:1.35}
.pl-sum dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0;font-size:13px}.pl-sum dt{color:var(--muted,inherit)}.pl-sum dd{margin:0;color:var(--text-strong)}
.pl-bar{position:fixed;left:0;right:0;bottom:0;z-index:30;border-top:1px solid var(--line);background:var(--bg,#fff);box-shadow:0 -6px 24px -12px rgba(0,0,0,.18)}
[data-theme~="dark"] .pl-bar{background:var(--surface,#222)}[data-theme~="red"] .pl-bar{background:var(--c-red-dark,#8f1d22)}
.pl-bar-in{max-width:1280px;margin:0 auto;padding:12px clamp(16px,3vw,32px);display:flex;align-items:center;gap:12px}
.pl-bar-in .pl-prog{flex:1;min-width:0;display:flex;align-items:center;gap:12px;font-size:13px}
.pl-bar-in .pl-prog div{flex:0 1 220px;height:6px;border-radius:999px;background:var(--line)}.pl-bar-in .pl-prog div i{display:block;height:100%;border-radius:inherit;background:var(--c-red)}
@media (max-width:1180px){.pl-grid{grid-template-columns:200px minmax(0,1fr)}.pl-side{display:none}}
@media (max-width:760px){.pl-grid{grid-template-columns:1fr}.pl-rail{position:static;flex-direction:row;overflow-x:auto}.pl-rail small{display:none}.pl-card-head,.pl-card-body{padding-left:18px;padding-right:18px}}
`;

// Back-office style shell for every "Post on Sheetal" form: type switch, step rail, form card, live preview, sticky action bar.
export function PostLayout({ type, steps, step, onStep, section, sub, preview = {}, error, actions, children, title = "Post on Sheetal", intro = "Free with your account. Our team reviews every post before it goes live.", tabs = TYPES, aside }) {
  const pct = Math.round(((step + 1) / steps.length) * 100);
  return (
    <div className="pl">
      <style>{CSS}</style>
      <div className="pl-head">
        <div><h1>{title}</h1><p className="muted">{intro}</p></div>
        {tabs && <nav className="pl-types" aria-label="What are you posting">{tabs.map(([k, l, I]) => <Link key={k} to={`/post-property?type=${k}`} className={type === k ? "on" : ""}><I size={16} />{l}</Link>)}</nav>}
      </div>
      <div className="pl-grid">
        <nav className="pl-rail" aria-label="Steps">{steps.map(([t, s], i) => (
          <button key={t} type="button" className={`${i === step ? "on" : ""} ${i < step ? "done" : ""}`} disabled={i > step} onClick={() => onStep(i)}>
            <i>{i < step ? <Check size={14} /> : i + 1}</i><span>{t}<small>{s}</small></span>
          </button>))}
        </nav>
        <section className="pl-card">
          <div className="pl-card-head"><h2>{section}</h2>{sub && <p className="small muted">{sub}</p>}</div>
          <div className="pl-card-body">{children}{error && <p className="error" style={{ margin: 0 }}>{error}</p>}</div>
        </section>
        {aside ? <aside className="pl-side">{aside}</aside> : <aside className="pl-side">
          <div className="pl-prev">
            <div className="pl-prev-img">{preview.cover ? <img src={preview.cover} alt="" /> : <span className="row small" style={{ gap: 6 }}><ImageIcon size={18} />Cover photo</span>}</div>
            <div className="pl-prev-body">
              <span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".08em" }}>Preview</span>
              <b>{preview.title || "Your title shows here"}</b>
              {preview.location && <span className="small muted row" style={{ gap: 4 }}><MapPin size={13} />{preview.location}</span>}
              <span className="pl-prev-price">{Number(preview.price) > 0 ? fmtPrice(preview.price) + (preview.per || "") : "Price"}</span>
              {preview.facts?.filter(Boolean).length > 0 && <div className="pl-prev-facts">{preview.facts.filter(Boolean).map((x) => <span key={x}>{x}</span>)}</div>}
            </div>
          </div>
          <div className="pl-note"><ShieldCheck size={18} /><span><b>Reviewed before it goes live.</b> Usually within one working day. Follow it in My profile → My properties.</span></div>
        </aside>}
      </div>
      <div className="pl-bar"><div className="pl-bar-in">
        <div className="pl-prog"><span className="tnum muted">Step {step + 1} of {steps.length}</span><div><i style={{ width: pct + "%" }} /></div></div>
        {actions}
      </div></div>
    </div>
  );
}
