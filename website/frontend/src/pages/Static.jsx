import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Compass, ShieldCheck, Scale, Trash2, ChevronRight, Mail, Phone } from "lucide-react";
import { PageHead, Empty } from "../components/ui";
import { LEGAL } from "../utils/legalContent";
import { useSEO } from "../utils/seo";
import { adminPage, textBlocks } from "../utils/content";
import { fmtDate } from "../utils/format";

const POLICIES = [["privacy", "/privacy-policy", "Privacy policy", ShieldCheck], ["terms", "/terms-and-conditions", "Terms & conditions", Scale], ["deletion", "/data-deletion", "Data deletion", Trash2]];
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function Legal({ kind }) {
  // text saved in Admin → Content → Pages replaces the built-in text
  const own = adminPage(kind);
  const t = own ? { title: own.title || LEGAL[kind].title, meta: [`Version ${own.version}`, `Updated ${fmtDate(own.updated)}`], blocks: textBlocks(own.body) } : LEGAL[kind];
  useSEO(t.title);
  const [active, setActive] = useState("");
  // group consecutive list items into one list; give every section heading an anchor
  const blocks = [];
  t.blocks.forEach(([tag, text]) => {
    if (tag === "li") { const last = blocks[blocks.length - 1]; if (last && last.tag === "ul") last.items.push(text); else blocks.push({ tag: "ul", items: [text] }); }
    else blocks.push({ tag, text, id: tag === "h2" ? slugify(text) : undefined });
  });
  const toc = blocks.filter((b) => b.tag === "h2");
  useEffect(() => {
    const els = toc.map((h) => document.getElementById(h.id)).filter(Boolean);
    const on = () => { let cur = ""; els.forEach((el) => { if (el.getBoundingClientRect().top < 140) cur = el.id; }); setActive(cur); };
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [kind]);  
  const jump = (id) => { const el = document.getElementById(id); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 100, behavior: "smooth" }); };
  return (
    <>
      <div className={`tools-hero legal-hero legal-${kind}`}><PageHead crumbs={[{ label: t.title }]} title={t.title}>{t.meta.join(" · ")}</PageHead></div>
      <div className="container detail-layout legal-layout">
        <article className="prose legal-body">
          {blocks.map((b, i) =>
            b.tag === "h2" ? <h2 key={i} id={b.id}>{b.text}</h2>
            : b.tag === "h3" || b.tag === "h4" ? <h3 key={i}>{b.text}</h3>
            : b.tag === "ul" ? <ul key={i}>{b.items.map((x, k) => <li key={k}>{x}</li>)}</ul>
            : <p key={i}>{b.text}</p>)}
        </article>
        <aside className="stack legal-side" style={{ gap: 16 }}>
          {toc.length > 0 && (
            <nav className="card card-pad stack legal-toc" style={{ gap: 2 }}>
              <span className="tiny muted legal-label">On this page</span>
              {toc.map((h) => <button key={h.id} type="button" className={active === h.id ? "on" : ""} onClick={() => jump(h.id)}>{h.text}</button>)}
            </nav>
          )}
          <div className="card card-pad stack" style={{ gap: 4 }}>
            <span className="tiny muted legal-label">Other policies</span>
            {POLICIES.filter(([k]) => k !== kind).map(([k, to, label, I]) => <Link key={k} to={to} className="legal-link"><I size={16} />{label}<ChevronRight size={15} style={{ marginLeft: "auto" }} /></Link>)}
          </div>
          <div className="card card-pad stack" style={{ gap: 10 }}>
            <h4>Questions about this policy?</h4>
            <p className="small muted">Our team replies within one working day.</p>
            <div className="legal-actions">
              <a href="mailto:info@sheetalproperty.com" className="btn btn-primary btn-sm btn-block"><Mail size={15} />Email us</a>
              <a href="tel:+9779801136817" className="btn btn-outline btn-sm btn-block"><Phone size={15} />Call us</a>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export function NotFound() {
  return <div className="container"><Empty icon={Compass} title="Page not found"><Link to="/">Go to the home page</Link></Empty></div>;
}
