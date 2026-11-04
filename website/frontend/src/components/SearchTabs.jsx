// Tabs at the top of search pages: Buy, Rent, Stay, Projects and Invest, like the home search.

import { Link, useLocation } from "react-router-dom";

export const SEARCH_TABS = [["/sale", "Buy", /^\/(sale|search)$/], ["/rent", "Rent", /^\/rent$/], ["/stays", "Stay", /^\/stays$/], ["/project", "Projects", /^\/project$/], ["/investment", "Invest", /^\/investment(\/explore)?$/]];

export function SearchTabs() {
  const { pathname, search } = useLocation();
  const q = new URLSearchParams(search);
  const where = q.get("keyword") || q.get("where") || q.get("city") || "";
  const keep = (to) => (where ? `${to}?${to === "/stays" ? "where" : "keyword"}=${encodeURIComponent(where)}` : to);
  return (
    <div className="search-tabs-row">
      <nav className="hx-tabs" role="tablist" aria-label="What are you looking for">
        {SEARCH_TABS.map(([to, label, re]) => { const on = re.test(pathname); return <Link key={to} to={keep(to)} role="tab" aria-selected={on} className={on ? "on" : ""}>{label}</Link>; })}
      </nav>
    </div>
  );
}
