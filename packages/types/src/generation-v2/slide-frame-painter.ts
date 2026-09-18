import type { SlideDesignSpec } from "./presentation";
import type { SlideContentPath, SlideLayoutFrame } from "./slide-scene";
import { SLIDE_LAYOUTS } from "./slide-layout-catalog";
import { SLIDE_THEMES } from "./slide-themes";

/** Geometry primitives shared by design systems, author measurement and export. */
export function createSlideFramePainter(design: SlideDesignSpec, counts: { steps?: number; leftItems?: number; rightItems?: number }, fonts: { heading: string; body: string }) {
  const layout = SLIDE_LAYOUTS.find(candidate => candidate.id === design.layoutId);
  if (!layout || layout.family !== design.layoutFamily) throw new Error("Unknown or mismatched slide layout.");
  if (layout.image ? design.imageStrategy !== "source-image" || !design.imageAssetId : design.imageStrategy !== "none" || design.imageAssetId) throw new Error("Image strategy and layout must match a validated asset.");
  const theme = SLIDE_THEMES[design.themeId ?? "editorial"];
  if (!theme) throw new Error("Unknown slide theme.");
  const { background, ink, muted } = layout.cover ? theme.cover : theme.page;
  const heading = theme.heading === "sans" ? fonts.body : fonts.heading;
  const elements: SlideLayoutFrame["elements"] = [];
  const rect = (x: number, y: number, width: number, height: number, fill = theme.rule) => elements.push({ kind: "rectangle", x, y, width, height, fill });
  const text = (binding: SlideContentPath | string, x: number, y: number, width: number, height: number, size: number, font = fonts.body, color = ink) =>
    elements.push({ kind: "text", ...(typeof binding === "string" ? { fixedText: binding } : { contentPath: binding }), x, y, width, height, size, font, color, bold: false });
  const title = (x = 64, y = 82, width = 1152, height = 116, size = layout.cover ? 58 : 44) => text(["title"], x, y, width, height, size, heading);
  const subtitle = (x = 64, y = 208, width = 1120, height = 64) => text(["subtitle"], x, y, width, height, 23, fonts.body, muted);
  const count = (value: number | undefined) => {
    const result = value ?? layout.maximumItems;
    if (!Number.isInteger(result) || result < 1 || result > layout.maximumItems) throw new Error("Item count exceeds the selected layout capacity.");
    return result;
  };
  const image = (x: number, y: number, width: number, height: number) => elements.push({ kind: "image", x, y, width, height });
  return { layout, theme, background, ink, muted, heading, fonts, elements, rect, text, title, subtitle, count, image, counts };
}
export type SlideFramePainter = ReturnType<typeof createSlideFramePainter>;
