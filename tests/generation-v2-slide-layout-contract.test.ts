import assert from "node:assert/strict";
import test from "node:test";
import { createSlideLayoutFrame } from "@slidespeech/types";
import { createSlidePreviewRenderer } from "@slidespeech/providers";
import { slideDesignProof } from "./fixtures/slide-design-proof";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideSceneCanvas } from "../packages/ui/src/slide-scene-canvas";

test("writing contracts use the same frames and actual fonts as rendering", async () => {
  const renderer = await createSlidePreviewRenderer();
  for (const { design } of slideDesignProof) {
    const contract = renderer.describe(design);
    const frame = createSlideLayoutFrame(design, {}, { heading: "Source Serif 4", body: "Source Sans 3" });
    const fields = frame.elements.filter((element) => element.kind === "text" && element.contentPath);
    assert.equal(contract.fields.length, fields.length);
    contract.fields.forEach((field, index) => {
      const box = fields[index]!;
      assert.equal(box.kind, "text");
      if (box.kind !== "text") return;
      assert.deepEqual(field.path, box.contentPath);
      assert.deepEqual([field.width, field.height, field.font, field.size], [box.width, box.height, box.font, box.size]);
      assert.equal(field.maximumLines, Math.floor(field.height / field.lineHeight));
      assert.ok(field.maximumLines >= 1);
      assert.equal(field.fontIdentity.length, 64);
    });
  }
});

test("a process label advertises its real one-line capacity without enlarging the slot", async () => {
  const renderer = await createSlidePreviewRenderer();
  const process = slideDesignProof.find((proof) => proof.draft.content.kind === "process")!;
  const field = renderer.describe(process.design).fields.find((field) => field.path.join(".") === "content.steps.0.label")!;
  assert.equal(field.height, 68);
  assert.equal(field.maximumLines, 1);
  assert.ok(field.lineHeight * 2 > field.height);
  const result = renderer({ ...process.draft, content: { kind: "process", steps: [{ label: "First\nSecond", description: "One short explanation." }] } }, process.design);
  assert.ok(result.feedback?.some((feedback) => feedback.includes('["content","steps",0,"label"]') && feedback.includes("height-overflow")));
});

test("full shared fonts preserve scientific subscripts and multilingual letters without rewriting", async () => {
  const renderer = await createSlidePreviewRenderer();
  const { draft, design } = slideDesignProof[0]!;
  const statement = "CO₂ / H₂O / Västra Götaland";
  const result = renderer({ ...draft, title: "Material", content: { kind: "statement", statement } }, design);
  assert.ok(result.scene);
  assert.ok(result.scene.elements.some((element) => element.kind === "text" && element.text === statement));
});

test("unsupported scripts are an explicit font limitation, never an author rewrite instruction", async () => {
  const renderer = await createSlidePreviewRenderer();
  const { draft, design } = slideDesignProof[0]!;
  assert.throws(() => renderer({ ...draft, title: "日本語" }, design), /unsupported-glyph/);
});

test("SVG quotes font names so numeric family names cannot silently fall back", async () => {
  const renderer = await createSlidePreviewRenderer();
  const { draft, design } = slideDesignProof[0]!;
  const result = renderer(draft, design);
  assert.ok(result.scene);
  const markup = renderToStaticMarkup(createElement(SlideSceneCanvas, { scene: result.scene }));
  assert.ok(markup.includes('font-family="&quot;Source Serif 4&quot;"'));
  assert.ok(markup.includes('font-family="&quot;Source Sans 3&quot;"'));
});
