import React, { useState } from "react";
import { useT } from "@sheetal/shared/core/i18n";
import { useStore } from "@sheetal/shared/core/store";
import { Link, useRouter } from "@sheetal/shared/core/router";
import { can } from "@sheetal/shared/core/rbac";
import { fdate, fdatetime, inDays, rs, rsShort, TODAY } from "@sheetal/shared/core/format";
import { DataActions } from "@sheetal/shared/components/DataIO";
import { DeleteConfirm, restoreAt } from "@sheetal/shared/components/Crud";
import { Badge, Button, Drawer, Empty, Field, Input, PageHead, Panel, Select, Stat, StatusBadge, Table, Tabs, Textarea, ToggleRow, useToast } from "@sheetal/shared/core/ui";
import { Icon } from "@sheetal/shared/core/icons";
import { planOf, TenantName } from "./AdminDashboard";
import { decideListing, isStaffLive, reviewListing } from "../live";
import { LiveBlog } from "./LiveContent";

/* ───────── Moderation: listing review + business verification (KYC) ───────── */
const REJECT = ["blurry", "wrong_price", "duplicate", "missing_docs", "contact_in_photo", "other"];
const KIND = { sell: "For sale", rentout: "For rent", stay_hotel: "Hotel", stay_unit: "Stay", project: "Project", invest: "Investment" };

/** The real review queue: open a listing, look at everything (photos, owner, papers), approve or send back with a note. */
function LiveQueue({ queue }) {
  const t = useT();
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const [l, setL] = useState(null);
  const [reasons, setReasons] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    setL(null); setReasons([]); setNote("");
    if (open) reviewListing(open).then(setL).catch((e) => { toast(e.message); setOpen(null); });
  }, [open]);
  const why = [...reasons.filter((r) => r !== "other").map((r) => t(`mod.rr_${r}`)), note.trim()].filter(Boolean).join(". ");
  const decide = (decision) => {
    setBusy(true);
    decideListing(open, decision, decision === "reject" ? why : undefined)
      .then((r) => { toast(r.message); setOpen(null); queue.reload(); })
      .catch((e) => toast(e.message)).finally(() => setBusy(false));
  };
  const rows = queue.rows;
  return (
    <>
      {queue.error && <div className="pf-alert action"><Icon name="circle-alert" size={18} /><div><b>Couldn&apos;t load the queue</b><span>{queue.error}</span></div><Button size="sm" onClick={queue.reload}>Try again</Button></div>}
      <section className="card pf-panel">
        {!rows ? <p className="muted pf-pad">Loading the queue…</p> : <Table rows={rows} onRowClick={(r) => setOpen(r.id)} minWidth={760} empty={<Empty icon="circle-check" title={t("mod.clear")}>{t("mod.clearText")}</Empty>} columns={[
          { key: "title", label: t("listings.listing"), render: (r) => <span className="pf-person">{r.cover ? <img src={r.cover} alt="" width={48} height={36} style={{ objectFit: "cover", borderRadius: 6 }} /> : <Icon name="image" size={18} />}<span className="pf-two"><b>{r.title}</b><small className="tnum">{r.code} · {KIND[r.kind] || r.kind}{r.district ? ` · ${r.district}` : ""}</small></span></span> },
          { key: "by", label: t("tenants.business"), render: (r) => <span className="pf-two"><b>{r.tenant?.name || "—"}</b><small>{r.poster?.email || ""}</small></span> },
          { key: "price", label: t("listings.price"), num: true, align: "right", render: (r) => (r.price ? rsShort(r.price) + (r.pricePer === "month" ? "/mo" : r.pricePer === "night" ? "/night" : "") : "—") },
          { key: "at", label: t("mod.submitted"), num: true, render: (r) => fdatetime(r.submittedAt) },
          { key: "act", label: "", align: "right", render: (r) => <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}>{t("common.review")}</Button> },
        ]} />}
      </section>
      <Drawer open={!!open} onClose={() => setOpen(null)} title={l?.title || "Loading…"} sub={l ? `${l.code} · ${KIND[l.kind] || l.kind}` : ""}
        footer={l && <><Button variant="outline" className="pf-danger" disabled={busy || !why} onClick={() => decide("reject")}>Send back</Button><Button icon="check" disabled={busy} onClick={() => decide("approve")}>{t("mod.approve")}</Button></>}>
        {l && <div className="pf-stack">
          {l.photos.length ? <div className="pf-thumbs">{l.photos.map((p, i) => <figure key={i}><a href={p.main} target="_blank" rel="noreferrer"><img src={p.thumbnail} alt={`Photo ${i + 1}`} /></a>{i === 0 && <span className="tag tag-white">Cover</span>}</figure>)}</div>
            : <div className="pf-alert action"><Icon name="image" size={18} /><div><b>No photos</b></div></div>}
          <dl className="pf-kv">
            <dt>{t("tenants.business")}</dt><dd>{l.tenant ? `${l.tenant.name} · ${l.tenant.type} · ${l.tenant.plan?.name}` : "—"}</dd>
            <dt>Sent by</dt><dd>{l.poster ? `${l.poster.userName} · ${l.poster.email}${l.poster.phone ? ` · ${l.poster.phone}` : ""}` : "—"}</dd>
            <dt>{t("listings.price")}</dt><dd className="tnum">{l.price ? rs(l.price) + (l.pricePer ? ` / ${l.pricePer}` : "") : "—"}{l.negotiable ? " · negotiable" : ""}</dd>
            <dt>Where</dt><dd>{[l.area, l.city, l.district].filter(Boolean).join(", ") || "—"}{l.ward ? `, ward ${l.ward}` : ""}{l.lat ? " · pin set" : ""}</dd>
            <dt>Type</dt><dd>{[l.category, l.propertyType].filter(Boolean).join(" · ")}</dd>
            {(l.bedrooms || l.bathrooms) ? <><dt>Rooms</dt><dd className="tnum">{l.bedrooms || 0} bed · {l.bathrooms || 0} bath{l.floors ? ` · ${l.floors} floors` : ""}</dd></> : null}
            {(l.landArea || l.builtArea) && <><dt>Size</dt><dd>{[l.landArea, l.builtArea].filter(Boolean).join(" · ")}</dd></>}
            {l.roadAccess && <><dt>Road</dt><dd>{[l.roadAccess, l.roadType].filter(Boolean).join(" · ")}</dd></>}
            <dt>Owner (private)</dt><dd>{[l.owner.name, l.owner.phone, l.owner.email].filter(Boolean).join(" · ") || "—"}</dd>
            {l.papers && <><dt>Papers (private)</dt><dd>{Object.entries(l.papers).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}</dd></>}
            <dt>{t("mod.submitted")}</dt><dd className="tnum">{fdatetime(l.submittedAt || l.createdAt)}</dd>
          </dl>
          {l.facilities?.length > 0 && <p className="small" style={{ margin: 0 }}>{l.facilities.join(" · ")}</p>}
          {l.description && <p className="small muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{l.description.replace(/<[^>]*>/g, "").slice(0, 1500)}</p>}
          <Field label={t("mod.rejectReason")}>
            <div className="pf-chips">{REJECT.map((r) => { const on = reasons.includes(r); return <button key={r} type="button" className={`chip ${on ? "active" : ""}`} aria-pressed={on} onClick={() => setReasons(on ? reasons.filter((x) => x !== r) : [...reasons, r])}>{t(`mod.rr_${r}`)}</button>; })}</div>
          </Field>
          <Field label="Note to the business" hint="Sent with “Send back”, and shown on the listing in their panel."><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please add a photo of the access road." /></Field>
          {l.history?.length > 0 && <details><summary className="small">History</summary><ul className="pf-list small">{l.history.map((h, i) => <li key={i}><span className="tnum">{fdatetime(h.createdAt)}</span> · {h.action.replace(/^listing\./, "").replace(/_/g, " ")}</li>)}</ul></details>}
        </div>}
      </Drawer>
    </>
  );
}

