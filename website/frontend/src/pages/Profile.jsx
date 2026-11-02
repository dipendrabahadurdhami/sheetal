import { Fragment, useEffect, useState } from "react";
import { useSEO } from "../utils/seo";
import { Link, useSearchParams } from "react-router-dom";
import { MessagesSquare } from "lucide-react";
import { Messages } from "./Account";
import { LayoutGrid, Home, Heart, Bell, Crown, Settings, LogIn, Plus, Trash2, CheckCircle2, Eye, CalendarCheck, PieChart, Building2, Receipt } from "lucide-react";
import PlatformProfileTab from "../market/ProfileTabs";
import { useApp } from "../context/AppContext";
import { api } from "../api/endpoints";
import { toList , toItem } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { PropertyGrid } from "../components/PropertyCard";
import { Avatar, Confirm, Empty, usePaged, Paged } from "../components/ui";
import { POST_TYPES, STATUS, FREE_PER_TYPE, hasPlan, myPosts, saveSitePosts, sitePosts } from "../utils/sitePosts";
import { agentName, fmtPrice, images, isSold, linkOf, titleOf, timeAgo } from "../utils/format";
import { PeriodPicker, PlanCards } from "../components/PlanCards";

const TABS = [["overview", "Overview", LayoutGrid], ["orders", "My bookings", CalendarCheck], ["investments", "My investments", PieChart], ["enquiries", "Project enquiries", Building2], ["payments", "My payments", Receipt], ["listings", "My properties", Home], ["saved", "Saved", Heart], ["messages", "Messages", MessagesSquare], ["alerts", "Notifications", Bell], ["plan", "Plan", Crown], ["settings", "Settings", Settings]];

// Side menu groups (keys from TABS)
const NAV_GROUPS = [["Activity", ["overview", "orders", "investments", "enquiries", "payments"]], ["Selling", ["listings", "plan"]], ["Inbox", ["messages", "alerts", "saved"]], ["Account", ["settings"]]];
const SETTINGS = [["profile", "Profile"], ["security", "Sign-in and security"], ["notifications", "Notifications"], ["language", "Language and display"], ["kyc", "ID check"], ["data", "Your data"]];

function MyListings({ toast }) {
  const { data, loading, reload } = useAsync(() => api.myProperties().then(toList), []);
  const all = data?.items || [];
  const pg = usePaged(all, 10);
  const items = pg.items;
  const [askDel, setAskDel] = useState(null);
  const del = async (id) => { await api.deleteProperty(id); toast("Listing deleted"); reload(); };
  const sold = async (p) => { await api.markSold(p.id, !isSold(p)); toast("Status updated"); reload(); };
  if (loading) return <div className="sk" style={{ height: 240 }} />;
  if (!items.length) return <Empty icon={Home} title="No listings yet"><Link to="/post-property" className="btn btn-primary" style={{ marginTop: 12 }}><Plus size={16} /> Post a property</Link></Empty>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table" ref={pg.top}>
        <thead><tr><th>Property</th><th>Price</th><th>Status</th><th>Views</th><th /></tr></thead>
        <tbody>{items.map((p) => (
          <tr key={p.id}>
            <td><Link to={linkOf(p)} className="row" style={{ color: "var(--text-strong)", minWidth: 260 }}><img src={images(p)[0] || "/demo/1.jpg"} alt="" style={{ width: 64, height: 48, objectFit: "cover", borderRadius: "var(--r-sm)" }} /><span><span style={{ display: "block" }}>{titleOf(p)}</span><span className="tiny muted">#{p.property_code} · {timeAgo(p.created_at)}</span></span></Link></td>
            <td className="tnum">{fmtPrice(p.total_price)}</td>
            <td><span className={isSold(p) ? "tag tag-line" : "tag tag-soft"}>{isSold(p) ? "Closed" : "Live"}</span></td>
            <td className="tnum muted"><span className="row" style={{ gap: 6 }}><Eye size={14} />{p.views ?? 0}</span></td>
            <td><div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-sm" onClick={() => sold(p)}><CheckCircle2 size={14} />{isSold(p) ? "Reopen" : "Mark sold"}</button>
              <button className="btn btn-ghost btn-icon" onClick={() => setAskDel(p)} aria-label="Delete"><Trash2 size={15} /></button>
            </div></td>
          </tr>
        ))}</tbody>
      </table><Paged pg={pg} />
      <Confirm open={!!askDel} onClose={() => setAskDel(null)} onConfirm={() => del(askDel.id)} title="Delete this listing?" confirmLabel="Delete">{askDel ? `"${titleOf(askDel)}" will be removed from Sheetal. This can't be undone.` : null}</Confirm>
    </div>
  );
}

