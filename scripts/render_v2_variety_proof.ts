import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SLIDE_LAYOUTS, PRESENTATION_THEME_IDS, PublishedPresentationRecordSchema, assertSlideTextLayout, type LaidOutSlideScene } from "@slidespeech/types";
import { createSlidePreviewRenderer } from "@slidespeech/providers";
import { renderSlideScenesToPptx } from "../packages/providers/src/generation-v2/slide-scene-pptx";
import { SlideSceneCanvas } from "../packages/ui/src/slide-scene-canvas";
import { varietyProof } from "../tests/fixtures/slide-variety-proof";

// Developer proof only: never publishes fixtures or changes saved presentations.
async function main() {
  const [outputPath, imagePublication] = process.argv.slice(2);
  if (!outputPath || !imagePublication) throw new Error("Pass an output directory and an existing publication containing an image.");
  const root = resolve(outputPath);
  const record = PublishedPresentationRecordSchema.parse(JSON.parse(await readFile(imagePublication, "utf8")));
  const asset = record.presentation.designs.images?.assets[0];
  if (!asset) throw new Error("The proof needs a real source image; no decorative substitute.");
  const renderer = await createSlidePreviewRenderer();
  const scenes: LaidOutSlideScene[] = [];
  const cards: string[] = [];
  for (const layout of SLIDE_LAYOUTS) for (const theme of PRESENTATION_THEME_IDS) {
    const { draft, design } = varietyProof(layout, theme);
    if (layout.image) { draft.slideId = asset.approvedForSlideId; design.slideId = draft.slideId; design.imageAssetId = asset.id; }
    const result = renderer(draft, design, layout.image ? [asset] : []);
    if (!result.scene) throw new Error(`${theme}/${layout.id}: ${result.feedback.join("; ")}`);
    scenes.push(result.scene);
    cards.push(`<section id="${theme}-${layout.id}"><h2>${theme} / ${layout.id}</h2>${renderToStaticMarkup(createElement(SlideSceneCanvas, { scene: result.scene }))}</section>`);
  }
  const fontCss = (await readFile("packages/providers/assets/fonts/presenter.css", "utf8"));
  let embedded = fontCss;
  for (const file of ["SourceSerif4-Regular.ttf", "SourceSans3-Regular.ttf"]) embedded = embedded.replace(`./${file}`, `data:font/ttf;base64,${(await readFile(`packages/providers/assets/fonts/${file}`)).toString("base64")}`);
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, "variety-proof.pptx"), await renderSlideScenesToPptx(scenes));
  await writeFile(resolve(root, "scenes.json"), JSON.stringify(scenes));
  const liveCards: string[] = [];
  for (const file of process.argv.slice(4)) {
    const result = JSON.parse(await readFile(file, "utf8"));
    if (result.status !== "succeeded" || !Array.isArray(result.scenes)) throw new Error("Live comparison requires successful recorded slide output.");
    for (const scene of result.scenes) {
      assertSlideTextLayout(scene);
      liveCards.push(`<section id="live-slide-${liveCards.length + 1}">${renderToStaticMarkup(createElement(SlideSceneCanvas, { scene }))}</section>`);
    }
  }
  if (liveCards.length) await writeFile(resolve(root, "live.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SlideSpeech / Live design results</title><style>${embedded}body{margin:32px;background:#e7e8e5;color:#20332c;font:16px "Source Sans 3"}h1{font:40px "Source Serif 4"}main{max-width:1100px;margin:auto}section{margin:24px 0}svg{box-shadow:0 3px 15px #0002}</style><main><h1>Two subjects. Two design directions.</h1><p>Actual Qwen design, writing and slide-review results from previously approved outlines. New themes and compositions, unchanged research inputs. This is a slide-stage evaluation, not a newly published spoken presentation or factual certification.</p>${liveCards.join("")}</main></html>`);
  await writeFile(resolve(root, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SlideSpeech / Design systems</title><style>${embedded}body{margin:32px;background:#e7e8e5;color:#20332c;font:16px "Source Sans 3"}header{max-width:1200px;margin:0 auto 32px}h1{font:44px "Source Serif 4"}nav{display:flex;gap:24px}a{color:inherit}main{max-width:1800px;margin:auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}section{min-width:0}h2{font-size:13px;font-weight:400}svg{box-shadow:0 3px 15px #0002}@media(max-width:800px){main{grid-template-columns:1fr}}</style><header><h1>One story. Three design systems.</h1><p>Each row uses identical authored test copy, not generated or published presentation content. Compare the compositions, hierarchy and image placement, not just the palette. Saved decks are unchanged.</p><nav><a href="#editorial-editorial-opening">Covers</a><a href="#editorial-numbered-process">Processes</a><a href="#editorial-image-opening">Images</a><a href="/variety-proof.pptx">Inspect editable PPTX proof</a></nav></header><main>${cards.join("")}</main></html>`);
  console.log(JSON.stringify({ root, scenes: scenes.length, themes: PRESENTATION_THEME_IDS, layouts: SLIDE_LAYOUTS.length }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
