import { SLIDE_CANVAS, type SlideScene, type SlideSceneElement } from "./slide-scene";

export type SlideTextElement = Extract<SlideSceneElement, { kind: "text" }>;
export type SlideTextLine = {
  source: string;
  text: string;
  width: number;
  xOffset: number;
  top: number;
  height: number;
  baseline: number;
};
export type LaidOutSlideText = SlideTextElement & {
  textLayout: { styleKey: string; fontIdentity: string; lines: SlideTextLine[] };
};
export type LaidOutSlideScene = Omit<SlideScene, "elements"> & {
  elements: (Exclude<SlideSceneElement, { kind: "text" }> | LaidOutSlideText)[];
};

export const slideTextStyleKey = (element: SlideTextElement): string =>
  JSON.stringify([element.font, element.size, element.bold, element.width, element.height]);

// Unicode UAX #14 mandatory separators, not language/content classification.
export const SLIDE_HARD_LINE_BREAKS: ReadonlySet<string> = new Set(["\n", "\r", "\u000b", "\u000c", "\u0085", "\u2028", "\u2029"]);
export function slideTextLineContent(source: string): string {
  let end = source.length;
  while (end > 0 && SLIDE_HARD_LINE_BREAKS.has(source[end - 1]!)) end--;
  return source.slice(0, end).trimEnd();
}

/** Unmeasured or stale copy must not enter either rendering adapter. */
export function assertSlideTextLayout(scene: SlideScene): asserts scene is LaidOutSlideScene {
  for (const element of scene.elements) {
    const validBox = [element.x, element.y, element.width, element.height].every(Number.isFinite)
      && element.x >= 0 && element.y >= 0 && element.width > 0 && element.height > 0
      && element.x + element.width <= SLIDE_CANVAS.width && element.y + element.height <= SLIDE_CANVAS.height;
    if (!validBox) throw new Error("Invalid slide geometry.");
    if (element.kind === "image" && (!element.dataUrl.startsWith("data:image/jpeg;base64,") || !element.assetId || element.sha256.length !== 64 || !element.alt)) throw new Error("Invalid slide image identity.");
    if (element.kind !== "text") continue;
    const layout = (element as Partial<LaidOutSlideText>).textLayout;
    if (!layout || !layout.fontIdentity || layout.styleKey !== slideTextStyleKey(element)
      || !layout.lines.length || layout.lines.map((line) => line.source).join("") !== element.text) {
      throw new Error("Missing or stale slide text layout.");
    }
    let bottom = 0;
    for (const line of layout.lines) {
      if (![line.width, line.xOffset, line.top, line.height, line.baseline].every(Number.isFinite)
        || line.text !== slideTextLineContent(line.source) || line.width < 0 || line.width > element.width
        || line.xOffset < 0 || line.xOffset > line.width || line.top < bottom || line.height <= 0
        || line.baseline < 0 || line.baseline > line.height || line.top + line.height > element.height) {
        throw new Error("Invalid slide text layout bounds.");
      }
      bottom = line.top + line.height;
    }
  }
}