function SitePosts({ toast, user }) {
  const [, bump] = useState(0);
  useEffect(() => { const on = () => bump((n) => n + 1); window.addEventListener("shetal-site-posts", on); return () => window.removeEventListener("shetal-site-posts", on); }, []);
  const [askDel, setAskDel] = useState(null);
  const list = myPosts(user);
  const put = (id, patch) => { saveSitePosts(sitePosts().map((p) => (p.id === id ? { ...p, ...patch } : p))); };
  const plan = hasPlan(user);
  return (
    <section className="stack" style={{ gap: 12, marginBottom: 32 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Stays, projects and investments</h3>
        <div className="row" style={{ gap: 8 }}>{!plan && <span className="tiny muted">Free: {FREE_PER_TYPE} post of each type · <Link to="/my-profile?tab=plan">Upgrade</Link></span>}<Link to="/post-property?type=stay" className="btn btn-primary btn-sm"><Plus size={15} /> New post</Link></div>
      </div>
      {!list.length ? <div className="card card-pad small muted">Nothing posted yet. Offer a stay, list a project or open an investment from <Link to="/post-property?type=stay">Post property</Link>.</div> :
      <div style={{ overflowX: "auto" }}><table className="table">
        <thead><tr><th>Post</th><th>Type</th><th>Status</th><th>Views</th><th /></tr></thead>
        <tbody>{list.map((p) => (
          <tr key={p.id}>
            <td><span className="row" style={{ minWidth: 260 }}><img src={p.cover || "/demo/1.jpg"} alt="" style={{ width: 64, height: 48, objectFit: "cover", borderRadius: "var(--r-sm)" }} /><span><span style={{ display: "block", color: "var(--text-strong)" }}>{p.title}</span><span className="tiny muted">#{p.id} · {timeAgo(p.updated)}</span></span></span></td>
            <td className="small">{POST_TYPES[p.type]?.label}</td>
            <td><span className={p.status === "live" ? "tag tag-soft" : "tag tag-line"} title={STATUS[p.status]?.[1]}>{STATUS[p.status]?.[0]}</span>{p.status === "review" && <span className="tiny muted" style={{ display: "block", marginTop: 4 }}>Usually within 1 working day</span>}</td>
            <td className="tnum muted"><span className="row" style={{ gap: 6 }}><Eye size={14} />{p.views ?? 0}</span></td>
            <td><div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
              <Link to={`/post-property?type=${p.type}&edit=${p.id}`} className="btn btn-ghost btn-sm">Edit</Link>
              {(p.status === "live" || p.status === "paused") && <button className="btn btn-ghost btn-sm" onClick={() => { put(p.id, { status: p.status === "live" ? "paused" : "live" }); toast(p.status === "live" ? "Post paused" : "Post is live again"); }}>{p.status === "live" ? "Pause" : "Resume"}</button>}
              <button className="btn btn-ghost btn-icon" onClick={() => setAskDel(p)} aria-label="Delete"><Trash2 size={15} /></button>
            </div></td>
          </tr>
        ))}</tbody>
      </table></div>}
      <Confirm open={!!askDel} onClose={() => setAskDel(null)} onConfirm={() => { saveSitePosts(sitePosts().filter((x) => x.id !== askDel.id)); toast("Post deleted"); }} title="Delete this post?" confirmLabel="Delete">{askDel ? `"${askDel.title}" will be removed from Sheetal.` : null}</Confirm>
    </section>
  );
}

function Saved() {
  const { favs } = useApp();
  // the saved list may hold only property ids (no property data) — load the details for those, in parallel
  const { data, loading } = useAsync(async () => {
    const rows = toList(await api.favourites()).items || [];
    const out = await Promise.all(rows.map(async (f) => {
      const id = Number(f.property_id ?? f.property?.id ?? f.id);
      const nested = f.property && f.property.id ? f.property : null;
      if (nested && (nested.name || nested.title)) return nested;
      if (f.name && f.property_location && !f.property_id) return f;
      try { const d = toItem(await api.property(id)); return d && d.id ? d : null; } catch { return null; }
    }));
    return { items: out.filter(Boolean) };
  }, [favs.size]);
  const items = (data?.items || []).filter((p) => favs.has(Number(p.id)));
  if (!loading && !items.length) return <Empty icon={Heart} title="No saved properties">Tap the heart on any listing to keep it here. <Link to="/sale" className="link">Browse homes</Link></Empty>;
  return <PagedGrid loading={loading} items={items} />;
}

function PagedGrid({ loading, items }) {
  const pg = usePaged(items, 12);
  return <div ref={pg.top}><PropertyGrid loading={loading} items={pg.items} count={3} /><Paged pg={pg} /></div>;
}

function Alerts({ compact }) {
  const { data, loading, reload } = useAsync(() => api.notifications().then(toList), []);
  const all = data?.items || [];
  const pg = usePaged(all, 10);
  const items = compact ? all.slice(0, 5) : pg.items;
  const unread = all.some((n) => !(n.read || n.read_at));
  const head = (
    <div className="alerts-head">
      {compact ? <h3>Recent notifications</h3> : <h2>Notifications</h2>}
      {compact
        ? all.length > 0 && <Link to="/my-profile?tab=alerts" className="link small">See all{all.length > 5 ? ` (${all.length})` : ""}</Link>
        : unread && <button className="link small" style={{ background: "none", border: 0, padding: 0 }} onClick={async () => { await api.readAllNotifications(); reload(); }}>Mark all as read</button>}
    </div>
  );
  if (loading) return <div>{head}<div className="sk" style={{ height: 160 }} /></div>;
  if (!all.length) return <div>{head}<Empty icon={Bell} title="You're all caught up" /></div>;
  return (
    <div ref={pg.top}>
      {head}
      <div className="stack" style={{ gap: 0 }}>
        {items.map((n) => (
          <div key={n.id} className="alert-row">
            <span className={`alert-dot ${n.read || n.read_at ? "" : "on"}`} />
            <div className="alert-body"><b>{n.title || n.data?.title || "Notification"}</b><p className="small muted">{n.message || n.data?.message}</p></div>
            <span className="tiny muted alert-time">{timeAgo(n.created_at)}</span>
          </div>
        ))}
      </div>
      {!compact && <Paged pg={pg} />}
    </div>
  );
}

function Plan({ user, toast }) {
  const { data, loading } = useAsync(() => api.plans("agency").then(toList), []);
  const [months, setMonths] = useState(12);
  const [busy, setBusy] = useState(null);
  if (loading) return <div className="sk" style={{ height: 240 }} />;
  const cur = String(user.plan || user.role_name || "Starter").replace(/^Agent:\s*/i, "").toLowerCase();
  const choose = async (pl, m) => { setBusy(pl.id); const r = await api.requestUpgrade(pl.id, m).catch(() => null); setBusy(null); toast(r?.message || "Request sent"); };
  return (
    <div className="pf-stack">
      <PeriodPicker value={months} onChange={setMonths} />
      <PlanCards plans={data?.items || []} months={months} current={cur} busy={busy} onChoose={choose} chooseLabel="Request upgrade" />
    </div>
  );
}

function SettingsTab({ user, loadUser, toast, only }) {
  const [f, setF] = useState({ first_name: user.first_name || "", last_name: user.last_name || "", user_name: user.user_name || "", phone: user.phone || "", address: user.address || "", facebook_url: user.facebook_url || "", instagram_url: user.instagram_url || "" });
  const [pw, setPw] = useState({ current_password: "", new_password: "", new_password_confirmation: "" });
  const saveProfile = async (e) => {
    e.preventDefault();
    const fd = new FormData(); Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    try { await api.updateProfile(fd); await loadUser(); toast("Profile saved"); } catch (x) { toast(x.message); }
  };
  const savePw = async (e) => {
    e.preventDefault();
    try { await api.changePassword(pw); toast("Password changed"); setPw({ current_password: "", new_password: "", new_password_confirmation: "" }); } catch (x) { toast(x.message); }
  };
  const fld = (k, l, t = "text") => <div className="field"><label>{l}</label><input className="input" type={t} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>;
  return (
    <div className="stack" style={{ gap: 40 }}>
      {only !== "security" && <form className="stack" onSubmit={saveProfile}>
        <h3>Personal information</h3>
        <div className="form-grid">{fld("first_name", "First name")}{fld("last_name", "Last name")}{fld("user_name", "Display name")}{fld("phone", "Phone", "tel")}<div className="full">{fld("address", "Address")}</div>{fld("facebook_url", "Facebook URL")}{fld("instagram_url", "Instagram URL")}</div>
        <button className="btn btn-primary" style={{ alignSelf: "flex-start" }}>Save changes</button>
      </form>}
      {only !== "profile" && <form className="stack" onSubmit={savePw}>
        <h3>Change password</h3>
        <div className="form-grid">
          <div className="field full"><label>Current password</label><input className="input" type="password" required value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></div>
          <div className="field"><label>New password</label><input className="input" type="password" required minLength={8} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></div>
          <div className="field"><label>Confirm new password</label><input className="input" type="password" required value={pw.new_password_confirmation} onChange={(e) => setPw({ ...pw, new_password_confirmation: e.target.value })} /></div>
        </div>
        <button className="btn btn-outline" style={{ alignSelf: "flex-start" }}>Update password</button>
      </form>}
    </div>
  );
}

export default function Profile() {
  useSEO("My profile", undefined, { noindex: true });
  const { user, setAuth, loadUser, toast, favs, logout } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "overview";
  const hasToken = !!localStorage.getItem("sheetal_token");
  useEffect(() => { if (!hasToken) setAuth("login"); }, [hasToken, setAuth]);

  if (!user) return (
    <div className="container"><Empty icon={LogIn} title={hasToken ? "Loading your account…" : "Log in to see your dashboard"}>
      {!hasToken && <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setAuth("login")}>Log in</button>}
    </Empty></div>
  );

  return (
    <>
    <div className="container profile-layout">
      <aside className="stack profile-side" style={{ gap: 24 }}>
        <div className="row hide-sm"><Avatar src={user.photo} name={agentName(user)} size={56} /><div><b style={{ color: "var(--text-strong)", fontWeight: 500 }}>{agentName(user)}</b><div className="tiny muted">{user.email}</div></div></div>
        <nav className="side-nav">
          {NAV_GROUPS.map(([g, keys]) => <Fragment key={g}><span className="side-nav-group">{g}</span>{keys.map((k) => { const [, l, I] = TABS.find((x) => x[0] === k); return <button key={k} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined} onClick={() => setParams({ tab: k })}><I size={17} />{l}</button>; })}</Fragment>)}
          <button onClick={logout} className="hide-sm">Log out</button>
        </nav>
      </aside>
      <section>
        {tab !== "alerts" && <h1 className="profile-h1" style={{ marginBottom: 20 }}>{TABS.find(([k]) => k === tab)?.[1]}</h1>}
        {tab === "overview" && (
          <div className="stack" style={{ gap: 32 }}>
            <div className="grid-3">
              {[["Saved homes", favs.size, "saved"], ["Plan", user.plan || "Starter", "plan"], ["Account", user.user_type || user.role || "Member", "settings"]].map(([l, v, t]) => (
                <button key={l} className="card card-pad card-hover stack" style={{ textAlign: "left", gap: 6, color: "var(--text)" }} onClick={() => setParams({ tab: t })}>
                  <span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".12em" }}>{l}</span>
                  <span className="price-big tnum" style={{ fontSize: 34, textTransform: "capitalize" }}>{v}</span>
                </button>
              ))}
            </div>
            <div className="card card-pad row between" style={{ flexWrap: "wrap", gap: 16 }}>
              <div><h3>Have a property to sell or rent?</h3><p className="muted small">Post it and reach active buyers in minutes.</p></div>
              <Link to="/post-property" className="btn btn-primary"><Plus size={16} /> Post a property</Link>
            </div>
            <Alerts compact />
          </div>
        )}
        {tab === "listings" && <><SitePosts toast={toast} user={user} /><h3 style={{ margin: "0 0 12px" }}>Sale and rent</h3><MyListings toast={toast} /></>}
        {["orders", "investments", "enquiries", "payments"].includes(tab) && <PlatformProfileTab key={tab} tab={tab} />}
        {tab === "saved" && <><Saved /><h3 style={{ marginTop: 32 }}>Stays, projects and investments</h3><PlatformProfileTab tab="saved" /></>}
        {tab === "alerts" && <Alerts />}
        {tab === "messages" && <Messages />}
        {tab === "plan" && <Plan user={user} toast={toast} />}
        {tab === "settings" && <AccountSettings user={user} loadUser={loadUser} toast={toast} sec={params.get("s") || "profile"} setSec={(s) => setParams({ tab: "settings", s })} />}
      </section>
    </div>
    </>
  );
}

// One account settings area: Profile · Sign-in and security · Notifications · Language and display · ID check · Your data
function AccountSettings({ user, loadUser, toast, sec, setSec }) {
  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="settings-tabs" role="tablist" aria-label="Account settings">
        {SETTINGS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={sec === k} className={`chip ${sec === k ? "active" : ""}`} onClick={() => setSec(k)}>{l}</button>)}
      </div>
      {(sec === "profile" || sec === "security") && <SettingsTab only={sec} user={user} loadUser={loadUser} toast={toast} />}
      {sec !== "profile" && <PlatformProfileTab key={sec} tab="settings" section={sec} />}
    </div>
  );
}
