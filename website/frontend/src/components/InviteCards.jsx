// Cards shaped like real listings that invite owners to post one, shown before anything of that kind is posted.
// How it works: each opens the plans for that business type, where Starter is free with one listing.

import { Link, useNavigate } from "react-router-dom";
import { Hotel, TreePalm, House, Home, Building, Trees, Store, MapPin, ArrowRight } from "lucide-react";

const INVITE = {
  stay: { note: "Hotels and hosts list rooms and homes to book by the night.", cards: [
    [Hotel, "Your hotel here", "Rooms by the night, paid online", "hotel"],
    [TreePalm, "Your resort here", "Packages, rooms and meals", "hotel"],
    [House, "Your villa here", "Whole homes for families and groups", "host"],
    [Home, "Your homestay here", "Stay with a local family", "host"],
  ] },
  project: { note: "Developers list their projects with units, prices and progress.", cards: [
    [Building, "Your apartment building here", "Units, floor plans and price list", "developer"],
    [Trees, "Your colony here", "Plots and houses in one place", "developer"],
    [House, "Your villa project here", "Villas with progress updates", "developer"],
    [Store, "Your commercial complex here", "Shops and offices for sale or lease", "developer"],
  ] },
  invest: { note: "Approved sponsors raise money for real projects. Returns are never guaranteed.", cards: [
    [Hotel, "Your hotel project here", "Raise money from many small investors", "sponsor"],
    [House, "Your villa project here", "Share the project, share the returns", "sponsor"],
    [Trees, "Your colony project here", "Fund land development together", "sponsor"],
    [Store, "Your commercial project here", "Shops, offices and markets", "sponsor"],
  ] },
};

export function InviteCards({ kind, compact = false }) {
  const nav = useNavigate();
  const { note, cards } = INVITE[kind];
  return (
    <div className="stack" style={{ gap: 16 }}>
      {!compact && <p className="muted" style={{ margin: 0 }}>Nothing is listed here yet. {note}</p>}
      <div className="grid-cards">{cards.map(([I, title, sub, type]) => {
        const to = `/plans?type=${type}`;
        return (
          <article key={title} className="pcard pcard-invite" onClick={() => nav(to)}>
            <div className="pcard-media"><I size={46} strokeWidth={1.4} aria-hidden="true" /><div className="pcard-top"><span className="tag tag-red">Free to start</span></div></div>
            <div className="pcard-body">
              <Link to={to} className="pcard-title" onClick={(e) => e.stopPropagation()}>{title}</Link>
              <span className="pcard-loc"><MapPin size={13} />Anywhere in Nepal</span>
              <span className="small muted">{sub}</span>
              <span className="pcard-price row" style={{ gap: 6 }}>Post for review <ArrowRight size={15} /></span>
            </div>
          </article>
        );
      })}</div>
    </div>
  );
}
