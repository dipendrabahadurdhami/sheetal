import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Newspaper, Calculator, TrendingUp, ClipboardList, Images, Info, Building2, HandCoins, Landmark, Scale, KeyRound, Wallet, FilePlus2, Briefcase, BadgeCheck, Sun, Moon, Droplet, Heart, Plus, User, Home, Search, LogOut, LayoutGrid, Bell, Menu, X, Facebook, Instagram, Phone, Mail, MapPin, MessageCircle, MessagesSquare } from "lucide-react";
import { useApp } from "../context/AppContext";
import { Logo, Avatar } from "./ui";
import { HeaderSearch } from "./HeaderSearch";
import { agentName } from "../utils/format";
import { THEMES } from "@sheetal/shared/core/theme";

const NAV = [["/sale", "Find"], ["/stays", "Stays"], ["/project", "Projects"], ["/map", "Map"], ["/partners", "Partners"], ["/services", "Services"]];
const SECTION = { "/agencies": /^\/(agencies|agency)(\/|$)/, "/blog": /^\/blog(\/|$)/, "/partners": /^\/(partners|site|agency|agencies)(\/|$)/, "/sale": /^\/(sale|rent|search|property|investment|invest)(\/|$)/, "/stays": /^\/(stays|book)(\/|$)/, "/project": /^\/(project|reserve|featured)(\/|$)/ };
// 4 groups x 4 links, one short line each, so every column is the same height.
const MORE = [
  ["Explore", [["/investment/explore", HandCoins, "Invest", "Hotels and projects"], ["/property-demand", ClipboardList, "Buyer requests", "What buyers want"], ["/partners?type=agency", Building2, "Agencies", "Verified local agencies"], ["/requirement", FilePlus2, "Post a requirement", "Tell us what you need"]]],
  ["Services", [["/services/home-loan", Landmark, "Home loan", "Compare bank offers"], ["/services/legal-help", Scale, "Legal help", "Papers and transfer"], ["/services/management", KeyRound, "Management", "Tenants and repairs"], ["/services/pay-rent", Wallet, "Pay rent", "Fonepay and eSewa"]]],
  ["Learn", [["/blog", Newspaper, "Journal", "Guides and news"], ["/rates-and-trends", TrendingUp, "Rates and trends", "Prices by area"], ["/tools/emi", Calculator, "Calculators", "EMI, tax and area"], ["/gallery", Images, "Gallery", "Photos and videos"]]],
  ["Company", [["/about", Info, "About us", "Who we are"], ["/careers", Briefcase, "Careers", "Work with us"], ["/contact", Phone, "Contact", "Call or visit"], ["/plans", BadgeCheck, "Agency plans", "List as an agency"]]],
];
const MORE_RE = /^\/(investment|property-demand|offers|services\/|requirement|blog|rates-and-trends|tools|gallery|about|careers|contact|plans)/;

