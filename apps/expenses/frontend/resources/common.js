// Small shared pieces of the Expenses screens: payment method names, limits, month names, the receipt requests.
// Where it fits: apps/expenses/frontend. Used by the expense, recurring and profit resource files and by ExpensesPage.
// How it works: plain data and plain functions with no React in them, so tests can load them without a browser. Texts are the English ones the old page used.
// Rules: the amount limits are the server's (1 to 2,000,000,000 whole rupees); the receipt limit is 8 MB; a receipt is photo or PDF only.

export const METHOD = { cash: "Cash", bank: "Bank transfer", fonepay: "Fonepay", esewa: "eSewa", khalti: "Khalti", card: "Card", other: "Other" };
export const METHOD_OPTIONS = Object.entries(METHOD).map(([id, label]) => ({ id, label }));
export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 2_000_000_000;
export const RECEIPT_MB = 8;
export const RECEIPT_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
/** "Other" needs this many letters of explanation. */
export const OTHER_NOTE_MIN = 3;

/** "2026-11" → "Nov 2026". Any month works; text that is not a month comes back as it was. */
export function monthLabel(id) {
  const m = /^(\d{4})-(\d{2})$/.exec(id || "");
  if (!m) return id || "";
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** The English name of a category id, or the id itself when the list does not have it. */
export const categoryName = (categories, id) => (categories || []).find((c) => c.id === id)?.en || id;

/** "Vendor · note", or the fallback (the expense number, the branch) when both are empty. */
export const detailLine = (r, fallback) => [r.vendor, r.note].filter(Boolean).join(" · ") || fallback;

const readBase64 = (file) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(",")[1] || "");
  r.onerror = () => fail(new Error("Couldn't read that file."));
  r.readAsDataURL(file);
});

/** Receipt requests (the server keeps the file private; these are the only ways in). */
export const receipt = {
  upload: async (id, file, api) => api("POST", `/expenses/${id}/receipt`, { data: await readBase64(file) }),
  remove: (id, api) => api("DELETE", `/expenses/${id}/receipt`),
  /** Fetch the file and open it in a new tab. Returns nothing, so no toast is shown.
   *  The tab is opened BEFORE the request (still inside the tap): phone browsers (Safari above all) block a tab opened after an
   *  await. It is filled in when the file arrives, and closed again if the request fails. The file's address is freed after a minute. */
  async open(row, api) {
    const tab = typeof window !== "undefined" ? window.open("", "_blank") : null;
    try {
      const { data: f } = await api("GET", `/expenses/${row.id}/receipt`);
      const bin = atob(f.data), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: f.type }));
      if (tab) { tab.opener = null; tab.location.href = url; } else window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      throw e;
    }
  },
};
