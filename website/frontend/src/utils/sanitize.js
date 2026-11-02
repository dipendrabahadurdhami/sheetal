import DOMPurify from "dompurify";

// Agency, blog and job text can contain HTML. Strip scripts, event handlers and unsafe links before rendering.
export const clean = (html) => DOMPurify.sanitize(String(html || ""), { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input"], FORBID_ATTR: ["style"] });
