import PptxGenJS from "pptxgenjs";
import { SLIDE_CANVAS, assertSlideTextLayout, type LaidOutSlideScene } from "@slidespeech/types";

/** Rendering adapter, not a publication endpoint. Callers own the publication gate. */
export async function renderSlideScenesToPptx(scenes: LaidOutSlideScene[]): Promise<Uint8Array> {
  if (!scenes.length) throw new Error("Cannot render an empty presentation.");
  scenes.forEach(assertSlideTextLayout);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "V2", width: SLIDE_CANVAS.width / 96, height: SLIDE_CANVAS.height / 96 });
  pptx.layout = "V2";
  for (const scene of scenes) {
    const slide = pptx.addSlide();
    slide.background = { color: scene.background };
    for (const element of scene.elements) {
      const box = { x: element.x / 96, y: element.y / 96, w: element.width / 96, h: element.height / 96 };
      if (element.kind === "rectangle") {
        slide.addShape(pptx.ShapeType.rect, { ...box, line: { color: element.fill, transparency: 100 }, fill: { color: element.fill } });
      } else if (element.kind === "image") {
        slide.addImage({ ...box, data: element.dataUrl, altText: element.alt });
      } else {
        for (const line of element.textLayout.lines) {
          if (!line.text) continue;
          slide.addText(line.text, {
            x: (element.x + line.xOffset) / 96, y: (element.y + line.top) / 96,
            w: (element.width - line.xOffset) / 96, h: line.height / 96,
            fontFace: element.font, fontSize: element.size * 0.75, bold: element.bold,
            color: element.color, margin: 0, valign: "top", wrap: false,
            lineSpacingMultiple: 1, paraSpaceAfter: 0,
          });
        }
      }
    }
    slide.addNotes(scene.speakerNotes.join("\n\n"));
  }
  return new Uint8Array(await pptx.write({ outputType: "uint8array" }) as Uint8Array);
}
