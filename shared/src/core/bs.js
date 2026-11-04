// Approximate AD → BS (Bikram Sambat) dates for display.
// Rules: month lengths change every year; replace with the official calendar table (e.g. nepali-date-converter)
// before relying on it for documents.

const NEW_YEAR = { 2082: "2025-04-14", 2083: "2026-04-14", 2084: "2027-04-14", 2085: "2028-04-13" };
const LEN = [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30];
const MONTHS = ["बैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज", "कात्तिक", "मंसिर", "पुस", "माघ", "फागुन", "चैत"];

export function toBS(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10));
  const years = Object.keys(NEW_YEAR).map(Number).sort((a, b) => b - a);
  const y = years.find((yy) => new Date(NEW_YEAR[yy]) <= d);
  if (!y) return "";
  let days = Math.round((d - new Date(NEW_YEAR[y])) / 864e5);
  let m = 0;
  while (m < 12 && days >= LEN[m]) { days -= LEN[m]; m++; }
  if (m >= 12) return "";
  return `${y} ${MONTHS[m]} ${days + 1}`;
}
