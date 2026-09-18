import { readFile } from "node:fs/promises";
import { composeSlideScene, createSlideLayoutFrame, SLIDE_LAYOUTS } from "@slidespeech/types";
import type { SlideDraft, SlideDesignSpec, SlideWritingLayout, SlideImageAsset } from "@slidespeech/types";
import { createSlideTextLayouter, SlideTextFitError } from "./slide-text-layout";

export async function createSlidePreviewRenderer() {
  const assets = [];
  for (const [family, file] of [["Source Serif 4", "SourceSerif4-Regular.ttf"], ["Source Sans 3", "SourceSans3-Regular.ttf"]] as const) {
    assets.push({ family, bold: false, data: await readFile(require.resolve(`../../assets/fonts/${file}`)) });
  }
  const layout = createSlideTextLayouter(assets);
  const fonts = { heading: "Source Serif 4", body: "Source Sans 3" };
  const render = (draft: SlideDraft, design: SlideDesignSpec, assets: SlideImageAsset[] = []) => {
    const scene = composeSlideScene(draft, design, fonts, assets);
    try {
      return { scene: layout(scene) };
    } catch (error) {
      if (!(error instanceof SlideTextFitError)) throw error;
      // A missing glyph is an asset limitation, not permission to rewrite a language.
      if (error.issues.some((issue) => issue.code === "unsupported-glyph" || issue.code === "font-unavailable")) throw error;
      return { feedback: error.issues.map((issue) => {
        const element = scene.elements[issue.elementIndex];
        return `Field ${JSON.stringify(element?.kind === "text" ? element.contentPath : [])}, text ${JSON.stringify(element?.kind === "text" ? element.text : "")}: ${issue.code}: ${issue.detail}`;
      }) };
    }
  };
  return Object.assign(render, { describe: (design: SlideDesignSpec): SlideWritingLayout => {
    const frame = createSlideLayoutFrame(design, {}, fonts);
    return {
      layoutId: design.layoutId,
      maximumItemsPerGroup: SLIDE_LAYOUTS.find((item) => item.id === design.layoutId)!.maximumItems,
      fields: frame.elements.flatMap((element) => element.kind === "text" && element.contentPath ? [{ path: element.contentPath, ...layout.describeFrame(element) }] : []),
    };
  } });
}
