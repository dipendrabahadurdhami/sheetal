// The phone search box at the top of every results page: Buy, Rent, All (pages/Listings.jsx) and Stays, Projects,
// Invest (pages/Catalog.jsx). One piece, so all of them look and behave the same.
// How it works: type and press Enter (or the phone's search key) to search this page; the ✕ clears it. The word is
// kept in the address (?keyword=…), so it survives going back and sharing a link.

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";

const HINT = {
  rent: "Search places for rent: area, type…", sale: "Search for sale: area, type…", search: "Search area, type, keyword…",
  stay: "Search stays: place, hotel, homestay…", project: "Search projects: name, area, type…", invest: "Search investments: name, city, type…",
};

export function ResultsSearch({ kind, value, onSearch }) {
  const [word, setWord] = useState(value || "");
  useEffect(() => { setWord(value || ""); }, [value]);
  const hint = HINT[kind] || HINT.search;
  return (
    <form className="pa-pill pa-list-search" role="search" onSubmit={(e) => { e.preventDefault(); onSearch(word.trim()); e.currentTarget.querySelector("input")?.blur(); }}>
      <Search size={20} aria-hidden="true" />
      <input value={word} onChange={(e) => setWord(e.target.value)} enterKeyHint="search" aria-label={hint.split(":")[0]} placeholder={hint} />
      {word && <button type="button" className="pa-ib" aria-label="Clear the search" onClick={() => { setWord(""); if (value) onSearch(""); }}><X size={18} /></button>}
    </form>
  );
}
