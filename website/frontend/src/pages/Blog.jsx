import { clean } from "../utils/sanitize";
import { useSEO } from "../utils/seo";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Clock, CalendarDays, MessageCircle, Facebook, Link2 } from "lucide-react";
import { api } from "../api/endpoints";
import { toItem, toList } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useApp } from "../context/AppContext";
import { PageHead, Pagination, Empty } from "../components/ui";
import { fmtDate, imgUrl, stripHtml } from "../utils/format";
import { adminPosts } from "../utils/content";

const PostCard = ({ b, big }) => (
  <Link to={`/blog/${b.slug}`} className="post-card fade-in" style={big ? { gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 32, alignItems: "center" } : undefined}>
    <div className="media" style={big ? { aspectRatio: "16/9" } : undefined}><img src={imgUrl(b.thumbnail || b.featured_image || b.image)} alt="" loading="lazy" /></div>
    <div className="stack" style={{ gap: 10 }}>
      <span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".12em" }}>{b.category?.name || "Journal"} · {fmtDate(b.published_at || b.created_at)}</span>
      <h3 style={big ? { fontSize: "clamp(24px, 3vw, 34px)" } : undefined}>{b.title}</h3>
      {(big || b.excerpt) && <p className="muted small">{String(b.excerpt || stripHtml(b.content).slice(0, 160) || "").replace(/[*_#`]+/g, "")}</p>}
    </div>
  </Link>
);

export function Blog() {
  const { slug } = useParams();
  useSEO(slug ? "Blog: " + slug.replace(/-/g, " ") : "Blog", "Real estate news, guides and market updates for Nepal.");
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const cats = useAsync(() => api.blogCategories().then(toList), []);
  const { data, loading } = useAsync(() => (slug ? api.blogCategory(slug, page) : api.blogs(page, 12)).then(toList), [slug, page]);
  // posts written in Admin → Content come first on the first page
  const own = !slug && page === 1 ? adminPosts() : [];
  const items = [...own, ...(data?.items || []).filter((x) => !own.some((o) => o.slug === x.slug))];
  const cat = cats.data?.items?.find((c) => c.slug === slug);
  return (
    <>
      <div className="tools-hero journal-hero"><PageHead crumbs={[{ label: "Journal", to: slug ? "/blog" : undefined }, ...(cat ? [{ label: cat.name }] : [])]} kicker="Journal" title={cat ? cat.name : "Blog"}>
        News and guides on property in Nepal.
      </PageHead></div>
      <div className="container" style={{ paddingTop: 24 }}>
        <div className="row-wrap" style={{ gap: 8, marginBottom: 36 }}>
          <Link to="/blog" className={`chip ${!slug ? "active" : ""}`}>All</Link>
          {(cats.data?.items || []).map((c) => <Link key={c.id || c.slug} to={`/blog/category/${c.slug}`} className={`chip ${slug === c.slug ? "active" : ""}`}>{c.name}</Link>)}
        </div>
        {loading && !own.length ? <div className="grid-3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk" style={{ height: 300, borderRadius: "var(--r-md)" }} />)}</div>
          : !items.length ? <Empty title="No articles yet" />
          : <div className="grid-3" style={{ rowGap: 48 }}>{items.map((b, i) => <PostCard key={b.id} b={b} />)}</div>}
        <Pagination page={page} last={data?.last} onChange={(n) => setParams({ page: n })} />
      </div>
    </>
  );
}

export function BlogPost() {
  const { slug } = useParams();
  const { toast } = useApp();
  const { data: res, loading, error } = useAsync(() => api.blog(slug), [slug]);
  const [c, setC] = useState({ name: "", email: "", comment: "" });
  const own = adminPosts().find((x) => x.slug === slug);
  const b = own || toItem(res);
  useSEO(b?.title || "Article", b?.meta_description || b?.excerpt || undefined, { type: "article" });
  const latest = useAsync(() => api.blogs(1, 8).then(toList), []);
  const related = (res?.related || []).slice(0, 4);
  const seen = new Set([b?.id, ...related.map((x) => x.id)]);
  const recommended = (latest.data?.items || []).filter((x) => !seen.has(x.id)).slice(0, 4);
  if (!own && loading) return <div className="container detail-layout"><div className="stack"><div className="sk" style={{ height: 50 }} /><div className="sk" style={{ height: 380 }} /></div><div className="sk" style={{ height: 300 }} /></div>;
  if (!own && (error || !b?.title)) return <div className="container"><Empty title="Article not found"><Link to="/blog">Back to the blog</Link></Empty></div>;
  // drop a heading at the top of the body that just repeats the title
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const html = String(b.content || b.description || "").replace(/^\s*<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i, (m, inner) => (norm(stripHtml(inner)) === norm(b.title) ? "" : m));
  const url = typeof window !== "undefined" ? window.location.href : "";
  const share = [
    ["WhatsApp", MessageCircle, `https://wa.me/?text=${encodeURIComponent(b.title + " " + url)}`],
    ["Facebook", Facebook, `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`],
  ];
  return (
    <article className="container detail-layout blog-detail">
      <div className="stack" style={{ gap: 24, minWidth: 0 }}>
        <div className="stack" style={{ gap: 10 }}>
          <div className="crumbs" style={{ display: "flex" }}><Link to="/">Home</Link><span>/</span><Link to="/blog">Journal</Link>{b.category?.name ? <><span>/</span><span>{b.category.name}</span></> : null}</div>
          <h1 className="blog-title">{b.title}</h1>
          <div className="row-wrap small muted" style={{ gap: 14 }}>
            {b.category?.name && <span className="tag tag-soft">{b.category.name}</span>}
            <span className="row" style={{ gap: 6 }}><CalendarDays size={14} />{fmtDate(b.published_at || b.created_at)}</span>
            {b.read_time ? <span className="row" style={{ gap: 6 }}><Clock size={14} />{b.read_time} min read</span> : null}
          </div>
        </div>
        {imgUrl(b.thumbnail || b.featured_image || b.image) && <div className="blog-cover"><img src={imgUrl(b.thumbnail || b.featured_image || b.image)} alt="" /></div>}
        <div className="prose blog-body" dangerouslySetInnerHTML={{ __html: clean(html) }} />
        {b.tags?.length > 0 && <div className="row-wrap" style={{ gap: 8 }}>{b.tags.map((x) => <span key={x.slug || x.name} className="tag tag-line">{x.name}</span>)}</div>}
      </div>

      <aside className="stack blog-side" style={{ gap: 16 }}>
        <div className="card card-pad stack" style={{ gap: 12 }}>
          <span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".12em" }}>Share this article</span>
          <div className="row" style={{ gap: 8 }}>
            {share.map(([l, I, href]) => <a key={l} href={href} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{ flex: 1 }}><I size={15} />{l}</a>)}
            <button className="btn btn-outline btn-sm btn-icon" title="Copy link" onClick={() => { navigator.clipboard?.writeText(url); toast("Link copied"); }}><Link2 size={15} /></button>
          </div>
        </div>
        <form className="card card-pad stack" style={{ gap: 14 }} onSubmit={async (e) => { e.preventDefault(); try { const r = await api.blogComment(b.id, c); toast(r?.message || "Comment sent for review"); setC({ name: "", email: "", comment: "" }); } catch (x) { toast(x.message); } }}>
          <h4>Leave a comment</h4>
          <div className="stack" style={{ gap: 10 }}><input className="input" placeholder="Name" required value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} /><input className="input" type="email" placeholder="Email" required value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
          <textarea className="textarea" style={{ minHeight: 96 }} placeholder="Your comment" required value={c.comment} onChange={(e) => setC({ ...c, comment: e.target.value })} />
          <button className="btn btn-primary btn-block btn-sm">Post comment</button>
        </form>
        {related.length > 0 && (
          <div className="card card-pad stack" style={{ gap: 4 }}>
            <h4 style={{ marginBottom: 8 }}>Related articles</h4>
            {related.map((r) => (
              <Link key={r.id} to={`/blog/${r.slug}`} className="blog-rel">
                <img src={imgUrl(r.thumbnail || r.featured_image || r.image)} alt="" loading="lazy" />
                <span className="stack" style={{ gap: 2, minWidth: 0 }}><b>{r.title}</b><span className="tiny muted">{fmtDate(r.published_at || r.created_at)}</span></span>
              </Link>
            ))}
          </div>
        )}
        {recommended.length > 0 && (
          <div className="card card-pad stack" style={{ gap: 4 }}>
            <h4 style={{ marginBottom: 8 }}>Recommended</h4>
            {recommended.map((r) => (
              <Link key={r.id} to={`/blog/${r.slug}`} className="blog-rel">
                <img src={imgUrl(r.thumbnail || r.featured_image || r.image)} alt="" loading="lazy" />
                <span className="stack" style={{ gap: 2, minWidth: 0 }}><b>{r.title}</b><span className="tiny muted">{fmtDate(r.published_at || r.created_at)}</span></span>
              </Link>
            ))}
          </div>
        )}
      </aside>
    </article>
  );
}
