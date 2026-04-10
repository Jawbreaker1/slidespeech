import test from "node:test";
import assert from "node:assert/strict";

import { transitionSessionState } from "@slidespeech/core";
import type { Session } from "@slidespeech/types";

const baseSession: Session = {
  id: "session_1",
  deckId: "deck_1",
  state: "idle",
  currentSlideIndex: 0,
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

test("moves from idle to preparing_presentation", () => {
  const nextState = transitionSessionState(baseSession, "prepare");
  assert.equal(nextState, "preparing_presentation");
});

test("throws on invalid transition", () => {
  assert.throws(
    () => transitionSessionState({ ...baseSession, state: "finished" }, "resume"),
    /Invalid session transition/,
  );
});

