import { writeFile } from "node:fs/promises";

import {
  getPrimarySlideIllustration,
  type Deck,
  type DeckExporter,
  type Slide,
  type SlideVisualTone,
} from "@slidespeech/types";
import PptxGenJS from "pptxgenjs";

import { ensureDirForFile } from "../shared";

export class PptxGenJSDeckExporter implements DeckExporter {
  readonly name = "pptxgenjs";

  private normalizeComparableText(value: string) {
    return value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private buildAudienceCallouts(slide: Slide) {
    const likelyQuestionSet = new Set(
      slide.likelyQuestions
        .map((value) => this.normalizeComparableText(value))
        .filter(Boolean),
    );
    const alreadyVisible = new Set(
      [
        ...slide.keyPoints,
        ...slide.visuals.cards.map((card) => card.body),
        ...slide.visuals.diagramNodes.map((node) => node.label),
        slide.learningGoal,
        slide.beginnerExplanation,
      ]
        .map((value) => this.normalizeComparableText(value))
        .filter(Boolean),
    );

    return slide.visuals.callouts.filter((callout) => {
      const normalized = this.normalizeComparableText(callout.text);
      if (!normalized) {
        return false;
      }

      if (likelyQuestionSet.has(normalized)) {
        return false;
      }

      return !alreadyVisible.has(normalized);
    });
  }

  private normalizeColor(value?: string, fallback = "1C7C7D") {
    const normalized = value?.trim().replace(/^#/, "").toUpperCase();
    return normalized && /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
  }

  private toneFill(tone: SlideVisualTone, accent: string) {
    switch (tone) {
      case "accent":
        return { fill: `${accent}22`, line: accent, text: "0F172A" };
      case "success":
        return { fill: "ECFDF5", line: "10B981", text: "065F46" };
      case "warning":
        return { fill: "FFFBEB", line: "F59E0B", text: "92400E" };
      case "info":
        return { fill: "EFF6FF", line: "3B82F6", text: "1E3A8A" };
      case "neutral":
      default:
        return { fill: "F8FAFC", line: "CBD5E1", text: "1F2937" };
    }
  }

  private renderCards(
    pptx: PptxGenJS,
    pptSlide: PptxGenJS.Slide,
    slide: Slide,
    accent: string,
  ) {
    if (slide.visuals.layoutTemplate === "three-step-flow") {
      return;
    }

    const cards = slide.visuals.cards.slice(0, 3);
    if (cards.length === 0) {
      return;
    }

    const hasIllustration = Boolean(getPrimarySlideIllustration(slide));
    const cardWidth = hasIllustration ? 2.2 : 3.55;
    const gap = 0.25;
    const startX = hasIllustration ? 0.82 : (13.333 - (cardWidth * cards.length + gap * (cards.length - 1))) / 2;
    const y = 2.15;

    for (const [index, card] of cards.entries()) {
      const x = startX + index * (cardWidth + gap);
      const tone = this.toneFill(card.tone, accent);

      pptSlide.addShape(pptx.ShapeType.roundRect, {
        x,
        y,
        w: cardWidth,
        h: 1.75,
        fill: { color: tone.fill },
        line: { color: tone.line, pt: 1.5 },
      });
      pptSlide.addText(card.title, {
        x: x + 0.18,
        y: y + 0.16,
        w: cardWidth - 0.36,
        h: 0.34,
        fontFace: "Aptos Display",
        fontSize: 15,
        bold: true,
        color: tone.text,
      });
      pptSlide.addText(card.body, {
        x: x + 0.18,
        y: y + 0.56,
        w: cardWidth - 0.36,
        h: 0.95,
        fontFace: "Aptos",
        fontSize: 10.5,
        color: tone.text,
        valign: "top",
      });
    }
  }

  private renderCallouts(
    pptx: PptxGenJS,
    pptSlide: PptxGenJS.Slide,
    slide: Slide,
    accent: string,
  ) {
    const callouts = this.buildAudienceCallouts(slide).slice(0, 2);
    if (callouts.length === 0) {
      return;
    }

    for (const [index, callout] of callouts.entries()) {
      const y = 4.28 + index * 0.84;
      const tone = this.toneFill(callout.tone, accent);

      pptSlide.addShape(pptx.ShapeType.roundRect, {
        x: 0.82,
        y,
        w: 5.9,
        h: 0.68,
        fill: { color: tone.fill },
        line: { color: tone.line, pt: 1.2 },
      });
      pptSlide.addText(`${callout.label}: ${callout.text}`, {
        x: 1.02,
        y: y + 0.12,
        w: 5.5,
        h: 0.42,
        fontFace: "Aptos",
        fontSize: 10.5,
        color: tone.text,
        bold: true,
      });
    }
  }

  private renderFlow(
    pptx: PptxGenJS,
    pptSlide: PptxGenJS.Slide,
    slide: Slide,
    accent: string,
  ) {
    const nodes = slide.visuals.diagramNodes.slice(0, 3);
    if (slide.visuals.layoutTemplate !== "three-step-flow" || nodes.length === 0) {
      return;
    }

    const startX = 1.0;
    const y = 4.45;
    const width = 2.7;
    const gap = 1.05;

    for (const [index, node] of nodes.entries()) {
      const x = startX + index * (width + gap);
      const tone = this.toneFill(node.tone, accent);

      pptSlide.addShape(pptx.ShapeType.roundRect, {
        x,
        y,
        w: width,
        h: 0.82,
        fill: { color: tone.fill },
        line: { color: tone.line, pt: 1.3 },
      });
      pptSlide.addText(node.label, {
        x: x + 0.14,
        y: y + 0.19,
        w: width - 0.28,
        h: 0.32,
        fontFace: "Aptos Display",
        fontSize: 13,
        align: "center",
        bold: true,
        color: tone.text,
      });

      if (index < nodes.length - 1) {
        pptSlide.addText("→", {
          x: x + width + 0.2,
          y: y + 0.1,
          w: 0.5,
          h: 0.4,
          fontSize: 24,
          bold: true,
          color: accent,
          align: "center",
        });
      }
    }
  }

  private renderIllustration(pptSlide: PptxGenJS.Slide, slide: Slide) {
    const illustration = getPrimarySlideIllustration(slide);
    if (!illustration) {
      return;
    }

    const isWideLayout =
      slide.visuals.layoutTemplate === "hero-focus" ||
      slide.visuals.layoutTemplate === "two-column-callouts" ||
      slide.visuals.layoutTemplate === "three-step-flow";

    pptSlide.addImage({
      data: illustration.dataUri,
      x: isWideLayout ? 8.15 : 0.82,
      y: isWideLayout ? 2.0 : 1.9,
      w: isWideLayout ? 4.35 : 11.7,
      h: isWideLayout ? 3.4 : 1.9,
    });
  }

  async exportToPptx(deck: Deck, outputPath: string): Promise<string> {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "SlideSpeech";
    pptx.subject = deck.topic;
    pptx.title = deck.title;

    for (const slide of deck.slides) {
      const pptSlide = pptx.addSlide();
      const accent = this.normalizeColor(slide.visuals.accentColor);

      pptSlide.background = { color: "F8FAFC" };
      pptSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 0.28,
        h: 7.5,
        fill: { color: accent },
        line: { color: accent, pt: 0 },
      });
      if (slide.visuals.eyebrow) {
        pptSlide.addText(slide.visuals.eyebrow, {
          x: 0.55,
          y: 0.28,
          w: 3.2,
          h: 0.26,
          fontFace: "Aptos",
          fontSize: 10,
          bold: true,
          color: accent,
        });
      }
      pptSlide.addText(slide.title, {
        x: 0.55,
        y: 0.58,
        w: 12.1,
        h: 0.48,
        fontFace: "Aptos Display",
        fontSize: 24,
        bold: true,
        color: "0F172A",
      });
      pptSlide.addText(slide.visuals.heroStatement ?? slide.learningGoal, {
        x: 0.82,
        y: 1.15,
        w: 11.7,
        h: 0.56,
        fontFace: "Aptos",
        fontSize: 15,
        italic: true,
        color: "334155",
      });
      this.renderCards(pptx, pptSlide, slide, accent);
      this.renderIllustration(pptSlide, slide);
      this.renderCallouts(pptx, pptSlide, slide, accent);
      this.renderFlow(pptx, pptSlide, slide, accent);
      pptSlide.addText(`Learning goal: ${slide.learningGoal}`, {
        x: 7.1,
        y: 6.55,
        w: 5.4,
        h: 0.38,
        fontFace: "Aptos",
        fontSize: 10.5,
        italic: true,
        color: accent,
        align: "right",
      });
      pptSlide.addText(slide.keyPoints.slice(0, 3).map((point) => ({ text: point })), {
        x: 7.15,
        y: 4.35,
        w: 5.0,
        h: 1.7,
        fontFace: "Aptos",
        fontSize: 10.5,
        color: "334155",
        breakLine: true,
        bullet: { indent: 12 },
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
