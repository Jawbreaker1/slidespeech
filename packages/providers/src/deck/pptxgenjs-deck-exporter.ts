import { writeFile } from "node:fs/promises";

import {
  getPrimarySlideIllustration,
  type Deck,
  type DeckExporter,
  type PresentationTheme,
  type Slide,
  type SlideVisualCard,
  type SlideVisualTone,
  resolvePresentationTheme,
} from "@slidespeech/types";
import PptxGenJS from "pptxgenjs";

import { ensureDirForFile } from "../shared";

type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type ToneStyle = {
  fill: string;
  fillTransparency?: number;
  line: string;
  lineTransparency?: number;
  text: string;
};

type PptxThemeStyle = {
  background: string;
  accent: string;
  title: string;
  body: string;
  muted: string;
  softSurface: string;
  titleFont: string;
  bodyFont: string;
};

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const SAFE_LEFT = 0.62;
const SAFE_RIGHT = SLIDE_W - 0.613;
const CONTENT_TOP = 2.02;
const CONTENT_BOTTOM = 6.68;
const TEXT_MARGIN = 0.06;

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

  private deriveCardTitle(card: SlideVisualCard): string {
    if (
      card.title.trim() &&
      !/^(?:key\s*(?:point|idea)|point|main\s*idea)\s*\d+$/i.test(
        card.title.trim(),
      )
    ) {
      return card.title;
    }

    const title = card.body
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[^\p{L}\p{N}]+/gu, "")
      .replace(/\b(?:which|that|where|who|whose)\b.*$/i, "")
      .replace(/[.,:!?]+$/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .join(" ");

    return title || "Main idea";
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

  private resolveThemeStyle(theme: PresentationTheme): PptxThemeStyle {
    switch (theme) {
      case "editorial":
        return {
          background: "FAF4EA",
          accent: "B7791F",
          title: "20180F",
          body: "4A3728",
          muted: "8A7158",
          softSurface: "FFF9F0",
          titleFont: "Georgia",
          bodyFont: "Aptos",
        };
      case "signal":
        return {
          background: "EFF6FF",
          accent: "0284C7",
          title: "0F172A",
          body: "334155",
          muted: "64748B",
          softSurface: "FFFFFF",
          titleFont: "Aptos Display",
          bodyFont: "Aptos",
        };
      case "paper":
      default:
        return {
          background: "F8FAFC",
          accent: "1C7C7D",
          title: "0F172A",
          body: "334155",
          muted: "94A3B8",
          softSurface: "FFFFFF",
          titleFont: "Aptos Display",
          bodyFont: "Aptos",
        };
    }
  }

  private toneFill(
    tone: SlideVisualTone,
    accent: string,
    themeStyle: PptxThemeStyle,
  ): ToneStyle {
    switch (tone) {
      case "accent":
        return {
          fill: accent,
          fillTransparency: 86,
          line: accent,
          text: themeStyle.title,
        };
      case "success":
        return { fill: "ECFDF5", line: "10B981", text: "065F46" };
      case "warning":
        return { fill: "FFFBEB", line: "F59E0B", text: "92400E" };
      case "info":
        return { fill: "EFF6FF", line: "3B82F6", text: "1E3A8A" };
      case "neutral":
      default:
        return { fill: themeStyle.softSurface, line: "CBD5E1", text: themeStyle.body };
    }
  }

  private shapeFill(style: ToneStyle): PptxGenJS.ShapeFillProps {
    return {
      color: style.fill,
      ...(typeof style.fillTransparency === "number"
        ? { transparency: style.fillTransparency }
        : {}),
    };
  }

  private shapeLine(style: ToneStyle, pt: number): PptxGenJS.ShapeLineProps {
    return {
      color: style.line,
      pt,
      ...(typeof style.lineTransparency === "number"
        ? { transparency: style.lineTransparency }
        : {}),
    };
  }

  private normalizeImageDataForPptx(dataUri: string): string {
    if (/^data:[^,]+;base64,/i.test(dataUri)) {
      return dataUri;
    }

    const match = dataUri.match(/^data:([^;,]+)(?:;[^,]*)?,([\s\S]+)$/i);
    if (!match) {
      return dataUri;
    }

    const [, mimeType, payload] = match;
    const decodedPayload = decodeURIComponent(payload ?? "");
    return `data:${mimeType};base64,${Buffer.from(decodedPayload, "utf8").toString("base64")}`;
  }

  private truncateText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    const clipped = normalized.slice(0, Math.max(12, maxLength - 1));
    const wordBoundary = clipped.replace(/\s+\S*$/, "").trim();
    return `${wordBoundary || clipped.trim()}…`;
  }

  private textBudget(rect: Rect, fontSize: number, maxLines: number): number {
    const charsPerLine = Math.max(
      18,
      Math.floor((rect.w * 12.6) / Math.max(0.75, fontSize / 12)),
    );
    return charsPerLine * maxLines;
  }

  private fitText(value: string, rect: Rect, fontSize: number, maxLines: number) {
    return this.truncateText(value, this.textBudget(rect, fontSize, maxLines));
  }

  private addTextBox(
    pptSlide: PptxGenJS.Slide,
    text: string,
    rect: Rect,
    options: PptxGenJS.TextPropsOptions,
  ) {
    pptSlide.addText(text, {
      ...rect,
      margin: TEXT_MARGIN,
      breakLine: false,
      fit: "none",
      wrap: true,
      ...options,
    });
  }

  private buildNotes(slide: Slide) {
    return [
      slide.title,
      "",
      `Learning goal: ${slide.learningGoal}`,
      "",
      "Key points:",
      ...slide.keyPoints.map((point) => `- ${point}`),
      slide.examples.length ? "" : null,
      slide.examples.length ? "Examples:" : null,
      ...slide.examples.map((example) => `- ${example}`),
      slide.speakerNotes.length ? "" : null,
      slide.speakerNotes.length ? "Speaker notes:" : null,
      ...slide.speakerNotes.map((note) => `- ${note}`),
    ]
      .filter((value): value is string => typeof value === "string")
      .join("\n");
  }

  private renderBackground(
    pptx: PptxGenJS,
    pptSlide: PptxGenJS.Slide,
    accent: string,
    themeStyle: PptxThemeStyle,
    slide: Slide,
    index: number,
    totalSlides: number,
  ) {
    pptSlide.background = { color: themeStyle.background };
    pptSlide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.28,
      h: SLIDE_H,
      fill: { color: accent },
      line: { color: accent, pt: 0 },
      objectName: "ss-bg-accent",
    });
    pptSlide.addShape(pptx.ShapeType.ellipse, {
      x: 10.95,
      y: -1.05,
      w: 3.35,
      h: 3.35,
      fill: { color: accent, transparency: 82 },
      line: { color: accent, transparency: 100 },
      objectName: "ss-bg-orb",
    });
    this.addTextBox(
      pptSlide,
      `${index + 1} / ${totalSlides}`,
      { x: 11.72, y: 7.05, w: 0.9, h: 0.22 },
      {
        fontFace: "Aptos",
        fontSize: 8.5,
        color: themeStyle.muted,
        align: "right",
        objectName: "ss-text-footer",
      },
    );
    this.addTextBox(
      pptSlide,
      this.truncateText(slide.visuals.layoutTemplate.replace(/-/g, " "), 24),
      { x: SAFE_LEFT, y: 7.05, w: 2.4, h: 0.22 },
      {
        fontFace: "Aptos",
        fontSize: 8.5,
        color: themeStyle.muted,
        bold: true,
        objectName: "ss-text-template",
      },
    );
  }

  private renderHeader(
    pptSlide: PptxGenJS.Slide,
    slide: Slide,
    accent: string,
    themeStyle: PptxThemeStyle,
  ) {
    const eyebrow = this.truncateText(
      slide.visuals.eyebrow ?? slide.learningGoal,
      84,
    );
    const titleRect = { x: SAFE_LEFT, y: 0.55, w: 11.72, h: 0.64 };
    const heroRect = { x: 0.82, y: 1.28, w: 11.35, h: 0.48 };

    this.addTextBox(pptSlide, eyebrow, { x: SAFE_LEFT, y: 0.24, w: 7.9, h: 0.24 }, {
      fontFace: themeStyle.bodyFont,
      fontSize: 8.8,
      bold: true,
      charSpacing: 2,
      color: accent,
      objectName: "ss-text-eyebrow",
    });
    this.addTextBox(
      pptSlide,
      this.fitText(slide.title, titleRect, 24, 2),
      titleRect,
      {
        fontFace: themeStyle.titleFont,
        fontSize: slide.title.length > 82 ? 20 : 23,
        bold: true,
        color: themeStyle.title,
        objectName: "ss-text-title",
      },
    );
    this.addTextBox(
      pptSlide,
      this.fitText(slide.visuals.heroStatement ?? slide.learningGoal, heroRect, 13.5, 2),
      heroRect,
      {
        fontFace: themeStyle.bodyFont,
        fontSize: 13,
        color: themeStyle.body,
        objectName: "ss-text-hero",
      },
    );
  }

  private renderKeyPointRows(
    pptx: PptxGenJS,
    pptSlide: PptxGenJS.Slide,
    slide: Slide,
    rect: Rect,
    accent: string,
    themeStyle: PptxThemeStyle,
    options?: { maxRows?: number; fontSize?: number },
  ) {
    const maxRows = options?.maxRows ?? 3;
    const points = slide.keyPoints.slice(0, maxRows);
    if (points.length === 0) {
      return;
    }

    const gap = 0.16;
    const rowHeight = Math.min(
      0.86,
      (rect.h - gap * (points.length - 1)) / points.length,
    );
    const yOffset = Math.max(
      0,
      (rect.h - (rowHeight * points.length + gap * (points.length - 1))) / 2,
    );
    const fontSize = options?.fontSize ?? (rect.w < 5.5 ? 10.4 : 11.4);

    points.forEach((point, index) => {
      const y = rect.y + yOffset + index * (rowHeight + gap);
      const numberRect = { x: rect.x, y, w: 0.34, h: rowHeight };
      const pointRect = {
        x: rect.x + 0.45,
        y,
        w: rect.w - 0.45,
        h: rowHeight,
      };

      pptSlide.addShape(pptx.ShapeType.roundRect, {
        ...numberRect,
        fill: { color: accent, transparency: 86 },
        line: { color: accent, pt: 0.6, transparency: 80 },
        objectName: `ss-point-${index + 1}-mark`,
      });
      this.addTextBox(
        pptSlide,
        String(index + 1),
        numberRect,
        {
          fontFace: themeStyle.bodyFont,
          fontSize: 8.5,
          bold: true,
          align: "center",
          valign: "middle",
          color: accent,
          objectName: `ss-text-point-${index + 1}-num`,
        },
      );
      this.addTextBox(
        pptSlide,
        this.fitText(point, pointRect, fontSize, rowHeight > 0.68 ? 3 : 2),
        pointRect,
        {
          fontFace: themeStyle.bodyFont,
          fontSize,
          color: themeStyle.body,
          valign: "middle",
          breakLine: false,
          objectName: `ss-text-point-${index + 1}`,
        },
      );
    });
  }

  private renderCards(
    pptx: PptxGenJS,
    pptSlide: PptxGenJS.Slide,
    slide: Slide,
    accent: string,
    themeStyle: PptxThemeStyle,
    rect: Rect,
  ) {
    if (slide.visuals.layoutTemplate === "three-step-flow") {
      return;
    }

    const cards = slide.visuals.cards.slice(0, 3);
    if (cards.length === 0) {
      return;
    }

    const gap = 0.22;
    const cardWidth = (rect.w - gap * (cards.length - 1)) / cards.length;

    for (const [index, card] of cards.entries()) {
      const x = rect.x + index * (cardWidth + gap);
      const tone = this.toneFill(card.tone, accent, themeStyle);

      pptSlide.addShape(pptx.ShapeType.roundRect, {
        x,
        y: rect.y,
        w: cardWidth,
        h: rect.h,
        fill: this.shapeFill(tone),
        line: this.shapeLine(tone, 1.5),
        objectName: `ss-card-${index + 1}-bg`,
      });
      const titleRect = {
        x: x + 0.18,
        y: rect.y + 0.15,
        w: cardWidth - 0.36,
        h: 0.34,
      };
      const bodyRect = {
        x: x + 0.18,
        y: rect.y + 0.58,
        w: cardWidth - 0.36,
        h: rect.h - 0.72,
      };

      this.addTextBox(
        pptSlide,
        this.fitText(this.deriveCardTitle(card), titleRect, 13.5, 1),
        titleRect,
        {
          fontFace: themeStyle.titleFont,
          fontSize: 13,
          bold: true,
          color: tone.text,
          objectName: `ss-text-card-${index + 1}-title`,
        },
      );
      this.addTextBox(
        pptSlide,
        this.fitText(card.body, bodyRect, 9.6, 3),
        bodyRect,
        {
          fontFace: themeStyle.bodyFont,
          fontSize: 9.5,
          color: tone.text,
          valign: "top",
          objectName: `ss-text-card-${index + 1}-body`,
        },
      );
    }
  }

  private renderCallouts(
    pptx: PptxGenJS,
    pptSlide: PptxGenJS.Slide,
    slide: Slide,
    accent: string,
    themeStyle: PptxThemeStyle,
    rect: Rect,
  ) {
    const callouts = this.buildAudienceCallouts(slide).slice(0, 2);
    if (callouts.length === 0) {
      return;
    }

    const gap = 0.18;
    const calloutHeight = Math.min(
      0.86,
      (rect.h - gap * (callouts.length - 1)) / callouts.length,
    );

    for (const [index, callout] of callouts.entries()) {
      const y = rect.y + index * (calloutHeight + gap);
      const tone = this.toneFill(callout.tone, accent, themeStyle);

      pptSlide.addShape(pptx.ShapeType.roundRect, {
        x: rect.x,
        y,
        w: rect.w,
        h: calloutHeight,
        fill: this.shapeFill(tone),
        line: this.shapeLine(tone, 1.2),
        objectName: `ss-callout-${index + 1}-bg`,
      });
      const calloutText = `${this.truncateText(callout.label, 20)}: ${callout.text}`;
      const calloutRect = {
        x: rect.x + 0.2,
        y: y + 0.12,
        w: rect.w - 0.4,
        h: calloutHeight - 0.18,
      };

      this.addTextBox(
        pptSlide,
        this.fitText(calloutText, calloutRect, 10.2, 2),
        calloutRect,
        {
          fontFace: themeStyle.bodyFont,
          fontSize: 10,
          color: tone.text,
          bold: true,
          valign: "middle",
          objectName: `ss-text-callout-${index + 1}`,
        },
      );
    }
  }

  private renderFlow(
    pptx: PptxGenJS,
    pptSlide: PptxGenJS.Slide,
    slide: Slide,
    accent: string,
    themeStyle: PptxThemeStyle,
    rect: Rect,
  ) {
    const nodes = slide.visuals.diagramNodes.slice(0, 3);
    if (slide.visuals.layoutTemplate !== "three-step-flow" || nodes.length === 0) {
      return;
    }

    const arrowWidth = nodes.length > 1 ? 0.34 : 0;
    const gap = nodes.length > 1 ? 0.22 : 0;
    const width = (rect.w - (nodes.length - 1) * (gap * 2 + arrowWidth)) / nodes.length;

    for (const [index, node] of nodes.entries()) {
      const x = rect.x + index * (width + gap * 2 + arrowWidth);
      const tone = this.toneFill(node.tone, accent, themeStyle);

      pptSlide.addShape(pptx.ShapeType.roundRect, {
        x,
        y: rect.y,
        w: width,
        h: rect.h,
        fill: this.shapeFill(tone),
        line: this.shapeLine(tone, 1.3),
        objectName: `ss-flow-${index + 1}-bg`,
      });
      const nodeRect = {
        x: x + 0.14,
        y: rect.y + 0.2,
        w: width - 0.28,
        h: rect.h - 0.3,
      };

      this.addTextBox(
        pptSlide,
        this.fitText(node.label, nodeRect, 12.5, 2),
        nodeRect,
        {
          fontFace: themeStyle.titleFont,
          fontSize: 12,
          align: "center",
          bold: true,
          color: tone.text,
          valign: "middle",
          objectName: `ss-text-flow-${index + 1}`,
        },
      );

      if (index < nodes.length - 1) {
        this.addTextBox(
          pptSlide,
          "→",
          {
            x: x + width + gap,
            y: rect.y + 0.26,
            w: arrowWidth,
            h: rect.h - 0.35,
          },
          {
            fontSize: 19,
            bold: true,
            color: accent,
            align: "center",
            valign: "middle",
            objectName: `ss-text-flow-arrow-${index + 1}`,
          },
        );
      }
    }
  }

  private renderIllustration(pptSlide: PptxGenJS.Slide, slide: Slide, rect: Rect) {
    const illustration = getPrimarySlideIllustration(slide);
    if (!illustration) {
      return;
    }

    pptSlide.addImage({
      data: this.normalizeImageDataForPptx(illustration.dataUri),
      ...rect,
      objectName: "ss-image-primary",
    });
  }

  private renderBody(
    pptx: PptxGenJS,
    pptSlide: PptxGenJS.Slide,
    slide: Slide,
    accent: string,
    themeStyle: PptxThemeStyle,
  ) {
    const illustration = getPrimarySlideIllustration(slide);
    const cards = slide.visuals.cards.slice(0, 3);
    const callouts = this.buildAudienceCallouts(slide).slice(0, 2);
    const hasFlow =
      slide.visuals.layoutTemplate === "three-step-flow" &&
      slide.visuals.diagramNodes.length > 0;
    const contentRect = {
      x: 0.82,
      y: CONTENT_TOP,
      w: SAFE_RIGHT - 0.82,
      h: CONTENT_BOTTOM - CONTENT_TOP,
    };

    if (illustration) {
      const imageRect = { x: 8.2, y: CONTENT_TOP + 0.08, w: 4.18, h: 3.3 };
      const pointRect = { x: 0.82, y: CONTENT_TOP + 0.18, w: 6.72, h: 3.42 };
      this.renderIllustration(pptSlide, slide, imageRect);
      this.renderKeyPointRows(
        pptx,
        pptSlide,
        slide,
        pointRect,
        accent,
        themeStyle,
        {
          fontSize: 10.8,
        },
      );
      return;
    }

    if (hasFlow) {
      this.renderFlow(pptx, pptSlide, slide, accent, themeStyle, {
        x: 0.9,
        y: CONTENT_TOP + 0.16,
        w: 11.62,
        h: 0.95,
      });
      this.renderKeyPointRows(
        pptx,
        pptSlide,
        slide,
        { x: 1.05, y: 3.52, w: 10.95, h: 2.52 },
        accent,
        themeStyle,
      );
      return;
    }

    if (cards.length >= 2) {
      this.renderCards(pptx, pptSlide, slide, accent, themeStyle, {
        x: 0.86,
        y: CONTENT_TOP + 0.05,
        w: 11.74,
        h: 1.55,
      });
      this.renderKeyPointRows(
        pptx,
        pptSlide,
        slide,
        { x: 1.06, y: 4.05, w: 10.9, h: 2.0 },
        accent,
        themeStyle,
      );
      return;
    }

    if (callouts.length > 0) {
      this.renderCallouts(pptx, pptSlide, slide, accent, themeStyle, {
        x: 0.9,
        y: CONTENT_TOP + 0.05,
        w: 11.55,
        h: callouts.length > 1 ? 1.9 : 0.9,
      });
      this.renderKeyPointRows(
        pptx,
        pptSlide,
        slide,
        {
          x: 1.06,
          y: callouts.length > 1 ? 4.15 : 3.35,
          w: 10.9,
          h: callouts.length > 1 ? 1.95 : 2.6,
        },
        accent,
        themeStyle,
      );
      return;
    }

    this.renderKeyPointRows(
      pptx,
      pptSlide,
      slide,
      contentRect,
      accent,
      themeStyle,
      {
        fontSize: 12.2,
      },
    );
  }

  async exportToPptx(deck: Deck, outputPath: string): Promise<string> {
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "SlideSpeech";
    pptx.subject = deck.topic;
    pptx.title = deck.title;

    const theme = resolvePresentationTheme(
      deck.metadata.theme,
      `${deck.id}:${deck.topic}`,
    );
    const themeStyle = this.resolveThemeStyle(theme);

    for (const [index, slide] of deck.slides.entries()) {
      const pptSlide = pptx.addSlide();
      const accent = this.normalizeColor(slide.visuals.accentColor, themeStyle.accent);

      this.renderBackground(
        pptx,
        pptSlide,
        accent,
        themeStyle,
        slide,
        index,
        deck.slides.length,
      );
      this.renderHeader(pptSlide, slide, accent, themeStyle);
      this.renderBody(pptx, pptSlide, slide, accent, themeStyle);
      pptSlide.addNotes(this.buildNotes(slide));
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
