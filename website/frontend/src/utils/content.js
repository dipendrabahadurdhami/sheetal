// Blog posts and page text that Admin → Content saves into the shared platform database.
import { TODAY } from "@sheetal/shared/core/format";
import { readDb } from "./platformDb";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Plain text with "## Heading" and "- list item" lines → [[tag, text]] blocks
export function textBlocks(body = "") {
  return String(body).replace(/\r\n/g, "\n").split(/\n{2,}/).flatMap((chunk) => {
    const lines = chunk.split("\n").filter((l) => l.trim());
    if (!lines.length) return [];
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return lines.map((l) => ["li", l.replace(/^\s*[-*]\s+/, "")]);
    if (/^#{1,3}\s/.test(lines[0])) return [["h2", lines[0].replace(/^#+\s*/, "")], ...(lines.length > 1 ? [["p", lines.slice(1).join(" ")]] : [])];
    return [["p", lines.join(" ")]];
  });
}

export function toHtml(body = "") {
  let out = "", ul = false;
  textBlocks(body).forEach(([tag, text]) => {
    if (tag === "li") { if (!ul) { out += "<ul>"; ul = true; } out += `<li>${esc(text)}</li>`; return; }
    if (ul) { out += "</ul>"; ul = false; }
    out += `<${tag}>${esc(text)}</${tag}>`;
  });
  return ul ? out + "</ul>" : out;
}

const DAY = TODAY.slice(0, 10);
// Posts written in Admin that are live: published, or scheduled for today or earlier
export function adminPosts() {
  return (readDb().content?.posts || []).filter((p) => !p.site && (p.status === "published" || (p.status === "scheduled" && p.date <= DAY))).map((p) => ({
    id: "db-" + p.id, slug: p.slug, title: p.title, category: p.category ? { name: p.category } : null, published_at: p.date,
    content: toHtml(p.body), excerpt: p.seoDesc || textBlocks(p.body).map((b) => b[1]).join(" ").slice(0, 160), thumbnail: p.cover || null,
  }));
}

export const adminPage = (id) => { const p = readDb().content?.pages?.[id]; return p && String(p.body || "").trim() ? p : null; };
