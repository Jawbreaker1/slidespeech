import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { SLIDE_LAYOUTS, SLIDE_THEMES, PRESENTATION_THEME_IDS, createSlideLayoutFrame, createDesignDecisionSchema, SlideDesignSpecSetSchema } from "@slidespeech/types";
import { createSlidePreviewRenderer } from "@slidespeech/providers";
import { renderSlideScenesToPptx } from "../packages/providers/src/generation-v2/slide-scene-pptx";
import { varietyProof } from "./fixtures/slide-variety-proof";

test("all 20 compositions in all three themes provide bounded non-overlapping text and image frames", () => {
  assert.equal(SLIDE_LAYOUTS.length, 20);
  assert.equal(new Set(SLIDE_LAYOUTS.map(layout => layout.id)).size, 20);
  for (const theme of PRESENTATION_THEME_IDS) for (const layout of SLIDE_LAYOUTS) for (let items = 1; items <= layout.maximumItems; items++) {
    const { design } = varietyProof(layout, theme);
    const frame = createSlideLayoutFrame(design, { steps: items, leftItems: items, rightItems: items });
    for (const element of frame.elements) {
      assert.ok(element.x >= 0 && element.y >= 0 && element.width > 0 && element.height > 0);
      assert.ok(element.x + element.width <= 1280 && element.y + element.height <= 720, `${theme}/${layout.id} out of canvas`);
    }
    const content = frame.elements.filter(element => element.kind !== "rectangle");
    content.forEach((a, index) => content.slice(index + 1).forEach(b => {
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${theme}/${layout.id} has overlapping content frames`);
    }));
  }
});

test("theme-resolved writing contracts and measured export retain the actual colors and font choices", async () => {
  const renderer = await createSlidePreviewRenderer();
  const scenes = [];
  for (const theme of PRESENTATION_THEME_IDS) for (const layout of SLIDE_LAYOUTS.filter(layout => !layout.image)) {
    const { draft, design } = varietyProof(layout, theme);
    const contract = renderer.describe(design);
    const rendered = renderer(draft, design);
    assert.ok(rendered.scene, `${theme}/${layout.id}: ${rendered.feedback?.join("; ")}`);
    for (const element of rendered.scene.elements.filter(element => element.kind === "text" && element.contentPath)) {
      const field = contract.fields.find(field => JSON.stringify(field.path) === JSON.stringify(element.contentPath));
      assert.ok(field);
      assert.equal(field.font, element.font);
      assert.equal(field.size, element.size);
      assert.ok(field.maximumLines > 0);
    }
    const heading = rendered.scene.elements.find(element => element.kind === "text" && element.contentPath?.[0] === "title");
    assert.ok(heading?.kind === "text");
    assert.equal(heading.font, SLIDE_THEMES[theme].heading === "sans" ? "Source Sans 3" : "Source Serif 4");
    assert.equal(rendered.scene.background, (layout.cover ? SLIDE_THEMES[theme].cover : SLIDE_THEMES[theme].page).background);
    scenes.push(rendered.scene);
  }
  const zip = await JSZip.loadAsync(await renderSlideScenesToPptx(scenes));
  for (let i = 0; i < scenes.length; i++) {
    const xml = await zip.file(`ppt/slides/slide${i + 1}.xml`)!.async("string");
    assert.ok(xml.includes(scenes[i]!.background));
    for (const text of scenes[i]!.elements.filter(element => element.kind === "text")) {
      assert.ok(xml.includes(`typeface="${text.font}"`));
      assert.ok(xml.includes(text.color));
    }
  }
});

test("design systems differ structurally even without colors and typefaces", () => {
  for (const layout of SLIDE_LAYOUTS) {
    const silhouettes = PRESENTATION_THEME_IDS.map(theme => {
      const { design } = varietyProof(layout, theme);
      return JSON.stringify(createSlideLayoutFrame(design).elements.filter(element => element.kind !== "rectangle").map(element => ({
        kind: element.kind, x: element.x, y: element.y, width: element.width, height: element.height,
        ...(element.kind === "text" ? { binding: element.contentPath ?? element.fixedText, size: element.size } : {}),
      })));
    });
    assert.equal(new Set(silhouettes).size, PRESENTATION_THEME_IDS.length, `${layout.id} is only a palette variant`);
  }
});

test("theme selection is explicit for new decisions, honors the user and stays coherent", () => {
  const choice = { themeId: "signal", designs: [{ layoutId: "title-banner", contentDensity: "sparse", visualRole: "hero" }] };
  assert.ok(createDesignDecisionSchema(1).safeParse(choice).success);
  assert.ok(!createDesignDecisionSchema(1).safeParse({ designs: choice.designs }).success);
  assert.ok(!createDesignDecisionSchema(1, [], [], "paper").safeParse(choice).success);
  assert.ok(createDesignDecisionSchema(1, [], [], "signal").safeParse(choice).success);
  for (const layout of SLIDE_LAYOUTS.filter(layout => layout.image)) assert.ok(!createDesignDecisionSchema(1).safeParse({ ...choice, designs: [{ ...choice.designs[0], layoutId: layout.id }] }).success);
  const designs = [varietyProof(SLIDE_LAYOUTS[0], "paper").design, varietyProof(SLIDE_LAYOUTS[5], "signal").design];
  const artifact = { schemaVersion: "2.0", artifactId: "design_fixture", createdAt: new Date().toISOString(), deckStrategyArtifactId: "strategy_fixture", slidePlanSetArtifactId: "plans_fixture", designs };
  assert.ok(SlideDesignSpecSetSchema.safeParse({ ...artifact, designs: designs.map(design => ({ ...design, themeId: "paper" })) }).success);
  assert.ok(!SlideDesignSpecSetSchema.safeParse(artifact).success);
});
