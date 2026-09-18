import { parseDocument, DomUtils } from "htmlparser2";
import { parseSrcset } from "srcset";
import type { DiscoveredResearchImages, ResearchImageMetadata, GenerationResearchSearchResult } from "@slidespeech/types";

type Node = ReturnType<typeof parseDocument>["children"][number];
type Element = ReturnType<typeof DomUtils.findAll>[number];
const skipped = new Set(["head", "noscript", "script", "style", "svg", "template"]);
const blocks = new Set(["address", "article", "aside", "blockquote", "br", "div", "dl", "dt", "dd", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "section", "table", "td", "th", "tr", "ul"]);

export function collapseResearchWhitespace(value: string): string {
  let result = "";
  let space = false;
  for (const character of value) {
    if (character.trim() === "") { space = result.length > 0; continue; }
    if (space) result += " ";
    result += character;
    space = false;
  }
  return result.trim();
}

function contentText(nodes: Node[]): string {
  const stack: Array<Node | string> = [...nodes].reverse();
  const parts: string[] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (typeof node === "string") { parts.push(node); continue; }
    if (node.type === "text") { parts.push(node.data); continue; }
    if ("name" in node && skipped.has(node.name)) continue;
    if ("children" in node) {
      const block = "name" in node && blocks.has(node.name);
      if (block) { parts.push(" "); stack.push(" "); }
      for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
    }
  }
  return collapseResearchWhitespace(parts.join(""));
}

// Source DOM structure, not a reconstructed visual reading order. Single-child
// layout wrappers add no grouping information and are collapsed, not interpreted.
function evidenceContent(nodes: Node[]): string {
  const rendered = new Map<Node, string>();
  const stack = nodes.map(node => ({ node, visited: false })).reverse();
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  while (stack.length) {
    const { node, visited } = stack.pop()!;
    if (node.type === "text") { rendered.set(node, escape(node.data)); continue; }
    if ("name" in node && skipped.has(node.name)) continue;
    if (!("children" in node)) continue;
    if (!visited) {
      stack.push({ node, visited: true });
      for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i]!, visited: false });
      continue;
    }
    const children = node.children.map(child => rendered.get(child) ?? "").filter(value => value.trim());
    const tag = "name" in node ? node.name : undefined;
    const text = node.children.map(child => rendered.get(child) ?? "").join("");
    const grouped = tag && blocks.has(tag) && (tag !== "div" || children.length > 1);
    rendered.set(node, !text.trim() ? "" : grouped ? `\n<${tag}>${text.trim()}</${tag}>\n` : text);
    for (const child of node.children) rendered.delete(child);
  }
  return nodes.map(node => rendered.get(node) ?? "").join("").trim();
}

function httpUrl(value: string | undefined, base?: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 8_192) return undefined;
    return url.href;
  } catch { return undefined; }
}

export const extractGenerationDocumentText = (markup: string): string => contentText(parseDocument(markup).children);