export function Header() {
  const { pathname } = useLocation();
  const { user, setAuth, logout } = useApp();
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const ref = useRef(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreT = useRef(null);
  useEffect(() => { setMoreOpen(false); }, [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const k = (e) => e.key === "Escape" && setMoreOpen(false);
    const h = (e) => !e.target.closest?.(".nav-more") && setMoreOpen(false);
    document.addEventListener("keydown", k); document.addEventListener("mousedown", h);
    return () => { document.removeEventListener("keydown", k); document.removeEventListener("mousedown", h); };
  }, [moreOpen]);
  const loc = useLocation();
  useEffect(() => { setMenu(false); setDrawer(false); }, [loc.pathname]);
  useEffect(() => {
    const h = (e) => !ref.current?.contains(e.target) && setMenu(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <header className="header">
      <div className="container header-inner">
        <Logo />
        <nav className="nav" aria-label="Main">
          {NAV.map(([to, l]) => <NavLink key={to} to={to} className={({ isActive }) => (isActive || (SECTION[to] && SECTION[to].test(pathname)) ? "active" : undefined)}>{l}</NavLink>)}<div className={`nav-more ${moreOpen ? "open" : ""} ${MORE_RE.test(pathname) ? "is-active" : ""}`} onMouseEnter={() => { clearTimeout(moreT.current); setMoreOpen(true); }} onMouseLeave={() => { moreT.current = setTimeout(() => setMoreOpen(false), 160); }}>
            <button type="button" className="nav-more-btn" aria-expanded={moreOpen} aria-controls="mega" onClick={() => setMoreOpen((v) => !v)}>More</button>
            <div className="mega" id="mega" {...(!moreOpen && { inert: "" })}>
              <div className="container mega-in">
                {MORE.map(([g, items]) => <div key={g} className="mega-g"><span className="mega-gl">{g}</span>{items.map(([to, I, l, d]) => <NavLink key={to} to={to} className="more-it" onClick={() => setMoreOpen(false)}><span className="more-ico"><I size={18} /></span><span className="more-t"><b>{l}</b><small>{d}</small></span></NavLink>)}</div>)}
                <aside className="mega-side">
                  <span className="mega-gl">Can't find it?</span>
                  <p>Tell us what you need and a local agency will call you back.</p>
                  <Link to="/requirement" className="btn btn-outline btn-sm mega-cta" onClick={() => setMoreOpen(false)}><FilePlus2 size={15} />Post a requirement</Link>
                  <a href="tel:+9779801136817" className="btn btn-outline btn-sm"><Phone size={15} />+977 980-1136817</a>
                </aside>
              </div>
            </div>
          </div>
        </nav>
        <div className="header-actions">
          <HeaderSearch />
          <ThemeMenu />

          <Link to="/my-profile?tab=saved" className="btn btn-ghost btn-icon hide-sm" aria-label="Saved"><Heart size={18} /></Link>
          <Link to="/post-property" className="btn btn-ghost hide-sm"><Plus size={16} /> Post property</Link>
          {user ? (
            <div style={{ position: "relative" }} ref={ref}>
              <button className="user-pill" onClick={() => setMenu((m) => !m)} aria-label="Account menu">
                <Avatar src={user.photo} name={agentName(user)} size={36} />
              </button>
              {menu && (
                <div className="menu">
                  <div style={{ padding: "10px 12px 12px" }}><b style={{ color: "var(--text-strong)", fontWeight: 500 }}>{agentName(user)}</b><div className="tiny muted">{user.email}</div></div>
                  <Link to="/my-profile"><LayoutGrid size={16} /> Dashboard</Link>
                  <Link to="/my-profile?tab=listings"><Home size={16} /> My properties</Link>
                  <Link to="/my-profile?tab=saved"><Heart size={16} /> Saved</Link>
                  <Link to="/my-profile?tab=messages"><MessagesSquare size={16} /> Messages</Link>
                  <Link to="/my-profile?tab=alerts"><Bell size={16} /> Notifications</Link>
                  <div className="hr" style={{ margin: "6px 0" }} />
                  <button onClick={logout}><LogOut size={16} /> Log out</button>
                </div>
              )}
            </div>
          ) : (
            <button className="btn btn-primary hide-sm" onClick={() => setAuth("login")}>Log in</button>
          )}
          <button className="btn btn-ghost btn-icon" style={{ display: "none" }} data-burger onClick={() => setDrawer(true)} aria-label="Menu"><Menu size={20} /></button>
        </div>
      </div>
      {drawer && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <div className="modal">
            <button className="btn btn-ghost btn-icon modal-x" onClick={() => setDrawer(false)}><X size={18} /></button>
            <div className="stack" style={{ gap: 4, marginTop: 24 }}>{[...NAV, ...MORE].map(([to, l]) => <Link key={to} to={to} className="btn btn-ghost" style={{ justifyContent: "flex-start" }}>{l}</Link>)}</div>
          </div>
        </div>
      )}
    </header>
  );
}

export function TabBar() {
  const { user, setAuth } = useApp();
  return (
    <nav className="tabbar" aria-label="App">
      <NavLink to="/" end><Home size={21} />Home</NavLink>
      <NavLink to="/search"><Search size={21} />Explore</NavLink>
      <NavLink to="/post-property" aria-label="Post property"><span className="post"><Plus size={22} /></span></NavLink>
      <NavLink to="/my-profile?tab=saved" onClick={(e) => { if (!user) { e.preventDefault(); setAuth("login"); } }}><Heart size={21} />Saved</NavLink>
      <NavLink to="/my-profile" onClick={(e) => { if (!user) { e.preventDefault(); setAuth("login"); } }}><User size={21} />{user ? "Profile" : "Log in"}</NavLink>
    </nav>
  );
}

export function SourceBadge() {
  return null;
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link to="/" className="brand"><img src="/brand/logo-mark.png" alt="" style={{ height: 40 }} /><span className="brand-word"><b>SHEETAL</b><span>PROPERTY</span></span></Link>
            <p>Homes, land and rentals across Nepal. Buy, sell, rent or invest with trusted agents, checked documents and real local prices.</p>
          </div>
          <div><h4>Explore</h4><Link to="/investment/explore">Investment</Link><Link to="/map">Map search</Link><Link to="/project">Projects</Link><Link to="/stays">Stays</Link><Link to="/partners">Partners</Link><Link to="/property-demand">Buyer requests</Link></div>
          <div><h4>Services</h4><Link to="/services/home-loan">Home loan</Link><Link to="/services/legal-help">Legal help</Link><Link to="/services/management">Property management</Link><Link to="/services/pay-rent">Pay rent online</Link><Link to="/rates-and-trends">Rates & trends</Link><Link to="/requirement">Post a requirement</Link></div>
          <div><h4>Company</h4><Link to="/about">About us</Link><Link to="/partners?type=agency">Our agencies</Link><Link to="/careers">Careers</Link><Link to="/blog">Journal</Link><a href="https://dhamiplus.com" target="_blank" rel="noopener noreferrer">IT team</a><Link to="/tools/emi">Calculators</Link></div>
          <div className="footer-contact"><h4>Contact</h4>
            <a href="tel:+9779801136817"><Phone size={14} />+977 980-1136817</a>
            <a href={`https://wa.me/${WA}`} target="_blank" rel="noreferrer"><MessageCircle size={14} />WhatsApp</a>
            <a href="mailto:info@sheetalproperty.com"><Mail size={14} />info@sheetalproperty.com</a>
            <a href="https://maps.google.com/?q=Kathmandu" target="_blank" rel="noreferrer"><MapPin size={14} />Kathmandu, Nepal</a>
            <a href="https://www.facebook.com/shetalestate" target="_blank" rel="noreferrer"><Facebook size={14} />Facebook</a>
            <a href="https://www.instagram.com/shetal_realestate/" target="_blank" rel="noreferrer"><Instagram size={14} />Instagram</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>Â© {new Date().getFullYear()} Sheetal Property. All rights reserved.</span>
          <span className="row" style={{ gap: 18 }}><Link to="/privacy-policy">Privacy policy</Link><Link to="/terms-and-conditions">Terms & conditions</Link><Link to="/data-deletion">Data deletion</Link></span>
        </div>
      </div>
    </footer>
  );
}

const WA = "9779801136817";
export function WhatsAppButton() {
  const href = `https://wa.me/${WA}?text=${encodeURIComponent("Hello Sheetal Property, I found you on your website: " + window.location.href)}`;
  return <a className="wa-btn" href={href} target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp"><MessageCircle size={24} /></a>;
}
const THEME_ICON = { light: Sun, dark: Moon, red: Droplet };
const THEME_LABEL = { light: "Light", dark: "Dark", red: "Red" };
// Theme: icon only; each click moves to the next theme (light, dark, red) and round again.
export function ThemeMenu() {
  const { theme, setTheme } = useApp();
  const ids = THEMES.map((x) => x.id);
  const cur = ids.includes(theme) ? theme : ids[0];
  const next = ids[(ids.indexOf(cur) + 1) % ids.length];
  const Cur = THEME_ICON[cur] || Sun;
  return (
    <button type="button" className="btn btn-ghost btn-icon" onClick={() => setTheme(next)} aria-label={`Theme: ${THEME_LABEL[cur]}. Switch to ${THEME_LABEL[next]}`} title={`${THEME_LABEL[cur]} · click for ${THEME_LABEL[next]}`}><Cur size={18} /></button>
  );
}