// With `queue` (from the admin API, see ../live.js) the listings tab is the real review queue.
export function AdminModeration({ role, queue }) {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const { navigate } = useRouter();
  const [tab, setTab] = useState(can(role, "moderation.listings") ? "listings" : "kyc");
  const [open, setOpen] = useState(null);
  const [reason, setReason] = useState("blurry");
  const pendingLocal = db.listings.filter((l) => l.status === "in_review");
  const kyc = db.tenants.filter((x) => x.status === "pending_verification");
  const l = db.listings.find((x) => x.id === open);
  const decide = (id, status) => { update((d) => { const x = d.listings.find((y) => y.id === id); x.status = status; if (status === "rejected") x.reason = reason; audit(d, `${status === "published" ? "approved" : "rejected"} listing ${id}`); }); setOpen(null); toast(t(status === "published" ? "mod.toastApproved" : "mod.toastRejected")); };
  const tabs = [can(role, "moderation.listings") && { id: "listings", label: t("mod.listings"), count: queue ? queue.waiting : pendingLocal.length, icon: "house" }, can(role, "moderation.kyc") && { id: "kyc", label: t("mod.kyc"), count: kyc.length, icon: "badge-check" }, !queue && { id: "reports", label: t("mod.reports"), count: 2, icon: "flag" }].filter(Boolean);
  return (
    <>
      <PageHead title={t("nav.moderation")} sub={t("mod.sub")} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === "listings" && queue && <LiveQueue queue={queue} />}
      {tab === "listings" && !queue && <section className="card pf-panel"><Table rows={pendingLocal} onRowClick={(r) => setOpen(r.id)} minWidth={720} empty={<Empty icon="circle-check" title={t("mod.clear")}>{t("mod.clearText")}</Empty>} columns={[
        { key: "title", label: t("listings.listing"), render: (r) => <span className="pf-two"><b>{r.title}</b><small className="tnum">{r.id}</small></span> },
        { key: "by", label: t("tenants.business"), render: (r) => db.tenants.find((x) => x.id === r.tenantId)?.name },
        { key: "price", label: t("listings.price"), num: true, align: "right", render: (r) => rsShort(r.price) },
        { key: "at", label: t("mod.submitted"), num: true, render: (r) => fdate(r.updated) },
        { key: "act", label: "", align: "right", render: (r) => <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}>{t("common.review")}</Button> },
      ]} /></section>}
      {tab === "kyc" && <section className="card pf-panel"><Table rows={kyc} onRowClick={(r) => navigate(`/admin/tenants/${r.id}`)} minWidth={720} empty={<Empty icon="badge-check" title={t("mod.kycClear")} />} columns={[
        { key: "n", label: t("tenants.business"), render: (r) => <TenantName r={r} /> },
        { key: "pan", label: t("tenant.pan"), num: true, render: (r) => r.pan },
        { key: "docs", label: t("mod.docs"), render: () => <span className="pf-chips"><Badge tone="done">{t("mod.reg")}</Badge><Badge tone="done">PAN</Badge><Badge tone="action">{t("mod.ownerId")}</Badge></span> },
        { key: "since", label: t("mod.submitted"), num: true, render: (r) => fdate(r.since) },
      ]} /></section>}
      {tab === "reports" && <section className="card pf-panel"><ul className="pf-list">
        {[["L-1043", "fake", "Price changed after visit"], ["S-202", "photos", "Photos look different from the villa"]].map(([id, k, note]) => (
          <li key={id}><span className="pf-li-ico"><Icon name="flag" size={16} /></span><div><b>{t(`mod.r_${k}`)} · <span className="tnum">{id}</span></b><span className="small muted">{note}</span></div><Button variant="outline" size="sm">{t("common.review")}</Button></li>
        ))}</ul></section>}
      <Drawer open={!!l} onClose={() => setOpen(null)} title={l?.title} sub={l?.id}
        footer={l && <><Button variant="outline" className="pf-danger" onClick={() => decide(l.id, "rejected")}>{t("common.reject")}</Button><Button icon="check" onClick={() => decide(l.id, "published")}>{t("mod.approve")}</Button></>}>
        {l && <div className="pf-stack">
          <div className="pf-wiz-cover" style={{ borderRadius: "var(--r)" }}><span><Icon name="image" size={28} />{t("mod.photos", { n: 9 })}</span></div>
          <dl className="pf-kv"><dt>{t("tenants.business")}</dt><dd>{db.tenants.find((x) => x.id === l.tenantId)?.name}</dd><dt>{t("listings.price")}</dt><dd className="tnum">{rs(l.price)}</dd><dt>{t("mod.submitted")}</dt><dd className="tnum">{fdate(l.updated)}</dd></dl>
          <div className="pf-fb-label"><b>{t("mod.checks")}</b></div>
          <div className="pf-docs">{["c_photos", "c_price", "c_location", "c_docs", "c_contact"].map((k, i) => <div key={k} className={i < 3 ? "on" : ""}><Icon name={i < 3 ? "circle-check" : "circle-alert"} size={18} /><span>{t(`mod.${k}`)}</span>{i < 3 ? <Badge tone="done">{t("mod.pass")}</Badge> : <Badge tone="action">{t("mod.check")}</Badge>}</div>)}</div>
          <Field label={t("mod.rejectReason")}><div className="pf-chips">{REJECT.map((r) => <button key={r} className={`chip ${reason === r ? "active" : ""}`} onClick={() => setReason(r)}>{t(`mod.rr_${r}`)}</button>)}</div></Field>
        </div>}
      </Drawer>
    </>
  );
}

