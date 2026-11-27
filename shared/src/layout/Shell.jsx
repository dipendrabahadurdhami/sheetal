// The frame of both panels: sidebar, top bar, branch and business switchers, quick actions, bell and profile menu.
// Where it fits: BusinessApp and AdminApp render every page inside it.
// How it works: each app passes its menu and slots; pages listed in `preview` get a "Preview" tag and a note.

import React, { useEffect, useState } from "react";
import { Icon } from "../core/icons";
import { Link, useRouter } from "../core/router";
import { LANGS, useLang, useT } from "../core/i18n";
import { useStore } from "../core/store";
import { Avatar, Menu } from "../core/ui";
import { config } from "../core/config";
import { CommandPalette, openPalette } from "./CommandPalette";
import { PANEL_THEMES } from "../core/theme";

export function Shell({ sub, nav, switcher, sideFooter, topLeft, topExtra, topTools, preview = [], userMenu, banner, notifications = [], notifTo, onReadAll, brandSlot, style, quickCreate = [], records = [], themes = PANEL_THEMES, children }) {
  const { path } = useRouter();
  const t = useT();
  const lang = useLang();
  const { db, update } = useStore();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const under = (to) => path === to || path.startsWith(to + "/");
  // Pages not on the server yet (sample data only): tagged in the menu, with a note on the page.
  const isPreview = (to) => preview.some((p) => to === p || to.startsWith(p + "/"));
  const previewHere = preview.some(under);
  const isOn = (it) => (it.exact ? path === it.to : under(it.to) || (it.match || []).some(under));
  const theme = db.session.theme;
  const foldKey = `sheetal_nav_fold_${sub || "panel"}`;
  const [foldOpen, setFoldOpen] = useState(() => { try { return JSON.parse(localStorage.getItem(foldKey) || "{}"); } catch { return {}; } });
  const toggleFold = (group, folded) => setFoldOpen((o) => {
    const n = { ...o, [group]: folded };
    try { localStorage.setItem(foldKey, JSON.stringify(n)); } catch { /* storage off */ }
    return n;
  });

  return (
    <div className="pf-shell" style={style}>
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
      </aside>
      {open && <div className="pf-scrim pf-scrim-nav" onClick={() => setOpen(false)} />}

      <div className="pf-body">
        {banner}
        <header className="pf-top">
          <button className="btn btn-ghost btn-icon pf-burger" onClick={() => setOpen(true)} aria-label={t("a11y.openMenu")}><Icon name="menu" size={18} /></button>
          {topLeft}
          {topExtra}
          <button className="pf-jump" onClick={openPalette}><Icon name="search" size={15} /><span>{t("cmd.jump")}</span><kbd>Ctrl K</kbd></button>
          <div className="pf-top-right">
            {quickCreate.length > 0 && <Menu trigger={({ toggle }) => <button className="btn btn-primary btn-sm pf-new" onClick={toggle}><Icon name="plus" size={15} />{t("cmd.new")}</button>}>
              {quickCreate.map((q) => <MenuLink key={q.to + q.label} to={q.to} icon={q.icon}>{q.label}</MenuLink>)}
            </Menu>}
            {/* Quick links right after New (e.g. leads and email in the business panel). */}
            {topTools && <div className="pf-top-tools">{topTools}</div>}
            {/* One button: shows the language in use; clicking switches to the other. */}
            {(() => {
              const cur = LANGS.find((l) => l.id === lang) || LANGS[0];
              const next = LANGS[(LANGS.indexOf(cur) + 1) % LANGS.length];
              return <button type="button" className="btn btn-ghost pf-lang-one" title={`${cur.label}. Switch to ${next.label}`} aria-label={`${t("a11y.language")}: ${cur.label}. Switch to ${next.label}`}
                onClick={() => update((d) => { d.session.lang = next.id; })}>{cur.short}</button>;
            })()}
            {/* Theme: icon only; each click moves to the next theme (light, dark, colour, …) and round again. */}
            {(() => {
              const cur = themes.find((x) => x.id === theme) || themes[0];
              const next = themes[(themes.indexOf(cur) + 1) % themes.length];
              return <button type="button" className="btn btn-ghost btn-icon" aria-label={`${t(`theme.${cur.id}`)}. Switch to ${t(`theme.${next.id}`)}`} title={`${t(`theme.${cur.id}`)} · click for ${t(`theme.${next.id}`)}`}
                onClick={() => update((d) => { d.session.theme = next.id; })}><Icon name={cur.icon} size={18} /></button>;
            })()}
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
    </div>
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
