import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideSceneCanvas } from "../packages/ui/src/slide-scene-canvas";
import { renderSlideScenesToPptx } from "../packages/providers/src/generation-v2/slide-scene-pptx";
import { slideDesignProof } from "../tests/fixtures/slide-design-proof";
import { createSlideTextLayouter } from "../packages/providers/src/generation-v2/slide-text-layout";

// Developer-only rendering validation. Never exposed as a generated deck by the API.
async function main() {
const output = path.resolve(process.argv[2] ?? "/tmp/slidespeech-design-proof");
const fontDirectory = process.argv[3];
if (!fontDirectory) throw new Error("Pass output directory and a directory containing Georgia.ttf and Trebuchet MS.ttf. No substitute fonts are used.");
const fonts = [];
for (const family of ["Georgia", "Trebuchet MS"]) {
  fonts.push({ family, bold: false, data: await readFile(path.join(fontDirectory, `${family}.ttf`)) });
}
const layout = createSlideTextLayouter(fonts);
const scenes = slideDesignProof.map(({ scene }) => layout(scene));
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "design-proof-draft.pptx"), await renderSlideScenesToPptx(scenes));
const slides = scenes.map((scene, index) => `<section><p>${String(index + 1).padStart(2, "0")} / DESIGN STUDY</p>${renderToStaticMarkup(createElement(SlideSceneCanvas, { scene }))}</section>`).join("");
await writeFile(path.join(output, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SlideSpeech / Design study</title><style>body{margin:0;background:#e8e8df;color:#193e35;font-family:'Trebuchet MS';padding:40px}main{max-width:1152px;margin:auto}h1{font:48px Georgia}p{line-height:1.5}section{margin:56px 0}section>p{font-size:12px;letter-spacing:.16em}svg{box-shadow:0 12px 40px #193e3512}@media(max-width:600px){body{padding:16px}h1{font-size:34px}}</style><main><p>SLIDESPEECH / DESIGN STUDY 01</p><h1>A quieter screen. A stronger story.</h1><p>Six initial layout compositions. Manually authored test content, not a generated presentation.<br>The browser and editable PowerPoint use the same layout geometry. Publication remains disabled.</p>${slides}</main></html>`);
console.log(output);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
