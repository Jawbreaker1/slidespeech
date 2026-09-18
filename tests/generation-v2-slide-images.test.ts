import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import JSZip from "jszip";
import { composeSlideScene, createDesignDecisionSchema, PRESENTATION_THEME_IDS, type SlideImageAsset } from "@slidespeech/types";
import { normalizeSlideImage, SourceSlideImageProvider } from "../packages/providers/src/generation-v2/slide-image-provider";
import { assertPublicResearchUrl, createPublicResearchLookup, isPublicResearchAddress, fetchPublicResearch, readBoundedResearchBytes } from "../packages/providers/src/generation-v2/public-research-transport";
import { createSlidePreviewRenderer } from "../packages/providers/src/generation-v2/slide-preview-renderer";
import { renderSlideScenesToPptx } from "../packages/providers/src/generation-v2/slide-scene-pptx";
import { SlideSceneCanvas } from "../packages/ui/src/slide-scene-canvas";
import { slideDesignProof } from "./fixtures/slide-design-proof";
import { StructuredGenerationClient } from "../packages/providers/src/generation-v2/structured-generation-client";

test("public address policy rejects private, mapped, special and non-HTTP destinations", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:7f00:1", "::ffff:192.168.1.1", "fc00::1", "fe80::1", "2001:db8::1", "224.0.0.1"]) assert.equal(isPublicResearchAddress(address), false, address);
  assert.equal(isPublicResearchAddress("93.184.216.34"), true);
  assert.equal(isPublicResearchAddress("2606:4700:4700::1111"), true);
  for (const url of ["file:///etc/passwd", "https://name:password@example.com", "http://[::ffff:7f00:1]/", "http://2130706433/"]) assert.throws(() => assertPublicResearchUrl(url));
});

test("the connection resolver rejects rebinding on each new lookup", async () => {
  let calls = 0;
  const lookup = createPublicResearchLookup((async () => [{ address: ++calls === 1 ? "93.184.216.34" : "127.0.0.1", family: 4 }]) as any);
  const connect = () => new Promise((resolve, reject) => lookup("example.test", { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)));
  assert.deepEqual(await connect(), [{ address: "93.184.216.34", family: 4 }]);
  await assert.rejects(connect(), /public/);
  assert.equal(calls, 2);
});

test("redirects cannot escape the public socket policy and response bytes are bounded", async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.ok(options.dispatcher);
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 302, headers: { location: "http://127.0.0.1/private" } });
  });
  await assert.rejects(fetchPublicResearch("https://example.test"), /Non-public/);
  assert.equal(cancelled, true);
  await assert.rejects(readBoundedResearchBytes(new Response(new Uint8Array(11)), 10), /byte limit/);
});

async function pixels() {
  return normalizeSlideImage(await sharp({ create: { width: 800, height: 400, channels: 3, background: "#19735c" } }).png().toBuffer());
}
test("raster normalization rejects active formats and preserves byte identity", async () => {
  await assert.rejects(normalizeSlideImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), /supported/);
  await assert.rejects(normalizeSlideImage(Buffer.from([255, 216, 255])), /corrupt|header|input/i);
  const image = await pixels();
  assert.equal(image.width, 800); assert.equal(image.height, 400);
  const bytes = Buffer.from(image.dataUrl.split(",")[1]!, "base64");
  assert.equal(image.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal((await sharp(bytes).metadata()).format, "jpeg");
});