export function audit(d, what) { d.platformActivity.unshift({ id: Math.random().toString(36).slice(2), who: d.session.userName, what, at: new Date().toISOString() }); }

/* ───────── Site content: home sections, banners, pages, blog, SEO ───────── */
const HOME_SECTIONS = ["hero", "featured", "projects", "investments", "stays", "areas", "tools", "agents", "journal"];
const PAGES = [["about", "About us", null], ["terms", "Terms and conditions", null], ["privacy", "Privacy policy", null], ["cancellation", "Cancellation and refund", null], ["booking_terms", "Booking terms", null], ["investment_terms", "Investment terms and risk", null]];
const siteHref = (p) => (window.location.hash.startsWith("#/") ? `#${p}` : p);
const ViewLink = ({ to, label = "View on site" }) => <a className="btn btn-ghost btn-sm" href={siteHref(to)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><Icon name="external-link" size={14} />{label}</a>;
const SECTION_AT = { hero: "/", featured: "/featured", projects: "/project", investments: "/investment/explore", stays: "/stays", areas: "/", tools: "/tools/emi", agents: "/agencies", journal: "/blog" };
export function AdminContent() {
  const t = useT();
  const { db, update } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState("home");
  const c = db.content || { sections: Object.fromEntries(HOME_SECTIONS.map((s) => [s, true])), order: HOME_SECTIONS, banners: [] };
  const setC = (fn) => update((d) => { d.content = d.content || structuredClone(c); fn(d.content); });
  const [editPage, setEditPage] = useState(null);
  const DAY = TODAY.slice(0, 10);
  const posts = c.posts || SEED_POSTS;
  const pages = PAGES.map(([id, title, upd]) => ({ id, title, upd, version: 1, ...(c.pages?.[id] || {}) }));
  const setCx = (fn) => setC((x) => { if (!x.posts) x.posts = structuredClone(SEED_POSTS); if (!x.pages) x.pages = {}; fn(x); });
  const [post, setPost] = useState(null);
  const [preview, setPreview] = useState(null);
  const [ai, setAi] = useState(null);
  const [delPost, setDelPost] = useState(null);
  const blankPost = () => ({ id: "", title: "", slug: "", category: "Buying guide", status: "draft", date: DAY, body: "", seoTitle: "", seoDesc: "" });
  const savePost = (p, status) => {
    const rec = { ...p, id: p.id || `p${Date.now().toString(36)}`, slug: p.slug.trim() || slugify(p.title), status, updated: DAY, site: false };
    setCx((x) => { const i = x.posts.findIndex((y) => y.id === rec.id); if (i >= 0) x.posts[i] = rec; else x.posts.unshift(rec); });
    setPost(null);
    toast(status === "published" ? "Post published" : status === "scheduled" ? `Scheduled for ${fdate(rec.date)}` : p.status === "published" ? "Post unpublished. It is a draft again." : "Draft saved");
  };
  const importPosts = (rows) => setCx((x) => { rows.forEach((r, i) => x.posts.unshift({ id: `p${Date.now().toString(36)}${i}`, title: r.title, slug: r.slug || slugify(r.title), category: r.category || "", status: String(r.status || "Draft").toLowerCase(), date: r.date || DAY, body: r.body || "", seoTitle: r.seoTitle || "", seoDesc: r.seoDesc || "", updated: DAY, site: false })); });
  const postBadge = (r) => r.status === "published" ? <Badge tone="done">Published</Badge> : r.status === "scheduled" ? <Badge tone="progress" icon="clock">{`Scheduled · ${fdate(r.date)}`}</Badge> : <Badge tone="neutral">Draft</Badge>;
  const [pageBody, setPageBody] = useState(null);
  const openPage = (r) => { setEditPage(r); setPageBody({ title: r.title, body: r.body || (r.id === "about" ? ABOUT.story : ""), reaccept: false, ...(r.id === "about" ? { heroTitle: r.heroTitle ?? ABOUT.heroTitle, heroText: r.heroText ?? ABOUT.heroText, stats: structuredClone(r.stats || ABOUT.stats), values: structuredClone(r.values || ABOUT.values), contact: { ...ABOUT.contact, ...(r.contact || {}) } } : {}) }); };
  return (
    <>
      <PageHead title={t("nav.content")} sub={t("content.sub")} actions={<a className="btn btn-outline" href={siteHref("/")} target="_blank" rel="noreferrer"><Icon name="external-link" size={16} />{t("content.viewSite")}</a>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "home", label: t("content.home"), icon: "house" }, { id: "banners", label: t("content.banners"), icon: "image", count: c.banners.length }, { id: "pages", label: t("content.pages"), icon: "file-text", count: PAGES.length }, { id: "blog", label: t("content.blog"), icon: "newspaper", count: posts.length || undefined }, { id: "seo", label: "SEO", icon: "search" }]} />
      {tab === "home" && <Panel title={t("content.homeTitle")} sub={t("content.homeSub")}>
        <ul className="pf-cat-list">{c.order.map((s, i) => (
          <li key={s}><span className="pf-cat-ico"><Icon name="grip-vertical" size={16} /></span><span className="pf-two"><b>{t(`content.s_${s}`)}</b><small>{t(`content.sd_${s}`)}</small></span>
            <div className="pf-row-actions"><button className="btn btn-ghost btn-icon" aria-label={t("catalog.up")} disabled={i === 0} onClick={() => setC((x) => { [x.order[i - 1], x.order[i]] = [x.order[i], x.order[i - 1]]; })}><Icon name="arrow-up" size={15} /></button>
              <button className="btn btn-ghost btn-icon" aria-label="down" disabled={i === c.order.length - 1} onClick={() => setC((x) => { [x.order[i + 1], x.order[i]] = [x.order[i], x.order[i + 1]]; })}><Icon name="arrow-down" size={15} /></button></div>
            <ViewLink to={SECTION_AT[s] || "/"} label="View" />
            <ToggleRowInline on={c.sections[s]} onChange={(v) => setC((x) => { x.sections[s] = v; })} label={t(`content.s_${s}`)} />
          </li>))}</ul>
        <div className="pf-panel-foot"><span className="small muted">{t("content.liveNote")}</span><Button onClick={() => toast(t("content.toastPublished"))}>{t("content.publish")}</Button></div>
      </Panel>}
      {tab === "banners" && <section className="card pf-panel">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("content.banners")}</h2><span>{t("content.bannersSub")}</span></div><Button icon="plus" size="sm" onClick={() => setC((x) => { x.banners.unshift({ id: `b${Date.now()}`, title: t("content.newBanner"), link: "/", active: false, ends: inDays(30) }); })}>{t("content.addBanner")}</Button></div>
        <Table rows={c.banners} minWidth={680} columns={[
          { key: "title", label: t("content.bTitle"), render: (b) => <span className="pf-two"><b>{b.title}</b><small>{b.link}</small></span> },
          { key: "ends", label: t("content.ends"), num: true, render: (b) => fdate(b.ends) },
          { key: "st", label: t("common.status"), render: (b) => b.active ? <Badge tone="done">{t("content.live")}</Badge> : <Badge tone="neutral">{t("content.off")}</Badge> },
          { key: "view", label: "", align: "right", render: (b) => <ViewLink to={b.link} label="View" /> },
          { key: "act", label: "", align: "right", render: (b) => <ToggleRowInline on={b.active} label={b.title} onChange={(v) => setC((x) => { x.banners.find((y) => y.id === b.id).active = v; })} /> },
        ]} />
      </section>}
      {tab === "pages" && <section className="card pf-panel"><Table rows={pages} onRowClick={(r) => { openPage(r); }} minWidth={600} columns={[
        { key: "title", label: t("content.page"), render: (r) => <span className="pf-two"><b>{r.title}</b><small>/{r.id.replace("_", "-")}</small></span> },
        { key: "v", label: t("content.version"), num: true, render: (r) => `v${r.version}` },
        { key: "upd", label: t("content.updated"), num: true, render: (r) => fdate(r.updated || r.upd) },
        { key: "act", label: "", align: "right", render: (r) => <div className="pf-row-actions"><ViewLink to={r.id === "about" ? "/about" : `/legal/${r.id.replace("_", "-")}`} label="View" /><Button variant="ghost" size="sm" icon="pencil" onClick={(e) => { e.stopPropagation(); openPage(r); }}>{t("common.edit")}</Button></div> },
      ]} /></section>}
      {tab === "blog" && isStaffLive() && <LiveBlog />}
      {tab === "blog" && !isStaffLive() && <section className="card pf-panel">
        <div className="pf-panel-head"><div className="pf-panel-title"><h2>{t("content.blog")}</h2></div><div className="pf-panel-actions"><DataActions kind="blog" size="sm" rows={posts.map((p) => ({ ...p, status: p.status[0].toUpperCase() + p.status.slice(1) }))} onImport={importPosts} /><Button variant="outline" size="sm" icon="sparkles" onClick={() => setAi("")}>{t("content.aiDraft")}</Button><Button size="sm" icon="plus" onClick={() => setPost(blankPost())}>{t("content.newPost")}</Button></div></div>
        <Table rows={posts} minWidth={640} onRowClick={(r) => setPost({ ...r })}
          empty={<Empty icon="newspaper" title="No posts yet" action={<Button icon="plus" onClick={() => setPost(blankPost())}>{t("content.newPost")}</Button>}>Write a guide or news post for the Journal.</Empty>} columns={[
          { key: "title", label: t("content.post"), render: (r) => <span className="pf-two"><b>{r.title}</b><small>{r.category || "No category"} · /blog/{r.slug}</small></span> },
          { key: "st", label: t("common.status"), render: postBadge },
          { key: "d", label: t("content.updated"), num: true, render: (r) => fdate(r.updated || r.date) },
          { key: "v", label: "", align: "right", render: (r) => <div className="pf-row-actions" onClick={(e) => e.stopPropagation()}><Button variant="ghost" size="sm" icon="eye" onClick={() => setPreview(r)}>Preview</Button>{r.status === "published" && <ViewLink to={`/blog/${r.slug}`} label="View" />}</div> },
        ]} />
      </section>}
      {tab === "seo" && <Panel title="SEO" sub={t("content.seoSub")} pad><div className="pf-stack">
        <Field label={t("content.siteTitle")}><Input defaultValue="Sheetal Property · Homes, land, stays and projects in Nepal" /></Field>
        <Field label={t("content.siteDesc")}><Textarea defaultValue="Buy, rent, stay and invest across Nepal with online booking and agreements." /></Field>
        <ToggleRow title={t("content.schema")} sub={t("content.schemaSub")} checked onChange={() => {}} />
        <ToggleRow title={t("content.sitemap")} sub={t("content.sitemapSub")} checked onChange={() => {}} />
      </div></Panel>}
      <Drawer open={!!editPage} onClose={() => setEditPage(null)} title={editPage?.title} sub={t("content.pageEditSub")}
        footer={<><Button variant="outline" onClick={() => setEditPage(null)}>{t("common.cancel")}</Button><Button disabled={!pageBody?.title?.trim()} onClick={() => { const v = (editPage.version || 1) + 1; setCx((x) => { x.pages[editPage.id] = { ...pageBody, title: pageBody.title.trim(), version: v, updated: DAY }; }); setEditPage(null); toast(`${pageBody.title.trim()} published as v${v}`); }}>{t("content.publishV")}</Button></>}>
        {editPage && pageBody && <div className="pf-stack">
          <Field label={t("content.page")}><Input value={pageBody.title} onChange={(e) => setPageBody({ ...pageBody, title: e.target.value })} /></Field>
          <Field label={editPage.id === "about" ? "Who we are" : t("content.body")} hint={editPage.id === "about" ? "Two paragraphs, with a blank line between them." : 'Leave empty to keep the current text on the site. Start a line with "## " for a heading and "- " for a list item.'}><Textarea rows={14} value={pageBody.body} onChange={(e) => setPageBody({ ...pageBody, body: e.target.value })} placeholder={"## Who we are\nSheetal Property connects buyers, renters and guests with businesses across Nepal.\n\n## How bookings work\n- Pay online or at the property\n- Cancel free within the stated period"} style={{ minHeight: 280 }} /></Field>
          {editPage.id === "about" && <StoryFit body={pageBody.body} />}
          {editPage.id === "about" && <AboutFields b={pageBody} set={setPageBody} />}
          <ToggleRow title={t("content.reaccept")} sub={t("content.reacceptSub")} checked={pageBody.reaccept} onChange={(v) => setPageBody({ ...pageBody, reaccept: v })} />
        </div>}
      </Drawer>
      <Drawer open={!!post} onClose={() => setPost(null)} title={post?.id ? "Edit post" : t("content.newPost")} sub={post && (post.status === "published" ? "Live on the Journal. Saving updates it straight away." : "Not on the site until you publish")}
        footer={post && <>
          {post.id && <Button variant="ghost" className="pf-danger pf-foot-left" icon="trash-2" onClick={() => setDelPost(post)}>{t("common.delete")}</Button>}
          <Button variant="outline" icon="eye" disabled={!post.title.trim()} onClick={() => setPreview(post)}>Preview</Button>
          {post.status === "published"
            ? <><Button variant="outline" onClick={() => savePost(post, "draft")}>Unpublish</Button><Button icon="check" disabled={!post.title.trim()} onClick={() => savePost(post, "published")}>Save</Button></>
            : <><Button variant="outline" disabled={!post.title.trim()} onClick={() => savePost(post, "draft")}>Save draft</Button>
              {post.date > DAY ? <Button icon="clock" disabled={!post.title.trim() || !post.body.trim()} onClick={() => savePost(post, "scheduled")}>Schedule</Button>
                : <Button icon="send" disabled={!post.title.trim() || !post.body.trim()} onClick={() => savePost({ ...post, date: DAY }, "published")}>Publish</Button>}</>}
        </>}>
        {post && <div className="pf-stack">
          <Field label="Title"><Input value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value, slug: post.id ? post.slug : slugify(e.target.value) })} placeholder="How to verify a lal purja" /></Field>
          <div className="pf-grid-2 tight">
            <Field label="Address" hint={`/blog/${post.slug || "…"}`}><Input value={post.slug} onChange={(e) => setPost({ ...post, slug: slugify(e.target.value) })} /></Field>
            <Field label="Category"><Select value={post.category} onChange={(v) => setPost({ ...post, category: v })} options={POST_CATS.map((x) => ({ id: x, label: x }))} /></Field>
          </div>
          <Field label="Post" hint={'Start a line with "## " for a heading and "- " for a list item.'}><Textarea rows={16} value={post.body} onChange={(e) => setPost({ ...post, body: e.target.value })} style={{ minHeight: 300 }} /></Field>
          <Field label="Publish on" hint={post.date > DAY ? "A later date schedules the post" : "Today or earlier publishes now"}><Input type="date" value={post.date} onChange={(e) => setPost({ ...post, date: e.target.value })} /></Field>
          <Field label="SEO title" optional hint={`${(post.seoTitle || post.title).length} of 60 characters`}><Input value={post.seoTitle} onChange={(e) => setPost({ ...post, seoTitle: e.target.value })} placeholder={post.title} /></Field>
          <Field label="SEO description" optional hint={`${post.seoDesc.length} of 160 characters`}><Textarea rows={2} value={post.seoDesc} onChange={(e) => setPost({ ...post, seoDesc: e.target.value })} style={{ minHeight: 64 }} /></Field>
        </div>}
      </Drawer>
      <Drawer open={!!preview} onClose={() => setPreview(null)} title="Preview" sub={preview && `${preview.category || "Journal"} · ${fdate(preview.date)}`}>
        {preview && <article className="pf-stack"><h2 style={{ margin: 0 }}>{preview.title}</h2>{preview.body.trim() ? <PostBody body={preview.body} /> : <p className="muted small">This post has no text yet.</p>}</article>}
      </Drawer>
      <Drawer open={ai !== null} onClose={() => setAi(null)} title={t("content.aiDraft")} sub="Starts a draft with a title and outline for you to write into"
        footer={<><Button variant="outline" onClick={() => setAi(null)}>{t("common.cancel")}</Button><Button icon="sparkles" disabled={!String(ai || "").trim()} onClick={() => { const topic = ai.trim(); setAi(null); setPost({ ...blankPost(), title: topic, slug: slugify(topic), body: outline(topic) }); }}>Create draft</Button></>}>
        <Field label="Topic"><Input value={ai || ""} onChange={(e) => setAi(e.target.value)} placeholder="Renting a flat in Lalitpur" autoFocus /></Field>
      </Drawer>
      <DeleteConfirm item={delPost} name={delPost?.title} what="post" onClose={() => setDelPost(null)}
        onDelete={(x) => { setCx((c2) => { c2.posts = c2.posts.filter((y) => y.id !== x.id); }); setPost(null); }}
        onRestore={(x) => setCx((c2) => { restoreAt(c2.posts, x, 0); })}>
        {delPost?.status === "published" ? "The post comes off the Journal straight away. " : ""}You can undo this for a few seconds after deleting.
      </DeleteConfirm>
    </>
  );
}
// About us page: built-in text, used until Admin saves its own
const ABOUT = {
  heroTitle: "Building Nepal's future, property by property.",
  heroText: "Since 2015, Sheetal Property has helped owners, buyers and investors across Nepal with property sales, management and development.",
  stats: [["10+", "Years in Nepal real estate"], ["2,000+", "Active listings"], ["7", "Sheetal Group brands"]],
  values: [["Transparency above all", "No hidden agendas and no inflated figures. Every recommendation is clear, honest and easy to verify."], ["Strategic partnership", "We are not a traditional brokerage. We work alongside owners, investors and developers as long-term partners."], ["Professional results", "Modern systems, skilled teams and a digital-first approach that raise the standard for Nepal's property market."], ["Long-term relationships", "Our work continues well after a deal closes. We build partnerships on trust, growth and shared success."]],
  story: "We are not just selling land, homes or projects. We build trust, long-term value and future-ready communities across Nepal. Every deal is explained clearly, from the first call to the final paperwork, so you know where you stand.\n\nWe guide owners, buyers and investors through home loans, legal checks, property management and rent. Sheetal also lists stays, projects and investments, and gives hotels, hosts, agencies and developers online business tools.",
  contact: { address: "Kathmandu, Nepal", phone1: "+977 980-1000434", phone2: "970-5250833", email: "shetalrealestate@gmail.com", hours: "Sunday – Friday · 9:00 AM – 6:00 PM" },
};
// "Who we are" shows two paragraphs side by side; 200–232 characters fills exactly 4 lines on a wide screen
const FIT = [200, 232];
function StoryFit({ body }) {
  const paras = String(body || "").replace(/\r\n/g, "\n").split(/\n{2,}/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  return (
    <div className="pf-stack tight">
      {paras.map((x, i) => { const n = x.length; const ok = n >= FIT[0] && n <= FIT[1]; const w = x.split(" ").length;
        return <span key={i} className={ok ? "pf-hint" : "pf-error"}><Icon name={ok ? "circle-check" : "circle-alert"} size={14} />Paragraph {i + 1}: {n} characters, {w} words · {ok ? "fits 4 lines" : n < FIT[0] ? `add about ${FIT[0] - n} characters for 4 full lines` : `cut about ${n - FIT[1]} characters to stay on 4 lines`}</span>; })}
      {paras.length !== 2 && <span className="pf-error"><Icon name="circle-alert" size={14} />Write 2 paragraphs, with a blank line between them. You have {paras.length}.</span>}
      <span className="pf-hint">Aim for {FIT[0]}–{FIT[1]} characters (about 33–38 words) in each paragraph.</span>
    </div>
  );
}
function AboutFields({ b, set }) {
  const row = (key, i, k, v) => set({ ...b, [key]: b[key].map((r, j) => (j === i ? Object.assign([...r], { [k]: v }) : r)) });
  const drop = (key, i) => set({ ...b, [key]: b[key].filter((_, j) => j !== i) });
  const C = (k, label, ph) => <Field label={label} optional><Input value={b.contact[k] || ""} placeholder={ph} onChange={(e) => set({ ...b, contact: { ...b.contact, [k]: e.target.value } })} /></Field>;
  return (
    <div className="pf-stack">
      <b className="pf-strong">Top of the page</b>
      <Field label="Heading"><Input value={b.heroTitle} onChange={(e) => set({ ...b, heroTitle: e.target.value })} /></Field>
      <Field label="Intro"><Textarea rows={3} value={b.heroText} onChange={(e) => set({ ...b, heroText: e.target.value })} style={{ minHeight: 72 }} /></Field>
      <b className="pf-strong">Numbers</b>
      {b.stats.map(([v, l], i) => <div key={i} className="pf-grid-2 tight" style={{ gridTemplateColumns: "110px minmax(0,1fr) auto", alignItems: "end" }}>
        <Field label="Number"><Input value={v} onChange={(e) => row("stats", i, 0, e.target.value)} placeholder="10+" /></Field>
        <Field label="What it counts"><Input value={l} onChange={(e) => row("stats", i, 1, e.target.value)} /></Field>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove number" onClick={() => drop("stats", i)}><Icon name="trash-2" size={15} /></button>
      </div>)}
      {b.stats.length < 6 && <Button variant="outline" size="sm" icon="plus" onClick={() => set({ ...b, stats: [...b.stats, ["", ""]] })}>Add a number</Button>}
      <b className="pf-strong">Our values</b>
      {b.values.map(([tt, d], i) => <div key={i} className="pf-repeat">
        <div className="pf-repeat-head"><b>Value {i + 1}</b><button type="button" className="btn btn-ghost btn-sm" onClick={() => drop("values", i)}><Icon name="trash-2" size={14} />Remove</button></div>
        <Field label="Title"><Input value={tt} onChange={(e) => row("values", i, 0, e.target.value)} /></Field>
        <Field label="Text"><Textarea rows={2} value={d} onChange={(e) => row("values", i, 1, e.target.value)} style={{ minHeight: 60 }} /></Field>
      </div>)}
      {b.values.length < 8 && <Button variant="outline" size="sm" icon="plus" onClick={() => set({ ...b, values: [...b.values, ["", ""]] })}>Add a value</Button>}
      <b className="pf-strong">Contact us</b>
      {C("address", "Address", "Kathmandu, Nepal")}
      <div className="pf-grid-2 tight">{C("phone1", "Main phone", "+977 980-1000434")}{C("phone2", "Second phone")}</div>
      <div className="pf-grid-2 tight">{C("email", "Email")}{C("hours", "Opening hours")}</div>
      <p className="pf-hint">"Who we are" uses the Body text above. Services come from the service pages, and brand logos from the site files.</p>
    </div>
  );
}
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const POST_CATS = ["Buying guide", "Market trends", "Legal", "Home loans", "Renting", "Stays and travel", "News"];
const SEED_POSTS = []
  .map(([title, category, status, date], i) => ({ id: `p${i + 1}`, title, slug: slugify(title), category, status, date, updated: date, body: "", seoTitle: "", seoDesc: "", site: true }));
const outline = (topic) => `## Why ${topic.toLowerCase()} matters\nWho this is for and what they will learn.\n\n## What to check first\n- \n- \n- \n\n## Step by step\nWalk the reader through it in order.\n\n## Costs and documents\nWhat it costs in Nepal and which papers are needed.\n\n## Before you decide\nOne short paragraph with the key advice.`;
function PostBody({ body }) {
  const out = []; let ul = null;
  String(body).replace(/\r\n/g, "\n").split(/\n{2,}/).forEach((chunk, i) => {
    const lines = chunk.split("\n").filter((l) => l.trim()); if (!lines.length) return;
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) { out.push(<ul key={i} style={{ margin: 0, paddingLeft: 20 }}>{lines.map((l, k) => <li key={k}>{l.replace(/^\s*[-*]\s+/, "")}</li>)}</ul>); return; }
    if (/^#{1,3}\s/.test(lines[0])) { out.push(<h3 key={i} style={{ margin: "8px 0 0" }}>{lines[0].replace(/^#+\s*/, "")}</h3>); if (lines.length > 1) out.push(<p key={i + "p"} style={{ margin: 0 }}>{lines.slice(1).join(" ")}</p>); return; }
    out.push(<p key={i} style={{ margin: 0 }}>{lines.join(" ")}</p>);
  });
  return <>{out}</>;
}
function ToggleRowInline({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`pf-switch ${on ? "on" : ""}`} onClick={() => onChange(!on)}><span /></button>;
}

/* ───────── Billing: Sheetal invoices to businesses, payouts, refunds ───────── */
export function AdminBilling({ role }) {
  const t = useT();
  const { db } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState("invoices");
  const inv = []; // Sheetal invoices to businesses come from the billing API
  const payouts = [];
  const refunds = [];
  const sum = (a, s) => a.filter((x) => !s || x.status === s).reduce((m, x) => m + x.amount, 0);
  return (
    <>
      <PageHead title={t("nav.billing")} sub={t("pbill.sub")} actions={<Button variant="outline" icon="download">{t("common.exportCsv")}</Button>} />
      <div className="pf-stats">
        <Stat label={t("pbill.collected")} value={rsShort(sum(inv, "paid"))} note={t("pbill.thisMonth")} />
        <Stat label={t("pbill.overdue")} value={rsShort(sum(inv, "overdue"))} note={t("pbill.overdueN", { n: inv.filter((x) => x.status === "overdue").length })} tone="action" noteIcon="circle-alert" />
        <Stat label={t("pbill.payoutsDue")} value={rsShort(sum(payouts, "pending"))} note={t("pbill.payoutDay", { d: fdate(inDays((12 - new Date().getDay()) % 7 || 7)) })} />
        <Stat label={t("pbill.refunds")} value={rsShort(sum(refunds, "pending"))} note={t("pbill.refundsN", { n: refunds.filter((x) => x.status === "pending").length })} />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "invoices", label: t("pbill.invoices"), count: inv.length }, { id: "payouts", label: t("nav.payouts"), count: payouts.length }, { id: "refunds", label: t("pbill.refundsTab"), count: refunds.length }]} />
      <section className="card pf-panel">
        {tab === "invoices" && <Table rows={inv} minWidth={820} columns={[
          { key: "id", label: t("billing.invoice"), num: true, render: (r) => <b className="pf-strong">{r.id}</b> },
          { key: "t", label: t("tenants.business"), render: (r) => <TenantName r={r.tenant} /> },
          { key: "a", label: t("billing.amount"), num: true, align: "right", render: (r) => rs(r.amount) },
          { key: "due", label: t("pbill.due"), num: true, render: (r) => fdate(r.due) },
          { key: "s", label: t("common.status"), render: (r) => <StatusBadge status={r.status} /> },
          { key: "x", label: "", align: "right", render: (r) => r.status === "overdue" && <Button variant="outline" size="sm" icon="send" onClick={() => toast(t("pbill.toastReminder"))}>{t("pbill.remind")}</Button> },
        ]} />}
        {tab === "payouts" && <Table rows={payouts} minWidth={720} columns={[
          { key: "id", label: t("pbill.payout"), num: true, render: (r) => <b className="pf-strong">{r.id}</b> },
          { key: "t", label: t("tenants.business"), render: (r) => <TenantName r={r.tenant} /> },
          { key: "a", label: t("billing.amount"), num: true, align: "right", render: (r) => rs(r.amount) },
          { key: "d", label: t("billing.date"), num: true, render: (r) => fdate(r.date) },
          { key: "s", label: t("common.status"), render: (r) => <StatusBadge status={r.status} /> },
          { key: "x", label: "", align: "right", render: (r) => r.status === "pending" && can(role, "billing.refund") && <Button size="sm" onClick={() => toast(t("pbill.toastPayout"))}>{t("pbill.release")}</Button> },
        ]} />}
        {tab === "refunds" && <Table rows={refunds} minWidth={720} columns={[
          { key: "id", label: t("pbill.refund"), num: true, render: (r) => <b className="pf-strong">{r.id}</b> },
          { key: "w", label: t("bk.guest"), render: (r) => <span className="pf-two"><b>{r.who}</b><small className="tnum">{r.order}</small></span> },
          { key: "a", label: t("billing.amount"), num: true, align: "right", render: (r) => rs(r.amount) },
          { key: "m", label: t("pos.method"), render: (r) => r.method },
          { key: "s", label: t("common.status"), render: (r) => <StatusBadge status={r.status} /> },
          { key: "x", label: "", align: "right", render: (r) => r.status === "pending" && can(role, "billing.refund") && <Button size="sm" onClick={() => toast(t("pbill.toastRefund"))}>{t("pbill.approve")}</Button> },
        ]} />}
      </section>
    </>
  );
}

