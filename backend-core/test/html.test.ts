import { describe, expect, it } from "vitest";
import { sanitizeHtml } from "../src/lib/html.js";

describe("sanitizeHtml", () => {
  it("keeps formatting", () => {
    expect(sanitizeHtml('<h2>Title</h2><p>Some <b>bold</b> and <a href="https://x.test/a">a link</a>.</p><ul><li>One</li></ul>'))
      .toBe('<h2>Title</h2><p>Some <b>bold</b> and <a href="https://x.test/a" rel="noopener nofollow ugc" target="_blank">a link</a>.</p><ul><li>One</li></ul>');
  });

  it("drops scripts, handlers, styles and unsafe links", () => {
    const out = sanitizeHtml(`<p onclick="steal()" style="x">Hi</p><script>alert(1)</script><img src="javascript:alert(1)" onerror="x"><a href="javascript:alert(1)">x</a><a href="jav&#x61;script:alert(1)">y</a><iframe src="https://evil.test"></iframe><svg onload="x"><circle/></svg>`);
    expect(out).toBe('<p>Hi</p><img><a>x</a><a>y</a>');
    expect(out).not.toMatch(/script|onerror|onclick|style|iframe|svg/i);
  });

  it("escapes a stray tag opener and removes empty paragraphs", () => {
    expect(sanitizeHtml("<p>2 < 3</p><p> </p>")).toBe("<p>2 &lt; 3</p>");
  });
});
