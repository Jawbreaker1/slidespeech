import assert from "node:assert/strict";
import test from "node:test";
import { sourceImageDownloadUrl } from "../packages/providers/src/generation-v2/slide-image-provider";

import {
  extractGenerationDocumentLinks,
  extractGenerationDocumentText,
  parseGenerationSearchRss,
  parseGenerationDocument,
  readBoundedResearchText,
  HostedGenerationResearchProvider,
} from "../packages/providers/src/generation-v2";

test("evidence preserves source groups and table relationships without guessing visual associations", () => {
  const grouped = parseGenerationDocument('<section><div><h3>Alex</h3><p>Designer</p></div><div><h3>Sam</h3><p>Engineer</p></div></section>', "https://example.test");
  assert.equal(grouped.content, '<section><div><h3>Alex</h3>\n\n<p>Designer</p></div>\n\n<div><h3>Sam</h3>\n\n<p>Engineer</p></div></section>');
  const ambiguous = parseGenerationDocument('<div><p>Designer</p><h3>Alex</h3><p>Engineer</p><h3>Sam</h3></div>', "https://example.test");
  assert.equal(ambiguous.content, '<div><p>Designer</p>\n\n<h3>Alex</h3>\n\n<p>Engineer</p>\n\n<h3>Sam</h3></div>');
  const table = parseGenerationDocument('<table><tr><th>År</th><th>Värde</th></tr><tr><td>2024</td><td>12 &lt; 15</td></tr></table>', "https://example.test");
  assert.ok(table.content.includes('<tr><th>År</th>\n\n<th>Värde</th></tr>'));
  assert.ok(table.content.includes('<tr><td>2024</td>\n\n<td>12 &lt; 15</td></tr>'));
  assert.ok(!ambiguous.content.includes('<h3>Alex</h3>\n<p>Designer'));
});

test("responsive source variants preserve exact URLs and choose resolution without publisher rules", () => {
  const parsed = parseGenerationDocument('<img src="small.jpg" width="200" srcset="medium.jpg 1.5x, large.jpg 2x"><img src="other.jpg" srcset="alternate.jpg 1200w">', "https://example.test/article");
  const [first, second] = parsed.imageDiscovery.candidates;
  assert.equal(first!.url, "https://example.test/small.jpg");
  assert.equal(sourceImageDownloadUrl(first!), "https://example.test/large.jpg");
  assert.equal(sourceImageDownloadUrl(second!), "https://example.test/alternate.jpg");
  assert.equal(parseGenerationDocument('<img src="ordinary.jpg" srcset="bad.jpg -2x">', "https://example.test").imageDiscovery.candidates[0]!.responsiveVariants, undefined);
});

test("image discovery preserves source metadata without deciding relevance or parsing attributes by strings", () => {
  const result = parseGenerationDocument(`
    <head><base href="https://cdn.example.test/assets/"><meta property="og:image" content="photo.jpg"></head>
    <body><h1>Å, ä and ö &amp; more</h1>
    <figure><img src="photo.jpg" alt="A &gt; B &amp; C" width="1200" height="800"><figcaption>Image by <b>Alex</b> &copy; 2026</figcaption></figure>
    <img src="logo.svg" alt="Publisher logo"><img src="tiny.gif" width="1" height="1">
    <script>const x = '<img src="invented.jpg">';</script><template><img src="template.jpg"></template>
    <img src="javascript:alert(1)"><img src="data:image/png;base64,anything"><img src="https://secret@other.test/private.jpg">
    <a href="guide?x=1&amp;y=2" title="a > b">Actual <em>link</em></a></body>`, "https://example.test/article");
  assert.equal(result.imageDiscovery.totalCandidates, 3);
  assert.equal(result.imageDiscovery.truncated, false);
  assert.deepEqual(result.imageDiscovery.candidates[0], {
    url: "https://cdn.example.test/assets/photo.jpg", discoveredVia: "img", alt: "A > B & C",
    caption: "Image by Alex © 2026", declaredWidth: 1200, declaredHeight: 800,
  });
  assert.equal(result.imageDiscovery.candidates[1]?.alt, "Publisher logo");
  assert.equal(result.imageDiscovery.candidates[2]?.declaredWidth, 1);
  assert.equal(result.links[0]?.url, "https://cdn.example.test/assets/guide?x=1&y=2");
  assert.equal(result.links[0]?.text, "Actual link");
  assert.ok(result.content.includes("<h1>Å, ä and ö &amp; more</h1>"));
  assert.ok(!result.content.includes("invented.jpg"));
});

test("discovery reports resource truncation and does not invent absent images or dimensions", () => {
  const result = parseGenerationDocument('<meta name="twitter:image" content="//example.test/one.png"><img src="two.jpg" width="100%"><img src="two.jpg">', "https://example.test/article", 1);
  assert.deepEqual(result.imageDiscovery, { candidates: [{ url: "https://example.test/one.png", discoveredVia: "twitter" }], totalCandidates: 2, truncated: true });
  assert.deepEqual(parseGenerationDocument("<p>Text only</p>", "https://example.test").imageDiscovery, { candidates: [], totalCandidates: 0, truncated: false });
  assert.throws(() => parseGenerationDocument("", "https://example.test", 0));
});

