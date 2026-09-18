import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import { composeSlideScene, SLIDE_CANVAS } from "@slidespeech/types";
import { renderSlideScenesToPptx } from "../packages/providers/src/generation-v2/slide-scene-pptx";
import { slideDesignProof } from "./fixtures/slide-design-proof";
import { prepareTestScene } from "./fixtures/slide-test-font";

test("PPTX refuses scenes whose text has not been measured", async () => {
  // @ts-expect-error Deliberately exercise the runtime boundary without measurement.
  await assert.rejects(() => renderSlideScenesToPptx([slideDesignProof[0]!.scene]), /text layout/i);
});

test("every initial layout stays inside the same 16:9 coordinate system", () => {
  assert.equal(slideDesignProof.length, 6);
  for (const { scene } of slideDesignProof) for (const box of scene.elements) {
    assert.ok(box.x >= 0 && box.y >= 0);
    assert.ok(box.width > 0 && box.height > 0);
    assert.ok(box.x + box.width <= SLIDE_CANVAS.width);
    assert.ok(box.y + box.height <= SLIDE_CANVAS.height);
  }
});

test("layout mismatch, excessive item count and unsupported images fail without fallback", () => {
  const { draft, design } = slideDesignProof[0]!;
  assert.throws(() => composeSlideScene(draft, { ...design, layoutId: "unknown" }));
  assert.throws(() => composeSlideScene(draft, { ...design, layoutFamily: "comparison" }));
  assert.throws(() => composeSlideScene(draft, { ...design, slideId: "different_slide" }));
  assert.throws(() => composeSlideScene(draft, { ...design, imageStrategy: "source-image" }));
  const process = slideDesignProof[3]!;
  assert.throws(() => composeSlideScene({ ...process.draft, content: { kind: "process", steps: Array.from({ length: 5 }, () => ({ label: "Step", description: "Detail" })) } }, process.design));
});

test("renderer preserves multilingual content and never derives or replaces text", () => {
  const { draft, design } = slideDesignProof[0]!;
  const content = { kind: "statement" as const, statement: "Västra Götaland / 日本語 / العربية", supportingText: "A < B & C > D" };
  const scene = composeSlideScene({ ...draft, content }, design);
  const texts = scene.elements.filter((element) => element.kind === "text").map((element) => element.text);
  assert.deepEqual(texts, [draft.title, content.statement, content.supportingText]);
});

test("source labels remain visible and full references are retained in notes", () => {
  const { draft, design } = slideDesignProof[0]!;
  const scene = composeSlideScene({ ...draft, sourceAttributions: [{ sourceId: "source_1", label: "Original source", url: "https://example.test/source" }] }, design);
  assert.ok(scene.elements.some((element) => element.kind === "text" && element.text === "Original source"));
  assert.ok(scene.speakerNotes.includes("Original source: https://example.test/source"));
});

test("PPTX content-type declarations must resolve to package parts", async () => {
  const zip = await JSZip.loadAsync(await renderSlideScenesToPptx(slideDesignProof.map(({ scene }) => prepareTestScene(scene))));
  const xml = await zip.file("[Content_Types].xml")!.async("string");
  for (const match of xml.matchAll(/PartName="\/([^"]+)"/g)) assert.ok(zip.file(match[1]!), `Missing package part: ${match[1]}`);
});

test("shared master registration remains valid with custom layouts and different slide counts", async () => {
  for (const count of [1, 2, 8]) {
    const pptx = new PptxGenJS();
    pptx.defineSlideMaster({ title: "light", background: { color: "FFFFFF" }, objects: [] });
    pptx.defineSlideMaster({ title: "dark", background: { color: "193E35" }, objects: [] });
    for (let index = 0; index < count; index++) pptx.addSlide({ masterName: index % 2 ? "dark" : "light" });
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: "nodebuffer" }) as Buffer);
    const types = await zip.file("[Content_Types].xml")!.async("string");
    const parts = [...types.matchAll(/PartName="\/([^"]+)"/g)].map((match) => match[1]!);
    assert.equal(new Set(parts).size, parts.length, "Duplicate content-type declarations");
    for (const part of parts) assert.ok(zip.file(part), `Missing package part: ${part}`);
    assert.deepEqual(parts.filter((part) => part.startsWith("ppt/slideMasters/")), ["ppt/slideMasters/slideMaster1.xml"]);
    assert.ok(zip.file("ppt/slideLayouts/slideLayout2.xml"));
  }
});

test("native PPTX uses shared coordinates, editable text and speaker notes", async () => {
  const scenes = slideDesignProof.map(({ scene }) => prepareTestScene(scene));
  const zip = await JSZip.loadAsync(await renderSlideScenesToPptx(scenes));
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  assert.ok(presentation.includes('cx="12192000" cy="6858000"'));
  for (let index = 0; index < slideDesignProof.length; index++) {
    const xml = await zip.file(`ppt/slides/slide${index + 1}.xml`)!.async("string");
    for (const element of scenes[index]!.elements) {
      if (element.kind === "rectangle") {
        assert.ok(xml.includes(`x="${Math.round(element.x * 9525)}" y="${Math.round(element.y * 9525)}"`));
        assert.ok(xml.includes(`cx="${Math.round(element.width * 9525)}" cy="${Math.round(element.height * 9525)}"`));
      } else {
        assert.ok(xml.includes(`sz="${Math.round(element.size * 75)}"`));
        for (const line of element.textLayout.lines.filter((line) => line.text)) {
          assert.ok(xml.includes(`x="${Math.round((element.x + line.xOffset) * 9525)}" y="${Math.round((element.y + line.top) * 9525)}"`));
          assert.ok(xml.includes(`cx="${Math.round((element.width - line.xOffset) * 9525)}" cy="${Math.round(line.height * 9525)}"`));
        }
      }
    }
    assert.ok(xml.includes('typeface="Source Sans 3"'));
    assert.ok(xml.includes('wrap="none"'));
    assert.ok(await zip.file(`ppt/notesSlides/notesSlide${index + 1}.xml`)!.async("string"));
  }
});
