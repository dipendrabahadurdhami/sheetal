// Cleans HTML in agency, blog and job text before showing it: removes scripts, event handlers and unsafe links.

import DOMPurify from "dompurify";

export const clean = (html) => DOMPurify.sanitize(String(html || ""), { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input"], FORBID_ATTR: ["style"] });
