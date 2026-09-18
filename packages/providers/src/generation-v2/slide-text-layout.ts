/// <reference path="./linebreak.d.ts" />
import { createHash } from "node:crypto";
import { create, type Font } from "fontkit";
import LineBreaker from "linebreak";
import {
  assertSlideTextLayout, slideTextStyleKey, slideTextLineContent, SLIDE_HARD_LINE_BREAKS,
  type LaidOutSlideScene, type SlideScene, type SlideTextElement, type SlideTextLine, type SlideTextFrame,
} from "@slidespeech/types";

export type SlideTextFitIssue = {
  slideId: string;
  elementIndex: number;
  code: "font-unavailable" | "unsupported-glyph" | "width-overflow" | "height-overflow";
  detail: string;
};
export class SlideTextFitError extends Error {
  constructor(readonly issues: SlideTextFitIssue[]) {
    super(`Slide text layout failed: ${issues.map((issue) => `${issue.code} (${issue.slideId}:${issue.elementIndex}): ${issue.detail}`).join("; ")}`);
    this.name = "SlideTextFitError";
  }
}

type FontAsset = { family: string; bold: boolean; data: Uint8Array };
type RegisteredFont = { font: Font; identity: string };
const fontKey = (family: string, bold: boolean) => JSON.stringify([family, bold]);

/** Explicit font assets, never OS-specific search paths or substituted font metrics. */
export function createSlideTextLayouter(assets: FontAsset[]) {
  const fonts = new Map<string, RegisteredFont>();
  for (const asset of assets) {
    const data = Buffer.from(asset.data);
    const font = create(data);
    const key = fontKey(asset.family, asset.bold);
    if (!("layout" in font) || font.familyName !== asset.family || fonts.has(key)) {
      throw new Error(`Invalid or duplicate slide font asset: ${asset.family}`);
    }
    fonts.set(key, { font, identity: createHash("sha256").update(data).digest("hex") });
  }
  const layout = (scene: SlideScene): LaidOutSlideScene => {
    const issues: SlideTextFitIssue[] = [];
    const elements: LaidOutSlideScene["elements"] = [];
    scene.elements.forEach((element, elementIndex) => {
      if (element.kind !== "text") { elements.push({ ...element }); return; }
      const report = (code: SlideTextFitIssue["code"], detail: string) => issues.push({ slideId: scene.slideId, elementIndex, code, detail });
      const registered = fonts.get(fontKey(element.font, element.bold));
      if (!registered) { report("font-unavailable", `${element.font}, bold=${element.bold}`); return; }
      const lines = layoutText(element, registered.font);
      for (const line of lines) {
        const missing = registered.font.layout(line.text).glyphs.filter((glyph) => glyph.id === 0);
        if (missing.length) report("unsupported-glyph", `The selected font cannot shape all characters in this text box.`);
        if (line.width > element.width) report("width-overflow", `Measured ${line.width.toFixed(1)}px; available ${element.width}px.`);
      }
      const requiredHeight = lines.at(-1)!.top + lines.at(-1)!.height;
      if (requiredHeight > element.height) report("height-overflow", `Measured ${requiredHeight.toFixed(1)}px; available ${element.height}px.`);
      elements.push({ ...element, textLayout: { styleKey: slideTextStyleKey(element), fontIdentity: registered.identity, lines } });
    });
    if (issues.length) throw new SlideTextFitError(issues);
    const result = { ...scene, speakerNotes: [...scene.speakerNotes], elements };
    assertSlideTextLayout(result);
    return result;
  };
  return Object.assign(layout, { describeFrame: (frame: SlideTextFrame) => {
    const registered = fonts.get(fontKey(frame.font, frame.bold));
    if (!registered) throw new Error(`Unregistered frame font: ${frame.font}`);
    const lineHeight = layoutText({ ...frame, text: "" }, registered.font)[0]!.height;
    return { width: frame.width, height: frame.height, font: frame.font, size: frame.size,
      lineHeight, maximumLines: Math.floor(frame.height / lineHeight), fontIdentity: registered.identity };
  } });
}

function layoutText(element: SlideTextElement, font: Font): SlideTextLine[] {
  if (![element.size, element.width, element.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Text size and box dimensions must be positive and finite.");
  }
  const scale = element.size / font.unitsPerEm;
  const measure = (source: string) => {
    const text = slideTextLineContent(source);
    const run = font.layout(text);
    const xOffset = text ? -Math.min(0, run.bbox.minX) * scale : 0;
    const width = text ? Math.max(run.advanceWidth, run.bbox.maxX) * scale + xOffset : 0;
    const ascent = Math.max(font.ascent, text ? run.bbox.maxY : 0) * scale;
    const descent = Math.max(-font.descent, text ? -run.bbox.minY : 0) * scale;
    const height = Math.max(element.size * 1.15, ascent + descent + font.lineGap * scale);
    return { source, text, width, xOffset, height, baseline: ascent + (height - ascent - descent) / 2 };
  };
  const lines: SlideTextLine[] = [];
  const append = (source: string) => {
    const last = lines.at(-1);
    lines.push({ ...measure(source), top: last ? last.top + last.height : 0 });
  };
  const breaker = new LineBreaker(element.text);
  let start = 0;
  let previous = 0;
  for (let boundary = breaker.nextBreak(); boundary; boundary = breaker.nextBreak()) {
    if (measure(element.text.slice(start, boundary.position)).width > element.width && previous > start) {
      append(element.text.slice(start, previous));
      start = previous;
    }
    previous = boundary.position;
    if (boundary.required) { append(element.text.slice(start, previous)); start = previous; }
  }
  if (start < element.text.length) append(element.text.slice(start));
  if (!lines.length || SLIDE_HARD_LINE_BREAKS.has(element.text.at(-1) ?? "")) append("");
  return lines;
}
