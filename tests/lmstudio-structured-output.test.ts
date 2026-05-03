import assert from "node:assert/strict";
import test from "node:test";

import {
  parseLmStudioReasoningText,
  parseLmStudioTaggedToolCall,
  parseLooseStructuredValue,
} from "../packages/providers/src/llm/lmstudio-structured-output";

test("lmstudio tagged tool fallback parses parameter markup from reasoning content", () => {
  const parsed = parseLmStudioTaggedToolCall(
    `<tool_call>
<function=return_turn_plan>
<parameter=interruptionType>
question
</parameter>
<parameter=inferredNeeds>
["question"]
</parameter>
<parameter=responseMode>
summarize_current_slide
</parameter>
<parameter=runtimeEffects>
[]
</parameter>
<parameter=confidence>
0.95
</parameter>
<parameter=rationale>
The learner asks for the main point.
</parameter>
</function>
</tool_call>`,
    "return_turn_plan",
  );

  assert.deepEqual(parsed, {
    interruptionType: "question",
    inferredNeeds: ["question"],
    responseMode: "summarize_current_slide",
    runtimeEffects: [],
    confidence: 0.95,
    rationale: "The learner asks for the main point.",
  });
});

test("lmstudio loose structured values parse primitives before falling back to text", () => {
  assert.deepEqual(parseLooseStructuredValue("[\"a\",\"b\"]"), ["a", "b"]);
  assert.equal(parseLooseStructuredValue("0.75"), 0.75);
  assert.equal(parseLooseStructuredValue("true"), true);
  assert.equal(parseLooseStructuredValue("plain text"), "plain text");
});

test("lmstudio reasoning text fallback extracts structured text fields", () => {
  assert.equal(
    parseLmStudioReasoningText("{\"text\":\"ANSWER: hello\"}"),
    "ANSWER: hello",
  );
  assert.equal(
    parseLmStudioReasoningText("{\"thought\":\"I should answer\",\"final\":\"TITLE:\\nExample\"}"),
    "TITLE:\nExample",
  );
  assert.equal(
    parseLmStudioReasoningText("{\"response\":\"OK\"}"),
    "OK",
  );
  assert.equal(parseLmStudioReasoningText("{\"thought\":\"I should answer\"}"), null);
});
