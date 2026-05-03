import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PptxGenJSDeckExporter } from "@slidespeech/providers";
import { DeckSchema, type Deck } from "@slidespeech/types";
import JSZip from "jszip";

type Bounds = {
  h: number;
  name: string;
  slide: string;
  w: number;
  x: number;
  y: number;
};

const EMUS_PER_INCH = 914_400;
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;

const makeDeck = (): Deck =>
  DeckSchema.parse({
    id: "deck_pptx_layout_regression",
    title: "PowerPoint Export Layout Regression",
    topic: "System Verification presentation quality",
    summary:
      "A deliberately dense deck used to catch overlapping PowerPoint export layers.",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "clear and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "System Verification presentation quality",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_cards",
        order: 0,
        title:
          "How System Verification turns quality assurance into a practical operating model for distributed product teams",
        learningGoal:
          "Understand how cards, hero text, key points, and dense supporting copy fit without colliding in an exported PowerPoint slide.",
        keyPoints: [
          "Discovery work identifies the audience, source material, and decisions the presenter needs to make before the session.",
          "The generated deck should keep the main message visible while moving secondary details into speaker notes.",
          "The PowerPoint export must remain editable without text boxes being stacked on top of each other.",
        ],
        beginnerExplanation:
          "The export should look like a structured slide, not like several browser layers pasted in the same space.",
        advancedExplanation:
          "The regression checks OOXML drawing coordinates for named text boxes after pptxgenjs serializes the file.",
        examples: ["Cards should sit above key point rows with clear spacing."],
        speakerNotes: ["Longer content belongs in speaker notes when the visible slide is full."],
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          eyebrow: "Dense card layout",
          heroStatement:
            "A visually busy generated slide should still reserve separate regions for title, hero, cards, key points, and footer.",
          cards: [
            {
              id: "card_1",
              title: "Source grounding",
              body: "Relevant source material is selected before writing the slide so the visible claims remain anchored.",
              tone: "accent",
            },
            {
              id: "card_2",
              title: "Narration",
              body: "Presenter notes keep the complete spoken story even when the slide itself needs concise text.",
              tone: "info",
            },
            {
              id: "card_3",
              title: "Export",
              body: "PowerPoint output must use reserved regions instead of layering every visual component at fixed coordinates.",
              tone: "success",
            },
          ],
          callouts: [
            {
              id: "callout_1",
              label: "Risk",
              text: "Old exports could place callouts, images, key points, and flow diagrams in the same vertical band.",
              tone: "warning",
            },
          ],
          diagramNodes: [
            { id: "node_1", label: "Research", tone: "accent" },
            { id: "node_2", label: "Deck", tone: "info" },
          ],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_flow",
        order: 1,
        title:
          "A three step flow with long labels should leave room for supporting explanation rows",
        learningGoal:
          "Verify that flow nodes, arrows, key point rows, and footer text occupy different PowerPoint regions.",
        keyPoints: [
          "Flow diagrams are useful when the slide explains a sequence, but they should not consume the whole slide.",
          "Supporting points need their own row-based area below the diagram rather than sharing the diagram coordinates.",
          "Each generated text object gets a predictable name so the exported PPTX can be inspected automatically.",
        ],
        beginnerExplanation:
          "A flow slide should show the sequence first and the explanation below it.",
        advancedExplanation:
          "The exporter should choose a primary layout mode instead of rendering all possible visual systems.",
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "3454D1",
          eyebrow: "Flow layout",
          heroStatement:
            "Flow slides need a compact diagram band plus a separate explanation band.",
          cards: [
            {
              id: "card_unused",
              title: "Should not collide",
              body: "This card exists to ensure flow mode does not also render card rows into the same slide space.",
              tone: "neutral",
            },
          ],
          callouts: [
            {
              id: "callout_unused",
              label: "Note",
              text: "Flow mode should prioritize the diagram and key rows.",
              tone: "info",
            },
          ],
          diagramNodes: [
            {
              id: "node_1",
              label: "Classify the request and source material",
              tone: "accent",
            },
            {
              id: "node_2",
              label: "Generate a structured deck plan",
              tone: "info",
            },
            {
              id: "node_3",
              label: "Export editable PowerPoint slides",
              tone: "success",
            },
          ],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_image",
        order: 2,
        title:
          "A slide with a primary image should use a two column layout rather than placing text across the picture",
        learningGoal:
          "Confirm that image slides reserve separate horizontal space for the generated visual and text rows.",
        keyPoints: [
          "The image belongs in the right column with a fixed boundary.",
          "The key points belong in the left column with enough vertical separation.",
          "Cards and callouts should not be layered over the image in this export mode.",
        ],
        beginnerExplanation:
          "Text and image should sit next to each other, not on top of each other.",
        advancedExplanation:
          "The exporter detects the primary illustration and switches to a two-column layout branch.",
        visuals: {
          layoutTemplate: "two-column-callouts",
          accentColor: "B45309",
          eyebrow: "Image layout",
          heroStatement:
            "Image slides need a strict two-column export so text remains readable in PowerPoint.",
          cards: [
            {
              id: "card_unused_image",
              title: "Not over image",
              body: "This should not be drawn on top of the primary image.",
              tone: "warning",
            },
          ],
          callouts: [
            {
              id: "callout_unused_image",
              label: "Avoid",
              text: "Do not place this callout over the generated image.",
              tone: "warning",
            },
          ],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [
            {
              id: "image_primary",
              prompt: "A clean editorial illustration of a presenter reviewing a quality dashboard.",
              caption: "Presenter reviewing quality signals.",
              altText: "Quality dashboard illustration",
              style: "editorial",
              tone: "accent",
            },
          ],
        },
      },
    ],
    createdAt: "2026-04-26T10:00:00.000Z",
    updatedAt: "2026-04-26T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 4,
      tags: ["regression"],
      language: "en",
    },
  });

