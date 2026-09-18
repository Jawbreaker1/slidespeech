import assert from "node:assert/strict";
import test from "node:test";
import { renderResearchDocument } from "../packages/providers/src/generation-v2/rendered-research-document";

const render = (html: string, options: { maximumCharacters?: number; signal?: AbortSignal } = {}) => renderResearchDocument({
  html, url: "https://example.test/source#section", maximumCharacters: 20_000, ...options,
});
const blocks = (content: string): Array<{ text: string; x: number; y: number; visible: boolean }> => content.split("\n").slice(1).map((line) => JSON.parse(line));

test("layout preserves CSS columns independent of DOM adjacency and language", async () => {
  const result = await render(`<style>
    main { display:grid; grid-template-columns: 300px 300px; gap:20px; }
    .left { grid-column:1; } .right { grid-column:2; }
    h3 { grid-row:1; } p { grid-row:2; }
    .waiting {opacity:0}
  </style><main><p class="right waiting">Ingenjör</p><h3 class="left">Alex</h3><p class="left">Formgivare</p><h3 class="right">Sam</h3></main>`);
  const byText = new Map(blocks(result.content).map((block) => [block.text, block]));
  assert.equal(byText.get("Alex")!.x, byText.get("Formgivare")!.x);
  assert.equal(byText.get("Sam")!.x, byText.get("Ingenjör")!.x);
  assert.notEqual(byText.get("Alex")!.x, byText.get("Ingenjör")!.x);
  assert.equal(byText.get("Ingenjör")!.visible, false);
  assert.equal(result.truncated, false);
});

test("source scripts, frames, media and hidden content cannot supply rendered evidence", async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => { requests.push(url.href); throw new Error("Unexpected network request"); });
  const result = await render(`<p>Source text.</p><p hidden>Hidden content.</p><script>document.body.innerHTML='Invented text';fetch('http://127.0.0.1/')</script><iframe src="http://127.0.0.1/"></iframe><img src="http://127.0.0.1/image"><form action="http://127.0.0.1/"><button>Send</button></form>`);
  assert.deepEqual(requests, []);
  assert.ok(result.content.includes("Source text."));
  assert.ok(!result.content.includes("Invented text"));
  assert.ok(!result.content.includes("Hidden content"));
});

test("loose text and nested lists cannot swallow other positioned blocks", async () => {
  const result = await render('Loose heading<section><h2>Section</h2><p>Separate <em>inline</em> text.<span hidden>Hidden</span></p><ul><li>Outer<ul><li>Inner</li></ul></li></ul></section>Loose footer');
  const texts = blocks(result.content).map((block) => block.text);
  assert.deepEqual(texts, ["Loose heading", "Section", "Separate inline text.", "Outer", "Inner", "Loose footer"]);
});

test("inline whitespace and explicit line breaks survive layout extraction", async () => {
  const result = await render('<p><span>First</span> <em>line</em><br><span>Second</span> <strong>line</strong></p>');
  assert.equal(blocks(result.content)[0]!.text, "First line\nSecond line");
});

test("private CSS and unavailable styles reject capture instead of inventing layout", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("Unexpected fetch"); });
  await assert.rejects(render('<link rel="stylesheet" href="http://127.0.0.1/style.css"><p>Text</p>'), /resources unavailable/);
  assert.equal(requests, 0);
  await assert.rejects(renderResearchDocument({ html: "<p>Text</p>", url: "http://127.0.0.1/", maximumCharacters: 1000 }), /Non-public/);
});

test("external CSS uses the protected transport even while browser networking is offline", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    calls.push(url.href);
    return new Response("p { margin-left: 123px; }", { headers: { "content-type": "text/css" } });
  });
  const result = await render('<link rel="stylesheet" href="https://example.test/layout.css"><p>Styled source</p>');
  assert.deepEqual(calls, ["https://example.test/layout.css"]);
  assert.equal(blocks(result.content)[0]!.x, 131);
});

test("missing fonts retain real multilingual source text and measured CSS relationships", async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    requests.push(url.href);
    return new Response("Not found", { status: 404 });
  });
  const result = await render(`<style>
    @font-face { font-family: SourceFace; src: url('https://example.test/missing.woff2'); }
    main { font-family: SourceFace, sans-serif; display:grid; grid-template-columns:300px 300px; }
    .left {grid-column:1} .right {grid-column:2} h3 {grid-row:1} p {grid-row:2}
  </style><main><p class="right">Ingenjör</p><h3 class="left">Alex</h3><p class="left">Formgivare</p><h3 class="right">Sam</h3></main>`);
  assert.deepEqual(requests, ["https://example.test/missing.woff2"]);
  assert.ok(result.content.includes("1 font resource(s) unavailable"));
  const byText = new Map(blocks(result.content).map((block) => [block.text, block]));
  assert.equal(byText.get("Alex")!.x, byText.get("Formgivare")!.x);
  assert.equal(byText.get("Sam")!.x, byText.get("Ingenjör")!.x);
  assert.notEqual(byText.get("Alex")!.x, byText.get("Ingenjör")!.x);
});

test("missing stylesheet remains fatal with the failed resource URL", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Not found", { status: 404 }));
  await assert.rejects(render('<link rel="stylesheet" href="https://example.test/missing.css"><p>Text</p>'),
    (error: Error) => error.message.includes("https://example.test/missing.css: HTTP 404"));
});

test("optional fonts cannot bypass the private-network restriction", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Must not fetch a private font"); });
  const result = await render('<style>@font-face{font-family:PrivateFace;src:url("http://127.0.0.1/font.woff2")}p{font-family:PrivateFace,sans-serif}</style><p>Visible source text</p>');
  assert.equal(calls, 0);
  assert.ok(result.content.includes("font resource(s) unavailable"));
  assert.equal(blocks(result.content)[0]?.text, "Visible source text");
});

test("rendering is cancellable and truncates only between complete blocks", async () => {
  await assert.rejects(render("<p>Text</p>", { signal: AbortSignal.abort() }), { name: "AbortError" });
  await assert.rejects(render("<p>Text</p>", { signal: AbortSignal.timeout(1) }), { name: "TimeoutError" });
  const result = await render("<p>First block.</p>" + "<p>Following block.</p>".repeat(20), { maximumCharacters: 600 });
  assert.equal(result.truncated, true);
  assert.ok(result.content.length <= 600);
  assert.ok(blocks(result.content).length > 0);
});
