// Cleans HTML that people write (blog posts, listing descriptions) before it is shown on the website.
// Where it fits: used when blog posts and listings are saved.
// How it works: only an allowlist of formatting tags and safe attributes survives; links must be http(s), mailto or
// tel; images http(s) or a site path.
// Rules: scripts, styles, frames, forms, event handlers and unknown tags are always dropped.

const TAGS = new Set(["p", "br", "b", "strong", "i", "em", "u", "s", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "hr", "span", "figure", "figcaption"]);
const VOID = new Set(["br", "img", "hr"]);
const ATTRS: Record<string, string[]> = { a: ["href", "title"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"] };

const safeUrl = (tag: string, v: string) => {
  const u = v.trim();
  if (tag === "a") return /^(https?:|mailto:|tel:|\/|#)/i.test(u) ? u : null;
  return /^(https?:\/\/|\/)/i.test(u) ? u : null;
};
const escAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function rebuild(raw: string): string {
  const m = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(raw);
  if (!m) return "";
  const [, closing, nameRaw, rest] = m;
  const name = nameRaw!.toLowerCase();
  if (!TAGS.has(name)) return "";
  if (closing) return VOID.has(name) ? "" : `</${name}>`;
  const keep: string[] = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let a: RegExpExecArray | null;
  while ((a = re.exec(rest!))) {
    const attr = a[1]!.toLowerCase();
    if (!(ATTRS[name] ?? []).includes(attr)) continue;
    let val = (a[3] ?? a[4] ?? a[5] ?? "").replace(/&#x?[0-9a-f]+;?|&colon;|&tab;|&newline;/gi, "");
    if (attr === "href" || attr === "src") { const ok = safeUrl(name, val); if (!ok) continue; val = ok; }
    if ((attr === "width" || attr === "height" || attr === "colspan" || attr === "rowspan") && !/^\d{1,4}$/.test(val)) continue;
    keep.push(`${attr}="${escAttr(val)}"`);
  }
  if (name === "a" && keep.some((k) => k.startsWith('href="http'))) keep.push('rel="noopener nofollow ugc"', 'target="_blank"');
  return `<${name}${keep.length ? ` ${keep.join(" ")}` : ""}>`;
}

export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|form|textarea|select|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi, "")
    // A "<" that doesn't open a tag ("2 < 3") is text.
    .replace(/<(?![a-zA-Z/])/g, "&lt;")
    .replace(/<[^<>]*>/g, rebuild)
    // Anything still looking like the start of a tag never closed; the browser would treat it as one.
    .replace(/<(?![a-z][a-z0-9]*[^<>]*>|\/[a-z][a-z0-9]*>)/gi, "&lt;")
    .replace(/(<p>\s*(<br>)?\s*<\/p>\s*)+/g, "")
    .trim();
}

/** Plain text from HTML (excerpts, search). */
export const htmlText = (html: string | null | undefined) => (html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