export function parseGenerationDocument(markup: string, pageUrl: string, maximumImages = 100) {
  if (!Number.isInteger(maximumImages) || maximumImages < 1 || maximumImages > 100) throw new Error("Image discovery limit must be between 1 and 100.");
  const document = parseDocument(markup);
  const short = (value?: string) => value === undefined ? undefined : collapseResearchWhitespace(value).slice(0, 4_000);
  const entries: Array<{ element: Element; caption: string | undefined }> = [];
  const stack: Array<{ node: Node; caption: string | undefined }> = document.children.map((node) => ({ node, caption: undefined })).reverse();
  while (stack.length) {
    const entry = stack.pop()!;
    const node = entry.node;
    let caption = entry.caption;
    if ("attribs" in node) {
      if (skipped.has(node.name) && node.name !== "head") continue;
      if (node.name === "figure") {
        const figureCaption = DomUtils.getElementsByTagName("figcaption", node.children, false, 1)[0];
        caption = figureCaption ? short(contentText(figureCaption.children)) : undefined;
      }
      entries.push({ element: node, caption });
    }
    if ("children" in node) for (let index = node.children.length - 1; index >= 0; index--) stack.push({ node: node.children[index]!, caption });
  }
  const elements = entries.map(({ element }) => element);
  const base = httpUrl(elements.find((element) => element.name === "base" && element.attribs.href)?.attribs.href, pageUrl) ?? pageUrl;
  const title = elements.find((element) => element.name === "title");
  const links: Array<{ url: string; text: string }> = [];
  const linkUrls = new Set<string>();
  const images = new Map<string, ResearchImageMetadata>();
  for (const { element, caption } of entries) {
    if (element.name === "a") {
      const value = httpUrl(element.attribs.href, base);
      if (value) {
        const url = new URL(value); url.hash = "";
        if (!linkUrls.has(url.href)) {
          linkUrls.add(url.href);
          links.push({ url: url.href, text: contentText(element.children) || url.pathname || url.hostname });
        }
      }
    }
    const property = (element.attribs.property ?? element.attribs.name)?.toLowerCase();
    const via = element.name === "img" ? "img" : element.name === "meta" && (property === "og:image" || property === "og:image:url") ? "open-graph"
      : element.name === "meta" && (property === "twitter:image" || property === "twitter:image:src") ? "twitter" : undefined;
    if (!via) continue;
    const url = httpUrl(via === "img" ? element.attribs.src : element.attribs.content, base);
    if (!url) continue;
    const width = Number(element.attribs.width), height = Number(element.attribs.height);
    let responsiveVariants: ResearchImageMetadata["responsiveVariants"];
    if (via === "img" && element.attribs.srcset) {
      try {
        responsiveVariants = parseSrcset(element.attribs.srcset, { strict: true }).flatMap((variant) => {
          const url = httpUrl(variant.url, base);
          return url ? [{ ...variant, url }] : [];
        }).slice(0, 20);
      } catch { /* Invalid optional HTML descriptors do not invalidate the ordinary src. */ }
    }
    const candidate: ResearchImageMetadata = {
      url, discoveredVia: via,
      ...(element.attribs.alt !== undefined ? { alt: short(element.attribs.alt)! } : {}),
      ...(caption ? { caption } : {}),
      ...(Number.isSafeInteger(width) && width > 0 ? { declaredWidth: width } : {}),
      ...(Number.isSafeInteger(height) && height > 0 ? { declaredHeight: height } : {}),
      ...(responsiveVariants?.length ? { responsiveVariants } : {}),
    };
    // Preserve metadata from repeated references to the same asset without ranking it.
    images.set(url, { ...images.get(url), ...candidate });
  }
  const imageDiscovery: DiscoveredResearchImages = {
    candidates: [...images.values()].slice(0, maximumImages),
    totalCandidates: images.size, truncated: images.size > maximumImages,
  };
  return { content: evidenceContent(document.children), title: title ? collapseResearchWhitespace(DomUtils.textContent(title)) : undefined, links, imageDiscovery };
}

export const extractGenerationDocumentLinks = (markup: string, base: string) => parseGenerationDocument(markup, base).links;

export function parseGenerationSearchRss(xml: string): GenerationResearchSearchResult[] {
  const document = parseDocument(xml, { xmlMode: true });
  return DomUtils.getElementsByTagName("item", document.children).flatMap((item) => {
    const text = (tag: string) => {
      const node = DomUtils.getElementsByTagName(tag, item.children, false, 1)[0];
      return node ? DomUtils.textContent(node) : "";
    };
    const title = extractGenerationDocumentText(text("title"));
    const url = httpUrl(text("link"));
    return title && url ? [{ title, url, snippet: extractGenerationDocumentText(text("description")) }] : [];
  });
}

export async function readBoundedResearchText(response: Response, maximumBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error("Research response byte limit must be positive.");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) throw new Error(`Research response exceeds ${maximumBytes} decoded bytes.`);
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
