import test from "node:test";
import assert from "node:assert/strict";

import { resolvePiperModelSelection } from "../packages/providers/src/tts/piper-tts-provider";

test("falls back to an installed piper voice when the preferred default is missing", () => {
  const selection = resolvePiperModelSelection({});

  assert.equal(selection.modelPath, "models/tts/en_US-hfc_male-medium.onnx");
  assert.equal(
    selection.configPath,
    "models/tts/en_US-hfc_male-medium.onnx.json",
  );
});

test("keeps an explicit piper model when both model and config exist", () => {
  const selection = resolvePiperModelSelection({
    modelPath: "models/tts/en_US-lessac-high.onnx",
    configPath: "models/tts/en_US-lessac-high.onnx.json",
  });

  assert.equal(selection.modelPath, "models/tts/en_US-lessac-high.onnx");
  assert.equal(
    selection.configPath,
    "models/tts/en_US-lessac-high.onnx.json",
  );
});

test("derives the config path from an explicit model path when omitted", () => {
  const selection = resolvePiperModelSelection({
    modelPath: "models/tts/en_US-lessac-medium.onnx",
  });

  assert.equal(selection.modelPath, "models/tts/en_US-lessac-medium.onnx");
  assert.equal(
    selection.configPath,
    "models/tts/en_US-lessac-medium.onnx.json",
  );
});
