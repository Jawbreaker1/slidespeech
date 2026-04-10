import { writeFile } from "node:fs/promises";

import type { Deck, DeckExporter } from "@slidespeech/types";
import PptxGenJS from "pptxgenjs";

import { ensureDirForFile } from "../shared";

export class PptxGenJSDeckExporter implements DeckExporter {
  readonly name = "pptxgenjs";

  async exportToPptx(deck: Deck, outputPath: string): Promise<string> {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "SlideSpeech";
    pptx.subject = deck.topic;
    pptx.title = deck.title;

    for (const slide of deck.slides) {
      const pptSlide = pptx.addSlide();
      pptSlide.background = { color: "F7F4ED" };
      pptSlide.addText(slide.title, {
        x: 0.5,
        y: 0.5,
        w: 12,
        h: 0.6,
        fontFace: "Aptos Display",
        fontSize: 24,
        bold: true,
        color: "0F172A",
      });
      pptSlide.addText(slide.keyPoints.map((point) => ({ text: point })), {
        x: 0.8,
        y: 1.4,
        w: 11.2,
        h: 3.8,
        fontFace: "Aptos",
        fontSize: 18,
        color: "1F2937",
        breakLine: true,
        bullet: { indent: 18 },
      });
      pptSlide.addText(`Learning goal: ${slide.learningGoal}`, {
        x: 0.8,
        y: 5.4,
        w: 11.2,
        h: 0.6,
        fontFace: "Aptos",
        fontSize: 12,
        italic: true,
        color: "1C7C7D",
      });
    }

    await ensureDirForFile(outputPath);
    await pptx.writeFile({ fileName: outputPath });
    return outputPath;
  }

  async exportToJson(deck: Deck, outputPath: string): Promise<string> {
    await ensureDirForFile(outputPath);
    await writeFile(outputPath, JSON.stringify(deck, null, 2), "utf8");
    return outputPath;
  }

  async renderToHtml(deck: Deck): Promise<string> {
    return deck.slides
      .map(
        (slide) => `
          <section>
            <h2>${slide.title}</h2>
            <p>${slide.learningGoal}</p>
            <ul>${slide.keyPoints.map((point) => `<li>${point}</li>`).join("")}</ul>
          </section>
        `,
      )
      .join("\n");
  }
}