const extractNamedTextBounds = (xml: string, slide: string): Bounds[] => {
  const bounds: Bounds[] = [];
  const shapeMatches = xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g);

  for (const shapeMatch of shapeMatches) {
    const shape = shapeMatch[1] ?? "";
    const name = shape.match(/<p:cNvPr[^>]*\bname="([^"]+)"/)?.[1];
    if (!name?.startsWith("ss-text-")) {
      continue;
    }

    const offset = shape.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
    const extent = shape.match(/<a:ext cx="(-?\d+)" cy="(-?\d+)"/);
    assert.ok(offset, `Missing position for ${name} in ${slide}`);
    assert.ok(extent, `Missing extent for ${name} in ${slide}`);

    bounds.push({
      name,
      slide,
      x: Number(offset[1]) / EMUS_PER_INCH,
      y: Number(offset[2]) / EMUS_PER_INCH,
      w: Number(extent[1]) / EMUS_PER_INCH,
      h: Number(extent[2]) / EMUS_PER_INCH,
    });
  }

  return bounds;
};

const overlaps = (a: Bounds, b: Bounds): boolean => {
  const epsilon = 0.015;
  return (
    a.x < b.x + b.w - epsilon &&
    a.x + a.w > b.x + epsilon &&
    a.y < b.y + b.h - epsilon &&
    a.y + a.h > b.y + epsilon
  );
};

test("PowerPoint export keeps generated text boxes in non-overlapping slide regions", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "slidespeech-pptx-"));
  const outputPath = join(outputDir, "layout-regression.pptx");

  try {
    await new PptxGenJSDeckExporter().exportToPptx(makeDeck(), outputPath);

    const zip = await JSZip.loadAsync(await readFile(outputPath));
    const slidePaths = Object.keys(zip.files)
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    assert.equal(slidePaths.length, 3);

    for (const slidePath of slidePaths) {
      const slideXml = await zip.file(slidePath)?.async("string");
      assert.ok(slideXml, `Missing ${slidePath}`);

      const textBoxes = extractNamedTextBounds(slideXml, slidePath);
      assert.ok(textBoxes.length >= 6, `Expected named text boxes in ${slidePath}`);

      for (const box of textBoxes) {
        assert.ok(box.x >= 0, `${box.name} starts before slide left edge`);
        assert.ok(box.y >= 0, `${box.name} starts above slide top edge`);
        assert.ok(box.x + box.w <= SLIDE_W + 0.02, `${box.name} exceeds slide width`);
        assert.ok(box.y + box.h <= SLIDE_H + 0.02, `${box.name} exceeds slide height`);
      }

      for (let i = 0; i < textBoxes.length; i += 1) {
        const current = textBoxes[i];
        assert.ok(current);
        for (const candidate of textBoxes.slice(i + 1)) {
          assert.equal(
            overlaps(current, candidate),
            false,
            `${current.name} overlaps ${candidate.name} in ${slidePath}`,
          );
        }
      }
    }
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