test("only a slide-specific approved asset can enter an image layout; browser and PPTX share exact pixels and geometry", async () => {
  const draft = { ...slideDesignProof[0]!.draft, title: "Image fixture", content: { kind: "statement" as const, statement: "One test image", supportingText: "Authored test fixture, not generated content." } };
  const image = await pixels();
  const asset: SlideImageAsset = { ...image, id: `image_${image.sha256}`, candidateId: "candidate_test", sourceId: "source_test", sourcePageUrl: "https://example.test/article", sourceImageUrl: "https://example.test/image.png", retrievedUrl: "https://example.test/image.png", rightsStatus: "unverified", approvedForSlideId: draft.slideId, description: "Green test rectangle", assessment: "Authored fixture only", model: "test" };
  for (const themeId of PRESENTATION_THEME_IDS) for (const layoutId of ["image-opening", "image-editorial", "image-left", "image-caption"]) {
    const design = { ...slideDesignProof[0]!.design, themeId, layoutId, layoutFamily: layoutId === "image-opening" ? "hero" as const : "editorial" as const, imageStrategy: "source-image" as const, imageAssetId: asset.id };
    assert.throws(() => composeSlideScene(draft, design), /approval/);
    assert.throws(() => composeSlideScene(draft, design, undefined, [{ ...asset, approvedForSlideId: "other_slide" }]), /approval/);
    const result = (await createSlidePreviewRenderer())(draft, design, [asset]);
    assert.ok(result.scene);
    const element = result.scene.elements.find((element) => element.kind === "image")!;
    assert.equal(element.width / element.height, 2);
    const html = renderToStaticMarkup(createElement(SlideSceneCanvas, { scene: result.scene }));
    assert.ok(html.includes(image.dataUrl));
    const zip = await JSZip.loadAsync(await renderSlideScenesToPptx([result.scene]));
    const media = Object.keys(zip.files).filter((name) => name.startsWith("ppt/media/") && !zip.files[name]!.dir);
    assert.ok(media.length);
    assert.ok((await zip.file(media[0]!)!.async("nodebuffer")).equals(Buffer.from(image.dataUrl.split(",")[1]!, "base64")));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    assert.ok(xml.includes(`cx="${Math.round(element.width * 9525)}" cy="${Math.round(element.height * 9525)}"`));
    assert.ok(result.scene.speakerNotes.join().includes("Reuse rights: unverified"));
  }
  const choice = { themeId: "editorial", designs: [{ layoutId: "image-opening", imageAssetId: asset.id, contentDensity: "sparse", visualRole: "hero" }] };
  assert.ok(createDesignDecisionSchema(1, [asset], [draft.slideId]).safeParse(choice).success);
  assert.ok(!createDesignDecisionSchema(1, [asset], ["other_slide"]).safeParse(choice).success);
});

for (const outcome of ["approved", "rejected", "unavailable"] as const) test(`image preparation ${outcome} uses pixels, not the caption`, async (t) => {
  const bytes = await sharp({ create: { width: 640, height: 400, channels: 3, background: "#00aa00" } }).png().toBuffer();
  let call = 0;
  let inspected: string | undefined;
  const client = { complete: async (request: any) => {
    call++;
    if (call === 1) return { value: request.parse({ choices: [{ candidateId: "candidate", required: false, reason: "Inspect actual pixels." }] }), telemetry: { provider: "test", model: "test" } };
    inspected = request.images[0].dataUrl;
    assert.ok(request.user.includes("Misleading caption"));
    if (outcome === "unavailable") throw new Error("Vision timed out");
    return { value: request.parse({ approved: outcome === "approved", description: "Green rectangle", reason: "Pixel-based test judgment" }), telemetry: { provider: "test", model: "test" } };
  } };
  t.mock.method(globalThis, "fetch", async () => {
    const response = new Response(bytes);
    Object.defineProperty(response, "url", { value: "https://example.test/image.png" });
    return response;
  });
  const input = { slidePlans: { slides: [{ slideId: "slide", allowedFactIds: [] }] }, strategy: { storyArc: [{ audienceQuestion: "What is visible?" }] }, classification: { subject: "Test" }, factBank: { facts: [] } } as any;
  const bundle = { pages: [{ sourceId: "source", url: "https://example.test/page", title: "Source", imageDiscovery: { candidates: [{ id: "candidate", url: "https://example.test/image.png", alt: "Misleading caption" }] } }] } as any;
  const operation = new SourceSlideImageProvider(client as any).prepare(input, bundle, new AbortController().signal);
  if (outcome === "unavailable") await assert.rejects(operation, /Vision timed out/);
  else {
    const result = await operation;
    assert.equal(result.decisions[0]!.status, outcome);
    assert.equal(result.assets.length, outcome === "approved" ? 1 : 0);
    if (outcome === "approved") assert.equal(result.assets[0]!.dataUrl, inspected);
  }
  assert.ok(inspected?.startsWith("data:image/jpeg;base64,"));
});

