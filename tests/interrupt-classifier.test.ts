import test from "node:test";
import assert from "node:assert/strict";

import { KeywordInterruptClassifier } from "@slidespeech/core";
import type { Session } from "@slidespeech/types";

const session: Session = {
  id: "session_1",
  deckId: "deck_1",
  state: "presenting",
  currentSlideId: "slide_2",
  currentSlideIndex: 1,
  narrationBySlideId: {},
  transcriptTurnIds: [],
  pedagogicalProfile: {
    audienceLevel: "beginner",
    tone: "supportive",
    pace: "balanced",
    preferredExampleStyle: "real_world",
    wantsFrequentChecks: true,
    detailLevel: "standard",
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test("classifies simplify commands", async () => {
  const classifier = new KeywordInterruptClassifier();
  const result = await classifier.classify({
    session,
    text: "förklara enklare",
  });

  assert.equal(result.type, "simplify");
  assert.equal(result.sessionId, session.id);
});

test("falls back to question when text ends with a question mark", async () => {
  const classifier = new KeywordInterruptClassifier();
  const result = await classifier.classify({
    session,
    text: "varför behövs det här?",
  });

  assert.equal(result.type, "question");
});

