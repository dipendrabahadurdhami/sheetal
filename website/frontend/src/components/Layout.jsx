// The website frame: header, mobile tab bar, footer, WhatsApp button and theme button.
// How it works: the footer has 4 groups of 4 links so every column is the same height; the theme button moves to the
// next theme on each click.

import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Newspaper, Calculator, TrendingUp, ClipboardList, Images, Info, Building2, HandCoins, Landmark, Scale, KeyRound, Wallet, FilePlus2, Briefcase, BadgeCheck, Sun, Moon, Droplet, Heart, Plus, User, Home, Search, LogOut, LayoutGrid, Bell, Menu, X, Facebook, Instagram, Phone, Mail, MapPin, MessageCircle, MessagesSquare } from "lucide-react";
import { useApp } from "../context/AppContext";
import { Logo, Avatar } from "./ui";
import { HeaderSearch } from "./HeaderSearch";
import { PhoneMenu, PhoneLogo } from "./PhoneApp";
import { useMedia } from "../hooks/useAsync";
import { agentName } from "../utils/format";
import { THEMES } from "@sheetal/shared/core/theme";

const NAV = [["/sale", "Find"], ["/stays", "Stays"], ["/project", "Projects"], ["/map", "Map"], ["/partners", "Partners"], ["/services", "Services"]];
const SECTION = { "/agencies": /^\/(agencies|agency)(\/|$)/, "/blog": /^\/blog(\/|$)/, "/partners": /^\/(partners|site|agency|agencies)(\/|$)/, "/sale": /^\/(sale|rent|search|property|investment|invest)(\/|$)/, "/stays": /^\/(stays|book)(\/|$)/, "/project": /^\/(project|reserve|featured)(\/|$)/ };
// 4 groups x 4 links, one short line each, so every column is the same height.
const MORE = [
  ["Explore", [["/investment/explore", HandCoins, "Invest", "Hotels and projects"], ["/property-demand", ClipboardList, "Buyer requests", "What buyers want"], ["/partners?type=agency", Building2, "Agencies", "Local agencies"], ["/requirement", FilePlus2, "Post a requirement", "Tell us what you need"]]],
  ["Services", [["/services/home-loan", Landmark, "Home loan", "Compare bank offers"], ["/services/legal-help", Scale, "Legal help", "Papers and transfer"], ["/services/management", KeyRound, "Management", "Tenants and repairs"], ["/services/pay-rent", Wallet, "Pay rent", "Fonepay and eSewa"]]],
  ["Learn", [["/blog", Newspaper, "Journal", "Guides and news"], ["/rates-and-trends", TrendingUp, "Rates and trends", "Prices by area"], ["/tools/emi", Calculator, "Calculators", "EMI, tax and area"], ["/gallery", Images, "Gallery", "Photos and videos"]]],
  ["Company", [["/about", Info, "About us", "Who we are"], ["/careers", Briefcase, "Careers", "Work with us"], ["/contact", Phone, "Contact", "Call or visit"], ["/pricing", BadgeCheck, "Apps and pricing", "Free to start, for every business"]]],
];
const MORE_RE = /^\/(investment|property-demand|offers|services\/|requirement|blog|rates-and-trends|tools|gallery|about|careers|contact|plans)/;

export function Header() {
  const { pathname } = useLocation();
  const { user, setAuth, logout } = useApp();
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const phone = useMedia("(max-width: 600px)");
  useEffect(() => { const o = () => setDrawer(true); window.addEventListener("pa-open-menu", o); return () => window.removeEventListener("pa-open-menu", o); }, []);
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

  // Phone: a clean, balanced bar. Menu on the left, logo in the middle, search on the right.
  if (phone) {
    return (
      <>
        <header className="header pa-header">
          <div className="pa-hbar">
            <PhoneLogo />
            <button type="button" className="pa-hbtn" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu size={24} /></button>
          </div>
        </header>
        {drawer && <PhoneMenu onClose={() => setDrawer(false)} />}
      </>
    );
  }

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
      {drawer && <PhoneMenu onClose={() => setDrawer(false)} />}
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
            <a href="https://www.google.com/maps/place/Sheetal+Real+Estate/@27.7441799,85.3412356,17z" target="_blank" rel="noreferrer"><MapPin size={14} />Maharajgunj, Kathmandu</a>
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
const WA_PATH = "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z";
// Floating contact buttons: WhatsApp (its own green) and a call button above it on phones.
export function WhatsAppButton() {
  const href = `https://wa.me/${WA}?text=${encodeURIComponent("Hello Sheetal Property, I found you on your website: " + window.location.href)}`;
  return (
    <>
      <a className="wa-btn wa-call" href="tel:+9779801000434" aria-label="Call Sheetal"><Phone size={22} /></a>
      <a className="wa-btn wa-whats" href={href} target="_blank" rel="noreferrer" aria-label="Chat on WhatsApp"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d={WA_PATH} /></svg></a>
    </>
  );
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
