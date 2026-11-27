// The frame of both panels: sidebar, top bar, branch and business switchers, quick actions, bell and profile menu.
// Where it fits: BusinessApp and AdminApp render every page inside it.
// How it works: each app passes its menu and slots; pages listed in `preview` get a "Preview" tag and a note.
// On phones (the app look): with `tabs`, a bottom bar holds up to three main pages, a big + (the New list as a sheet) and Menu (the side
// menu); the top bar keeps only the name, search, alerts and profile, and language, theme and branch move into the side menu.

import React, { useEffect, useState } from "react";
import { Icon } from "../core/icons";
import { Link, useRouter } from "../core/router";
import { LANGS, useLang, useT } from "../core/i18n";
import { useStore } from "../core/store";
import { Avatar, Menu } from "../core/ui";
import { config } from "../core/config";
import { CommandPalette, openPalette } from "./CommandPalette";
import { PANEL_THEMES } from "../core/theme";

export function Shell({ sub, nav, tabs = [], switcher, sideFooter, topLeft, topExtra, topTools, preview = [], userMenu, banner, notifications = [], notifTo, onReadAll, brandSlot, style, quickCreate = [], records = [], themes = PANEL_THEMES, children }) {
  const { path } = useRouter();
  const t = useT();
  const lang = useLang();
  const { db, update } = useStore();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  useEffect(() => { setOpen(false); setSheet(false); }, [path]);
  useEffect(() => {
    if (!open && !sheet) return;
    const k = (e) => { if (e.key === "Escape") { setOpen(false); setSheet(false); } };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, sheet]);
  const under = (to) => path === to || path.startsWith(to + "/");
  // Pages not on the server yet (sample data only): tagged in the menu, with a note on the page.
  const isPreview = (to) => preview.some((p) => to === p || to.startsWith(p + "/"));
  const previewHere = preview.some(under);
  const isOn = (it) => (it.exact ? path === it.to : under(it.to) || (it.match || []).some(under));
  const theme = db.session.theme;
  // Bottom tabs: only pages this person's menu has (role, plan and type already applied), at most three.
  const navItems = nav.flatMap((g) => g.items);
  const tabList = tabs.filter((tb) => navItems.some((it) => it.to === tb.to)).slice(0, 3);
  const hasTabs = tabList.length > 0;
  const tabOn = (tb) => (tb.exact ? path === tb.to : under(tb.to));
  const curLang = LANGS.find((l) => l.id === lang) || LANGS[0];
  const nextLang = LANGS[(LANGS.indexOf(curLang) + 1) % LANGS.length];
  const curTheme = themes.find((x) => x.id === theme) || themes[0];
  const nextTheme = themes[(themes.indexOf(curTheme) + 1) % themes.length];
  const langBtn = (cls = "") => <button type="button" className={`btn btn-ghost pf-lang-one ${cls}`} title={`${curLang.label}. Switch to ${nextLang.label}`} aria-label={`${t("a11y.language")}: ${curLang.label}. Switch to ${nextLang.label}`}
    onClick={() => update((d) => { d.session.lang = nextLang.id; })}>{cls ? <><Icon name="languages" size={17} /><span>{curLang.label}</span></> : curLang.short}</button>;
  const themeBtn = (cls = "") => <button type="button" className={`btn btn-ghost ${cls || "btn-icon pf-theme-btn"}`} aria-label={`${t(`theme.${curTheme.id}`)}. Switch to ${t(`theme.${nextTheme.id}`)}`} title={`${t(`theme.${curTheme.id}`)} · click for ${t(`theme.${nextTheme.id}`)}`}
    onClick={() => update((d) => { d.session.theme = nextTheme.id; })}><Icon name={curTheme.icon} size={cls ? 17 : 18} />{cls && <span>{t(`theme.${curTheme.id}`)}</span>}</button>;
  const foldKey = `sheetal_nav_fold_${sub || "panel"}`;
  const [foldOpen, setFoldOpen] = useState(() => { try { return JSON.parse(localStorage.getItem(foldKey) || "{}"); } catch { return {}; } });
  const toggleFold = (group, folded) => setFoldOpen((o) => {
    const n = { ...o, [group]: folded };
    try { localStorage.setItem(foldKey, JSON.stringify(n)); } catch { /* storage off */ }
    return n;
  });

  return (
    <div className={`pf-shell ${hasTabs ? "pf-has-tabs" : ""}`} style={style}>
      <aside className={`pf-side ${open ? "open" : ""}`} aria-label={t("a11y.mainNav")}>
        {/* Logo and workspace switcher stay in view while the menu below scrolls. */}
        <div className="pf-side-top">
          {brandSlot || <Link to="/" className="brand pf-brand"><img src={config.logo} alt="" /><span className="brand-word"><b>SHEETAL</b><span>{sub}</span></span></Link>}
          {switcher}
        </div>
        <nav className="pf-nav">
          {nav.map((g, i) => {
            // A group marked `fold` (rarely used pages) is one button that opens it; it opens by itself on one of its pages and
            // remembers being opened. Waiting counts inside show on the button.
            const folded = g.fold && !foldOpen[g.group] && !g.items.some(isOn);
            const waiting = g.fold ? g.items.reduce((a, it) => a + (Number(it.count) || 0), 0) : 0;
            return (
            <React.Fragment key={i}>
              {g.fold ? (
                <button type="button" className="pf-nav-fold" aria-expanded={!folded} onClick={() => toggleFold(g.group, folded)}>
                  <Icon name="ellipsis" size={17} /><span>{t(g.group)}</span>
                  {folded && waiting ? <span className="pf-count action">{waiting}</span> : null}
                  <Icon name={folded ? "chevron-down" : "chevron-up"} size={15} />
                </button>
              ) : g.group && <span className="pf-nav-group">{t(g.group)}</span>}
              {!folded && g.items.map((it) => (
                <Link key={it.to} to={it.to} className={isOn(it) ? "on" : undefined} aria-current={isOn(it) ? "page" : undefined}>
                  <Icon name={it.icon} size={17} /><span>{t(it.key)}</span>
                  {it.count ? <span className={`pf-count ${it.countTone || ""}`}>{it.count}</span> : null}
                  {isPreview(it.to) && <span className="pf-preview-tag" title="Sample data: nothing here is saved yet">Preview</span>}
                </Link>
              ))}
            </React.Fragment>
            );
          })}
        </nav>
        {sideFooter}
        {/* Phones with the bottom tabs: the top bar's branch, language and theme live here. */}
        {hasTabs && <div className="pf-side-phone">
          <span className="pf-nav-group">{t("tab.settings")}</span>
          {topExtra}
          <div className="pf-side-phone-row">{langBtn("pf-side-pill")}{themeBtn("pf-side-pill")}</div>
        </div>}
      </aside>
      {open && <div className="pf-scrim pf-scrim-nav" onClick={() => setOpen(false)} />}

      <div className="pf-body">
        {banner}
        <header className="pf-top">
          <button className="btn btn-ghost btn-icon pf-burger" onClick={() => setOpen(true)} aria-label={t("a11y.openMenu")}><Icon name="menu" size={18} /></button>
          {topLeft}
          {topExtra}
          {hasTabs && <button type="button" className="btn btn-ghost btn-icon pf-jump-icon" onClick={openPalette} aria-label={t("cmd.jump")}><Icon name="search" size={19} /></button>}
          <button className="pf-jump" onClick={openPalette}><Icon name="search" size={15} /><span>{t("cmd.jump")}</span><kbd>Ctrl K</kbd></button>
          <div className="pf-top-right">
            {quickCreate.length > 0 && <Menu trigger={({ toggle }) => <button className="btn btn-primary btn-sm pf-new" onClick={toggle}><Icon name="plus" size={15} />{t("cmd.new")}</button>}>
              {quickCreate.map((q) => <MenuLink key={q.to + q.label} to={q.to} icon={q.icon}>{q.label}</MenuLink>)}
            </Menu>}
            {/* Quick links right after New (e.g. leads and email in the business panel). */}
            {topTools && <div className="pf-top-tools">{topTools}</div>}
            {/* One button: shows the language in use; clicking switches to the other. */}
            {langBtn()}
            {/* Theme: icon only; each click moves to the next theme (light, dark, colour, …) and round again. */}
            {themeBtn()}
            <Menu trigger={({ toggle }) => (
              <button className="btn btn-ghost btn-icon pf-bell" onClick={toggle} aria-label={t("a11y.notifications")}><Icon name="bell" size={18} />{notifications.some((n) => n.unread) && <i />}</button>
            )}>
              <div className="pf-menu-head"><b>{t("notif.title")}</b><span>{t("notif.unread", { n: notifications.filter((n) => n.unread).length })}</span></div>
              <div className="pf-notif-list">
                {notifications.length ? notifications.map((n) => (
                  <Link key={n.id} to={n.to} data-close="" className={n.unread ? "unread" : undefined} onClick={() => n.onOpen?.()}><Icon name={n.icon} size={16} /><span><b>{n.title}</b><small>{n.when}</small></span></Link>
                )) : <p className="small muted" style={{ padding: 12 }}>{t("notif.none")}</p>}
              </div>
              {notifTo && <div className="pf-notif-foot">{onReadAll && notifications.some((n) => n.unread) ? <button type="button" data-close="" onClick={onReadAll}>Mark all read</button> : <span />}<Link to={notifTo} data-close="">See all</Link></div>}
            </Menu>
            <Menu trigger={({ toggle }) => (
              <button className="pf-user" onClick={toggle} aria-label={t("a11y.account")}><Avatar name={db.session.userName} size={36} /></button>
            )}>
              <div className="pf-menu-head"><b>{db.session.userName}</b><span>{db.session.userEmail}</span></div>
              {userMenu}
            </Menu>
          </div>
        </header>
        <main className="pf-main" id="main">
          {previewHere && <div className="pf-preview-note" role="note"><Icon name="eye" size={16} /><span><b>Preview.</b> This page shows sample data. Nothing you enter here is saved yet; it's coming soon.</span></div>}
          {children}
        </main>
        <CommandPalette nav={nav} actions={quickCreate} records={records} />
      </div>

      {hasTabs && (
        <nav className={`pf-tabbar ${open || sheet ? "raised" : ""}`} aria-label={t("a11y.mainNav")}>
          {tabList.slice(0, 2).map((tb) => <TabLink key={tb.to} tb={tb} on={tabOn(tb)} t={t} />)}
          {quickCreate.length > 0 && <button type="button" className="pf-tab pf-tab-new" aria-label={t("tab.new")} aria-expanded={sheet} onClick={() => { setOpen(false); setSheet((v) => !v); }}><span><Icon name={sheet ? "x" : "plus"} size={24} /></span></button>}
          {tabList.slice(2).map((tb) => <TabLink key={tb.to} tb={tb} on={tabOn(tb)} t={t} />)}
          <button type="button" className={`pf-tab ${open ? "on" : ""}`} aria-expanded={open} onClick={() => { setSheet(false); setOpen((v) => !v); }}><Icon name="menu" size={21} /><span>{t("tab.menu")}</span></button>
        </nav>
      )}
      {sheet && <>
        <div className="pf-scrim pf-scrim-sheet" onClick={() => setSheet(false)} />
        <div className="pf-sheet" role="dialog" aria-modal="true" aria-label={t("tab.new")}>
          <i className="pf-sheet-grab" aria-hidden="true" />
          <b className="pf-sheet-title">{t("tab.new")}</b>
          <div className="pf-sheet-grid">
            {quickCreate.map((q) => <Link key={q.to + q.label} to={q.to} className="pf-sheet-it" onClick={() => setSheet(false)}><span className="pf-sheet-ico"><Icon name={q.icon} size={20} /></span><span>{q.label}</span></Link>)}
          </div>
        </div>
      </>}
    </div>
  );
}

// One bottom tab: icon, short word and a waiting count.
function TabLink({ tb, on, t }) {
  return (
    <Link to={tb.to} className={`pf-tab ${on ? "on" : ""}`} aria-current={on ? "page" : undefined}>
      <span className="pf-tab-ico"><Icon name={tb.icon} size={21} />{tb.count > 0 && <b className="pf-tab-count">{tb.count > 99 ? "99+" : tb.count}</b>}</span>
      <span>{t(tb.label)}</span>
    </Link>
  );
}

export function MenuLink({ to, icon, children }) {
  return <Link to={to} data-close=""><Icon name={icon} size={16} />{children}</Link>;
}
export function MenuButton({ icon, children, onClick }) {
  return <button data-close="" onClick={onClick}><Icon name={icon} size={16} />{children}</button>;
}
export const MenuSep = () => <div className="pf-menu-sep" />;

export function Pending({ part }) {
  const t = useT();
  return (
    <div className="card pf-empty-card">
      <div className="pf-empty"><Icon name="clock" size={40} strokeWidth={1.4} /><h3>{t("pending.title")}</h3><p>{t("pending.text", { part })}</p></div>
    </div>
  );
}

export function NoAccess() {
  const t = useT();
  return (
    <div className="card pf-empty-card">
      <div className="pf-empty"><Icon name="lock" size={40} strokeWidth={1.4} /><h3>{t("noaccess.title")}</h3><p>{t("noaccess.text")}</p></div>
    </div>
  );
}
