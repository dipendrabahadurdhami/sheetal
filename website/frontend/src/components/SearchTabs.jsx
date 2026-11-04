// Tabs at the top of search pages: All, Buy, Rent, Stay, Projects and Invest, like the home search.
// How it works: the tab that is on follows the address: /search alone is All; /search with Buy or Rent picked (or
// /sale, /rent) is Buy or Rent; the other tabs have their own pages. A place typed in the search is kept when switching.

import { Link, useLocation } from "react-router-dom";

const purpose = (q) => q.get("advertisement_purpose") || "";
export const SEARCH_TABS = [
  ["/search", "All", (p, q) => p === "/search" && !purpose(q)],
  ["/sale", "Buy", (p, q) => p === "/sale" || (p === "/search" && purpose(q) === "sale")],
  ["/rent", "Rent", (p, q) => p === "/rent" || (p === "/search" && purpose(q) === "rent")],
  ["/stays", "Stay", (p) => p === "/stays"],
  ["/project", "Projects", (p) => p === "/project"],
  ["/investment", "Invest", (p) => /^\/investment(\/explore)?$/.test(p)],
];

export function SearchTabs() {
  const { pathname, search } = useLocation();
  const q = new URLSearchParams(search);
  const where = q.get("keyword") || q.get("where") || q.get("city") || "";
  const keep = (to) => (where ? `${to}?${to === "/stays" ? "where" : "keyword"}=${encodeURIComponent(where)}` : to);
  return (
    <div className="search-tabs-row">
      <nav className="hx-tabs" role="tablist" aria-label="What are you looking for">
        {SEARCH_TABS.map(([to, label, is]) => { const on = is(pathname, q); return <Link key={to} to={keep(to)} role="tab" aria-selected={on} className={on ? "on" : ""}>{label}</Link>; })}
      </nav>
    </div>
  );
}
