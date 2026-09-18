import type { SlideDraft, SlideDesignSpec } from "./presentation";
import type { SlideImageAsset } from "./slide-images";
import { SLIDE_LAYOUTS } from "./slide-layout-catalog";
import { createSlideLayoutFrame } from "./slide-layout-frames";
export { SLIDE_LAYOUTS, createSlideLayoutFrame };

export const SLIDE_CANVAS = { width: 1280, height: 720 } as const;
type Box = { x: number; y: number; width: number; height: number };
export type SlideContentPath = Array<string | number>;
export type SlideTextFrame = Box & { kind: "text"; color: string; font: string; size: number; bold: boolean; contentPath?: SlideContentPath; fixedText?: string };
export type SlideLayoutFrame = { background: string; elements: (SlideTextFrame | (Box & { kind: "rectangle"; fill: string }) | (Box & { kind: "image" }))[] };
export type SlideSceneElement = Box & (
  | { kind: "rectangle"; fill: string }
  | { kind: "text"; text: string; color: string; font: string; size: number; bold: boolean; contentPath?: SlideContentPath }
  | { kind: "image"; dataUrl: string; assetId: string; sha256: string; alt: string; sourcePageUrl: string }
);
export type SlideScene = {
  slideId: string; title: string; background: string; elements: SlideSceneElement[]; speakerNotes: string[];
};

/** Bind authored fields to geometry without deriving semantic copy. */
export function composeSlideScene(draft: SlideDraft, design: SlideDesignSpec, fonts = { heading: "Georgia", body: "Trebuchet MS" }, assets: SlideImageAsset[] = []): SlideScene {
  const layout = SLIDE_LAYOUTS.find((candidate) => candidate.id === design.layoutId);
  if (layout?.contentKind !== draft.content.kind || draft.slideId !== design.slideId) throw new Error("Slide content and selected layout must match.");
  const counts = draft.content.kind === "process" ? { steps: draft.content.steps.length }
    : draft.content.kind === "comparison" ? { leftItems: draft.content.left.items.length, rightItems: draft.content.right.items.length } : {};
  const frame = createSlideLayoutFrame(design, counts, fonts);
  const asset = assets.find((asset) => asset.id === design.imageAssetId && asset.approvedForSlideId === draft.slideId);
  if (design.imageAssetId && !asset) throw new Error("The selected image has no vision approval for this slide.");
  const data = { ...draft, sourceLine: draft.sourceAttributions.map((source) => source.label).join(" / "),
    imageCredit: asset ? new URL(asset.sourcePageUrl).hostname : undefined };
  const elements: SlideSceneElement[] = [];
  for (const element of frame.elements) {
    if (element.kind === "rectangle") { elements.push(element); continue; }
    if (element.kind === "image") {
      if (!asset) throw new Error("Missing approved image asset.");
      const scale = Math.min(element.width / asset.width, element.height / asset.height);
      const width = asset.width * scale, height = asset.height * scale;
      elements.push({ kind: "image", x: element.x + (element.width - width) / 2, y: element.y + (element.height - height) / 2, width, height,
        dataUrl: asset.dataUrl, assetId: asset.id, sha256: asset.sha256, alt: asset.description, sourcePageUrl: asset.sourcePageUrl });
      continue;
    }
    const { fixedText, ...box } = element;
    let value: unknown = data;
    for (const key of element.contentPath ?? []) value = value && typeof value === "object" ? (value as Record<string | number, unknown>)[key] : undefined;
    const text = fixedText ?? value;
    if (typeof text === "string" && text.length) elements.push({ ...box, text });
  }
  return { slideId: draft.slideId, title: draft.title, background: frame.background, elements,
    speakerNotes: [...draft.speakerNotes, ...draft.sourceAttributions.map((source) => source.url ? `${source.label}: ${source.url}` : source.label),
      ...(asset ? [`Image source: ${asset.sourcePageUrl}\nImage URL: ${asset.sourceImageUrl}\n${asset.sourceCaption ?? ""}\nReuse rights: unverified.`] : [])] };
}