test("inert markup cannot replace the document base or title", () => {
  const result = parseGenerationDocument('<template><base href="https://unrelated.test/"><title>Not the title</title><img src="hidden.jpg"></template><title>Actual title</title><img src="photo.jpg">', "https://example.test/article/");
  assert.equal(result.title, "Actual title");
  assert.equal(result.imageDiscovery.candidates[0]?.url, "https://example.test/article/photo.jpg");
});

test("deep markup stays traversable and captions belong to the nearest figure", () => {
  const deep = '<div>'.repeat(10_000) + '<img src="deep.jpg">Text' + '</div>'.repeat(10_000);
  const result = parseGenerationDocument('<!doctype html>' + deep + '<figure><img src="outer.jpg"><figure><img src="inner.jpg"><figcaption>Inner caption</figcaption></figure><figcaption>Outer caption</figcaption></figure>', "https://example.test/");
  assert.equal(result.imageDiscovery.candidates[0]?.url, "https://example.test/deep.jpg");
  assert.equal(result.imageDiscovery.candidates[1]?.caption, "Outer caption");
  assert.equal(result.imageDiscovery.candidates[2]?.caption, "Inner caption");
});

test("a quoted closing bracket and inline markup do not corrupt source text or relative links", () => {
  const result = parseGenerationDocument('<title>A &amp; B</title><p title="x > y">A<em>B</em>C</p><p>Next</p><a href="/x?condition=a%3Eb" title="x > y">Go</a>', "https://example.test");
  assert.equal(result.title, "A & B");
  assert.equal(result.content, "A &amp; B\n<p>ABC</p>\n\n<p>Next</p>\nGo");
  assert.equal(result.links[0]?.url, "https://example.test/x?condition=a%3Eb");
});

test("research response limit counts decoded bytes, cancels oversized streams and preserves split UTF-8", async () => {
  const bytes = new TextEncoder().encode("åäö");
  const stream = () => new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, 1)); controller.enqueue(bytes.slice(1)); controller.close();
  } });
  assert.equal(await readBoundedResearchText(new Response(stream()), 6), "åäö");
  let cancelled = false;
  const oversize = new ReadableStream({ start(controller) { controller.enqueue(bytes); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedResearchText(new Response(oversize), 5), /exceeds/);
  assert.equal(cancelled, true);
});

test("the hosted adapter returns discovery without fetching candidate URLs", async (t) => {
  const pageUrl = "https://93.184.216.34/article";
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    calls.push(url.href);
    const response = new Response('<html><head><title>Page</title></head><body><p>Source material.</p><img src="https://cdn.example.test/asset.jpg" alt="Unverified description"></body></html>', { headers: { "Content-Type": "text/html" } });
    Object.defineProperty(response, "url", { value: pageUrl });
    return response;
  });
  const page = await new HostedGenerationResearchProvider().fetch(pageUrl);
  assert.deepEqual(calls, [pageUrl]);
  assert.equal(page.url, pageUrl);
  assert.equal(page.contentFormat, "rendered-layout");
  assert.ok(page.content.includes('"text":"Source material."'));
  assert.deepEqual(page.imageDiscovery?.candidates, [{ url: "https://cdn.example.test/asset.jpg", discoveredVia: "img", alt: "Unverified description" }]);
});

test("V2 research text extraction removes markup and non-content elements", () => {
  const text = extractGenerationDocumentText(`
    <html>
      <head><title>Hidden title</title><style>.x { color: red; }</style></head>
      <body>
        <nav>Navigation remains transport text until fact curation.</nav>
        <main><h1>Useful heading</h1><p>Useful &amp; grounded content.</p></main>
        <script>inventedScriptValue()</script>
      </body>
    </html>
  `);

  assert.match(text, /Useful heading Useful & grounded content/);
  assert.doesNotMatch(text, /Hidden title|color: red|inventedScriptValue/);
});

test("V2 link extraction preserves real absolute same-page candidates", () => {
  const links = extractGenerationDocumentLinks(
    `
      <main>
        <a href="chapter-one.html">Chapter one</a>
        <a href='/guide?part=2#section'><strong>Guide part two</strong></a>
        <a href="mailto:test@example.com">Email</a>
        <article>Not an anchor</article>
      </main>
    `,
    "https://docs.example.com/book/index.html",
  );

  assert.deepEqual(links, [
    {
      url: "https://docs.example.com/book/chapter-one.html",
      text: "Chapter one",
    },
    {
      url: "https://docs.example.com/guide?part=2",
      text: "Guide part two",
    },
  ]);
});

test("V2 search parsing preserves provider order without semantic ranking", () => {
  const results = parseGenerationSearchRss(`
    <rss><channel>
      <item>
        <title><![CDATA[First result]]></title>
        <link>https://example.com/first</link>
        <description><![CDATA[First <b>snippet</b>.]]></description>
      </item>
      <item>
        <title>Second result</title>
        <link>https://example.org/second</link>
        <description>Second snippet.</description>
      </item>
    </channel></rss>
  `);

  assert.deepEqual(
    results.map((result) => result.title),
    ["First result", "Second result"],
  );
  assert.equal(results[0]?.snippet, "First snippet.");
});
