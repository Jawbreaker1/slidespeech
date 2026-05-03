import test from "node:test";
import assert from "node:assert/strict";

import {
  assessVoiceQuestionTranscript,
  getSpeechRecognitionLanguage,
} from "../apps/web/lib/question-flow";

test("recorded questions auto-submit when the transcript is clear", () => {
  const assessment = assessVoiceQuestionTranscript({
    source: "record",
    text: "Who is the CEO of System Verification?",
    confidence: 0.82,
  });

  assert.equal(assessment.decision, "submit");
});

test("live voice auto-submits clear presenter questions", () => {
  const assessment = assessVoiceQuestionTranscript({
    source: "live",
    text: "Can you give me an example from this slide?",
    confidence: 0.78,
  });

  assert.equal(assessment.decision, "submit");
});

test("live voice holds uncertain ambient transcripts for review", () => {
  const assessment = assessVoiceQuestionTranscript({
    source: "live",
    text: "I was talking to Anna about lunch after this",
    confidence: 0.84,
  });

  assert.equal(assessment.decision, "review");
  assert.match(
    assessment.warning ?? "",
    /clear presenter questions/i,
  );
});

test("low-signal transcripts stay in review even for explicit record mode", () => {
  const assessment = assessVoiceQuestionTranscript({
    source: "record",
    text: "you",
    confidence: 0.32,
  });

  assert.equal(assessment.decision, "review");
  assert.match(assessment.warning ?? "", /transcript may be wrong/i);
});

test("speech recognition language maps deck language hints", () => {
  assert.equal(getSpeechRecognitionLanguage("sv"), "sv-SE");
  assert.equal(getSpeechRecognitionLanguage("en-US"), "en-US");
  assert.equal(getSpeechRecognitionLanguage("de"), "de-DE");
});
