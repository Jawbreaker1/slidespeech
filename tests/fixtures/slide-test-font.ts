import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { type SlideScene } from "@slidespeech/types";
import { createSlideTextLayouter } from "../../packages/providers/src/generation-v2/slide-text-layout";

const require = createRequire(import.meta.url);
export const testFont = {
  family: "Source Sans 3", bold: false,
  data: readFileSync(require.resolve("@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff")),
};
export const layoutWithTestFont = createSlideTextLayouter([testFont]);

// Portable rendering tests use an OFL font, not proprietary fonts from the host.
// The separate visual proof keeps the actual Georgia/Trebuchet design fonts.
export const prepareTestScene = (scene: SlideScene) => layoutWithTestFont({
  ...scene,
  elements: scene.elements.map((element) => element.kind === "text" ? { ...element, font: testFont.family } : element),
});