test("structured vision sends actual image attachments with low reasoning", async (t) => {
  let body: any;
  const image = await pixels();
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    body = JSON.parse(request.body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '{"approved":false}' } }] }));
  });
  const client = new StructuredGenerationClient({ providerName: "test", model: "test", baseUrl: "https://model.test/v1" });
  await client.complete({ schemaName: "vision", jsonSchema: { type: "object" }, system: "Inspect.", user: "Question", images: [{ dataUrl: image.dataUrl }], maxTokens: 20, parse: (value) => value });
  assert.equal(body.reasoning_effort, "low");
  assert.deepEqual(body.messages[1].content, [{ type: "text", text: "Question" }, { type: "image_url", image_url: { url: image.dataUrl } }]);
});

test("image selection keeps every semantic candidate but download variants stay in the transport", async (t) => {
  const bytes = await sharp({ create: { width: 640, height: 400, channels: 3, background: "#00aa00" } }).png().toBuffer();
  const variants = Array.from({ length: 20 }, (_, index) => ({ url: `https://example.test/image-${index}.png`, width: (index + 1) * 100 }));
  const candidates = Array.from({ length: 80 }, (_, index) => ({ id: `candidate_${index}`, url: `https://example.test/base-${index}.png`, alt: `Source description ${index}`, caption: `Caption ${index}`, responsiveVariants: variants }));
  const bundle = { pages: [{ sourceId: "source", url: "https://example.test/page", title: "Source", imageDiscovery: { candidates } }] } as any;
  const original = structuredClone(bundle);
  const input = { slidePlans: { slides: [{ slideId: "slide", allowedFactIds: ["fact"] }] }, strategy: { storyArc: [{ audienceQuestion: "What is visible?" }] }, classification: { subject: "Test" }, factBank: { facts: [{ id: "fact", claim: "Retain the complete factual context." }] } } as any;
  let calls = 0;
  const client = { complete: async (request: any) => {
    const context = JSON.parse(request.user);
    if (++calls === 1) {
      const { candidates: modelCandidates, ...preservedInput } = context;
      assert.deepEqual(preservedInput, input);
      assert.equal(modelCandidates.length, 80);
      modelCandidates.forEach((candidate: any, index: number) => {
        assert.equal(candidate.id, candidates[index]!.id);
        assert.equal(candidate.url, candidates[index]!.url);
        assert.equal(candidate.alt, candidates[index]!.alt);
        assert.equal(candidate.caption, candidates[index]!.caption);
        assert.equal(candidate.sourcePageUrl, bundle.pages[0].url);
        assert.equal(candidate.responsiveVariants, undefined);
      });
      return { value: request.parse({ choices: [{ candidateId: "candidate_79", required: false, reason: "Inspect last candidate." }] }), telemetry: { provider: "test", model: "test" } };
    }
    assert.equal(context.candidate.responsiveVariants, undefined);
    assert.equal(context.candidate.id, "candidate_79");
    assert.ok(request.images[0].dataUrl.startsWith("data:image/jpeg;base64,"));
    return { value: request.parse({ approved: true, description: "Actual green pixels", reason: "Fixture assessment" }), telemetry: { provider: "test", model: "test" } };
  } };
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    assert.equal(url.href, variants.at(-1)!.url);
    const response = new Response(bytes);
    Object.defineProperty(response, "url", { value: url.href });
    return response;
  });
  const result = await new SourceSlideImageProvider(client as any).prepare(input, bundle, new AbortController().signal);
  assert.equal(result.assets[0]!.sourceImageUrl, variants.at(-1)!.url);
  assert.equal(result.assets[0]!.candidateId, "candidate_79");
  assert.deepEqual(bundle, original);
});
