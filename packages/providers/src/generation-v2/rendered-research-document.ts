import { chromium } from "playwright";
import { assertPublicResearchUrl, fetchPublicResearch, readBoundedResearchBytes } from "./public-research-transport";

export interface RenderedResearchDocument {
  content: string;
  truncated: boolean;
}

// Render the already acquired response, not a second, potentially different page.
// All external resources go through the same public-address transport as research.
export async function renderResearchDocument(input: {
  html: string;
  url: string;
  maximumCharacters: number;
  signal?: AbortSignal | undefined;
}): Promise<RenderedResearchDocument> {
  const documentUrl = assertPublicResearchUrl(input.url);
  documentUrl.hash = "";
  const signal = AbortSignal.any([AbortSignal.timeout(25_000), ...(input.signal ? [input.signal] : [])]);
  signal.throwIfAborted();
  const browser = await chromium.launch({ headless: true, timeout: 10_000 });
  const stop = () => { void browser.close().catch(() => undefined); };
  signal.addEventListener("abort", stop, { once: true });
  let resourceCount = 0;
  let resourceBytes = 0;
  let resourceLimitExceeded = false;
  const failures: Array<{ type: string; url: string; message: string }> = [];
  try {
    signal.throwIfAborted();
    const context = await browser.newContext({
      javaScriptEnabled: false, serviceWorkers: "block", acceptDownloads: false, offline: true,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && request.url() === documentUrl.href) {
        await route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: input.html,
          headers: { "X-DNS-Prefetch-Control": "off",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline' http: https:; font-src http: https: data:; form-action 'none'" },
        });
        return;
      }
      if (!["stylesheet", "font"].includes(request.resourceType()) || request.method() !== "GET") {
        await route.abort();
        return;
      }
      try {
        if (++resourceCount > 60) { resourceLimitExceeded = true; throw new Error("Rendered research resource count exceeded."); }
        const response = await fetchPublicResearch(request.url(), { signal, timeoutMs: 8_000 });
        if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
        const body = await readBoundedResearchBytes(response, 2 * 1024 * 1024);
        resourceBytes += body.length;
        if (resourceBytes > 8 * 1024 * 1024) { resourceLimitExceeded = true; throw new Error("Rendered research resource bytes exceeded."); }
        await route.fulfill({ status: 200, body, contentType: response.headers.get("content-type") ?? "application/octet-stream" });
      } catch (error) {
        failures.push({ type: request.resourceType(), url: request.url(), message: (error as Error).message });
        await route.abort().catch(() => undefined);
      }
    });
    await page.goto(documentUrl.href, { waitUntil: "load", timeout: 20_000 });
    await page.evaluate(async () => { await document.fonts.ready; });
    signal.throwIfAborted();
    if (resourceLimitExceeded) throw new Error("Rendered research resource budget exceeded.");
    const missingStyles = failures.filter((failure) => failure.type === "stylesheet");
    if (missingStyles.length) throw new Error(`Rendered source resources unavailable: ${missingStyles.slice(0, 3).map((failure) => `${failure.url}: ${failure.message}`).join("; ")}`);
    // CSS defines spatial relationships. Missing fonts still produce measured
    // browser layout, but its typography must not be presented as an exact replica.
    const missingFonts = failures.filter((failure) => failure.type === "font").length;
    const blocks = await page.evaluate(() => {
      const groups = new Map<Node, { element: Element; nodes: Node[] }>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.nodeType !== Node.TEXT_NODE && node.nodeName !== "BR") continue;
        const parent = node.parentElement;
        if (!parent || parent.closest("script,style,noscript,template") || !parent.checkVisibility({ checkVisibilityCSS: true })) continue;
        const block = parent.closest("h1,h2,h3,h4,h5,h6,p,li,dt,dd,figcaption,blockquote,td,th,caption,button");
        if (!block && !node.textContent?.trim()) continue;
        // Loose text must not absorb its parent's other, separately laid-out children.
        const key = block ?? node;
        const group = groups.get(key) ?? { element: block ?? parent, nodes: [] };
        group.nodes.push(node);
        groups.set(key, group);
        if (groups.size > 2_000) throw new Error("Rendered source has too many text blocks.");
      }
      return [...groups].map(([key, { element, nodes }]) => {
        const range = document.createRange();
        range.selectNodeContents(key);
        const rect = key.nodeType === Node.TEXT_NODE ? range.getBoundingClientRect() : element.getBoundingClientRect();
        return { tag: element.tagName.toLowerCase(), text: nodes.map((text) => text.nodeName === "BR" ? "\n" : text.textContent).join("").trim(), visible: element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          x: Math.round(rect.x), y: Math.round(rect.y + scrollY), width: Math.round(rect.width), height: Math.round(rect.height) };
      }).filter((block) => block.text && block.width > 0 && block.height > 0).sort((a, b) => a.y - b.y || a.x - b.x);
    });
    signal.throwIfAborted();
    if (!blocks.length) throw new Error("Rendered source contains no visible text without page scripts.");
    const header = "Static source layout (1440px viewport; scripts and media disabled). Coordinates are measured CSS pixels, not inferred semantic relationships. Each line is one laid-out text block; visible=false retains transparent blocks awaiting animation, not proof of final on-screen visibility."
      + (missingFonts ? ` ${missingFonts} font resource(s) unavailable; browser substitute fonts were used where needed. Text wrapping and glyph appearance may differ from the intended typography; do not infer meaning from missing icons or exact line breaks.` : "") + "\n";
    const lines: string[] = [];
    let size = header.length;
    for (const block of blocks) {
      const line = JSON.stringify(block);
      if (line.length > 10_000 || size + line.length + 1 > input.maximumCharacters) break;
      lines.push(line);
      size += line.length + 1;
    }
    if (!lines.length) throw new Error("Rendered source text block exceeds the document budget.");
    return { content: header + lines.join("\n"), truncated: lines.length < blocks.length };
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
    await browser.close();
  }
}