/* ───────── Audit log ───────── */
export function AdminAudit() {
  const t = useT();
  const { db } = useStore();
  const [q, setQ] = useState("");
  const [who, setWho] = useState("all");
  const people = [...new Set(db.platformActivity.map((a) => a.who))];
  const rows = db.platformActivity.filter((a) => (who === "all" || a.who === who) && `${a.who} ${a.what}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHead title={t("nav.audit")} sub={t("audit.sub")} actions={<Button variant="outline" icon="download">{t("common.exportCsv")}</Button>} />
      <section className="card pf-panel">
        <div className="pf-toolbar">
          <div className="pf-search"><Icon name="search" size={15} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("audit.search")} aria-label={t("audit.search")} /></div>
          <Select value={who} onChange={setWho} style={{ width: 200, height: 38 }} options={[{ id: "all", label: t("audit.everyone") }, ...people.map((p) => ({ id: p, label: p }))]} aria-label={t("audit.who")} />
        </div>
        {rows.length ? <ul className="pf-feed">{rows.map((a) => <li key={a.id}><Icon name="history" size={16} /><span><b>{a.who}</b> {a.what}</span><time className="tnum">{fdatetime(a.at)}</time></li>)}</ul> : <Empty icon="history" title={t("audit.none")} />}
      </section>
    </>
  );
}

/* ───────── Platform inbox: support conversations from businesses ───────── */
export function AdminInbox() {
  const t = useT();
  const { db } = useStore();
  const tickets = []; // support conversations arrive from the business inbox API
  return (
    <>
      <PageHead title={t("nav.inbox")} sub={t("ainbox.sub")} />
      {!tickets.length && <section className="card pf-panel"><Empty icon="inbox" title="No support messages yet">Messages from businesses show here.</Empty></section>}
      {!!tickets.length && <section className="card pf-panel"><ul className="pf-list">{tickets.map(([tid, msg, tone, at]) => {
        const x = db.tenants.find((y) => y.id === tid);
        return <li key={tid}><TenantName r={x} /><div><span>{msg}</span><span className="small muted tnum">{fdatetime(at)}</span></div><Badge tone={tone}>{t(`ainbox.${tone}`)}</Badge><Link to={`/admin/tenants/${tid}`} className="btn btn-outline btn-sm">{t("common.open")}</Link></li>;
      })}</ul></section>}
    </>
  );
}
