import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { create } from "fontkit";
import { assertSlideTextLayout, type LaidOutSlideScene, type SlideScene, type SlideTextElement } from "@slidespeech/types";
import { createSlideTextLayouter, SlideTextFitError } from "../packages/providers/src/generation-v2/slide-text-layout";
import { renderSlideScenesToPptx } from "../packages/providers/src/generation-v2/slide-scene-pptx";
import { SlideSceneCanvas } from "../packages/ui/src/slide-scene-canvas";
import { layoutWithTestFont, testFont } from "./fixtures/slide-test-font";

const scene = (text: string, changes: Partial<SlideTextElement> = {}): SlideScene => ({
  slideId: "text_fit", title: "Typography test", background: "FFFFFF", speakerNotes: ["Original notes"],
  elements: [{ kind: "text", text, x: 20, y: 20, width: 200, height: 600, size: 24, color: "193E35", bold: false, font: testFont.family, ...changes }],
});
const firstText = (value: LaidOutSlideScene) => {
  const element = value.elements[0]!;
  assert.equal(element.kind, "text");
  if (element.kind !== "text") throw new Error("Expected text");
  return element;
};
const hasIssue = (code: string) => (error: unknown) => error instanceof SlideTextFitError && error.issues.some((issue) => issue.code === code);

test("real font metrics, not character counts, decide whether text fits", () => {
  const narrow = firstText(layoutWithTestFont(scene("iiiiiiiiii", { width: 100, height: 40 })));
  assert.ok(narrow.textLayout.lines[0]!.width < 100);
  assert.throws(() => layoutWithTestFont(scene("WWWWWWWWWW", { width: 100, height: 40 })), hasIssue("width-overflow"));
  const font = create(Buffer.from(testFont.data));
  assert.ok("layout" in font);
  if (!("layout" in font)) throw new Error("Expected single font");
  const expected = font.layout("iiiiiiiiii").advanceWidth * 24 / font.unitsPerEm;
  assert.equal(narrow.textLayout.lines[0]!.width, expected);
});

test("wrapping retains exact source, punctuation, accents, blank lines and notes", () => {
  for (const value of ["Västra Götaland, café français, mañana.", "  First  sentence.\n\nSecond sentence.\n", "One\r\nTwo", "", "\n", "e\u0301cole", "one\u2028two", "one\u0085two\u0085"]) {
    const input = scene(value);
    const original = structuredClone(input);
    const output = layoutWithTestFont(input);
    const text = firstText(output);
    assert.equal(text.text, value);
    assert.equal(text.textLayout.lines.map((line) => line.source).join(""), value);
    assert.deepEqual(input, original);
    assert.deepEqual(output.speakerNotes, original.speakerNotes);
    assertSlideTextLayout(output);
  }
  assert.deepEqual(firstText(layoutWithTestFont(scene("one\n\ntwo\n"))).textLayout.lines.map((line) => line.text), ["one", "", "two", ""]);
});

test("no-break spaces and long unbreakable terms are not split to conceal overflow", () => {
  assert.throws(() => layoutWithTestFont(scene("words\u00a0stay\u00a0together", { width: 60 })), hasIssue("width-overflow"));
});

test("overflow has owning slide/box diagnostics and never shrinks or truncates copy", () => {
  const input = scene("A complete thought with more material than one short line can accommodate.", { width: 120, height: 40 });
  const original = structuredClone(input);
  assert.throws(() => layoutWithTestFont(input), (error: unknown) => {
    assert.ok(error instanceof SlideTextFitError);
    assert.ok(error.issues.some((issue) => issue.code === "height-overflow" && issue.slideId === input.slideId && issue.elementIndex === 0));
    return true;
  });
  assert.deepEqual(input, original);
});

test("absent fonts, weights and missing glyphs cannot use implicit substitutes", () => {
  assert.throws(() => layoutWithTestFont(scene("Hello", { font: "Not installed" })), hasIssue("font-unavailable"));
  assert.throws(() => layoutWithTestFont(scene("Hello", { bold: true })), hasIssue("font-unavailable"));
  assert.throws(() => layoutWithTestFont(scene("日本語")), hasIssue("unsupported-glyph"));
  assert.throws(() => createSlideTextLayouter([{ ...testFont, family: "Wrong family" }]));
  assert.throws(() => createSlideTextLayouter([testFont, testFont]));
  assert.throws(() => createSlideTextLayouter([{ ...testFont, data: new Uint8Array([1, 2, 3]) }]));
});

test("font identity records the inspected asset and stale copy/style cannot render", async () => {
  const result = layoutWithTestFont(scene("A measured sentence."));
  assert.equal(firstText(result).textLayout.fontIdentity.length, 64);
  for (const change of [{ text: "Changed" }, { size: 45 }, { font: "Other" }, { width: 20 }, { height: 10 }, { bold: true }]) {
    const stale = structuredClone(result);
    Object.assign(stale.elements[0]!, change);
    assert.throws(() => renderToStaticMarkup(createElement(SlideSceneCanvas, { scene: stale })), /text layout/);
    await assert.rejects(() => renderSlideScenesToPptx([stale]), /text layout/);
  }
});

test("both renderers use the measured lines without independent text wrapping", async () => {
  const result = layoutWithTestFont(scene("Every sentence keeps its own meaning and stays readable."));
  const lines = firstText(result).textLayout.lines;
  assert.ok(lines.length > 1);
  const html = renderToStaticMarkup(createElement(SlideSceneCanvas, { scene: result }));
  assert.ok(!html.includes("foreignObject"));
  for (const line of lines) assert.ok(html.includes(`>${line.text}</text>`));
  const zip = await JSZip.loadAsync(await renderSlideScenesToPptx([result]));
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  for (const line of lines) assert.ok(xml.includes(`<a:t>${line.text}</a:t>`));
  assert.equal([...xml.matchAll(/wrap="none"/g)].length, lines.length);
  assert.equal([...xml.matchAll(/<a:spAutoFit/g)].length, 0);
});

test("invalid numeric geometry fails rather than accepting NaN or Infinity", () => {
  for (const changes of [{ size: NaN }, { width: Infinity }, { height: -1 }, { x: -10 }, { y: 700 }]) {
    assert.throws(() => layoutWithTestFont(scene("Words", changes)));
  }
});
