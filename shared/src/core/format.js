const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Now, in the viewer's local time ("YYYY-MM-DDTHH:mm:ss"), read once when the app loads.
export const TODAY = (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); })();

export const rs = (n) => "Rs. " + Math.round(Number(n) || 0).toLocaleString("en-IN");
export const rsShort = (n) => {
  n = Number(n) || 0;
  if (n >= 1e7) return `Rs. ${+(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `Rs. ${+(n / 1e5).toFixed(2)} Lakh`;
  return rs(n);
};
export const fdate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
};
export const fdatetime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${fdate(iso)}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
export const daysFromToday = (iso) => Math.round((new Date(iso) - new Date(TODAY)) / 864e5);
/** A date `n` days from today, as YYYY-MM-DD. */
export const inDays = (n) => { const d = new Date(`${TODAY.slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
export const limitText = (n) => (n === -1 ? "∞" : Number(n).toLocaleString("en-IN"));
