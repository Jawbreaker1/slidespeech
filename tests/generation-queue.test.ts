import assert from "node:assert/strict";
import test from "node:test";

import { DeckSchema, SessionSchema } from "@slidespeech/types";

import { createPresentationGenerationQueue } from "../apps/api/src/services/generation-queue";

const waitForQueueTick = async (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const buildGenerationResult = (suffix: string) => ({
  deck: DeckSchema.parse({
    id: `deck_${suffix}`,
    title: `Deck ${suffix}`,
    topic: `Topic ${suffix}`,
    summary: "Test deck",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: `Topic ${suffix}`,
      sourceIds: [],
    },
    slides: [
      {
        id: `slide_${suffix}`,
        order: 0,
        title: `Slide ${suffix}`,
        learningGoal: "Understand the test slide.",
        keyPoints: ["One useful point."],
        requiredContext: [],
        speakerNotes: [],
        beginnerExplanation: "A simple explanation.",
        advancedExplanation: "A deeper explanation.",
        examples: [],
        likelyQuestions: [],
        canSkip: false,
        dependenciesOnOtherSlides: [],
        visualNotes: [],
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-17T10:00:00.000Z",
    updatedAt: "2026-04-17T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  }),
  session: SessionSchema.parse({
    id: `session_${suffix}`,
    deckId: `deck_${suffix}`,
    state: "idle",
    currentSlideId: `slide_${suffix}`,
    currentSlideIndex: 0,
    currentNarrationIndex: 0,
    narrationBySlideId: {},
    narrationProgressBySlideId: {},
    transcriptTurnIds: [],
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    createdAt: "2026-04-17T10:00:00.000Z",
    updatedAt: "2026-04-17T10:00:00.000Z",
  }),
  narrations: [],
  provider: "test-llm",
});

test("presentation generation queue runs one job at a time and reports queue state", async () => {
  const resolvers: Array<{
    resolve: (value: ReturnType<typeof buildGenerationResult>) => void;
  }> = [];

  const queue = createPresentationGenerationQueue(
    () =>
      new Promise((resolve) => {
        resolvers.push({ resolve });
      }),
  );

  const firstJob = queue.enqueue({ topic: "First topic" });
  const secondJob = queue.enqueue({ topic: "Second topic" });

  assert.equal(firstJob.status, "generating");
  assert.equal(secondJob.status, "queued");
  assert.equal(secondJob.queuePosition, 1);
  assert.equal(secondJob.jobsAhead, 1);

  resolvers[0]?.resolve(buildGenerationResult("first"));
  await waitForQueueTick();

  const firstCompleted = queue.getStatus(firstJob.jobId);
  const secondGenerating = queue.getStatus(secondJob.jobId);

  assert.ok(firstCompleted);
  assert.equal(firstCompleted.status, "completed");
  assert.equal(firstCompleted.sessionId, "session_first");
  assert.ok(secondGenerating);
  assert.equal(secondGenerating.status, "generating");

  resolvers[1]?.resolve(buildGenerationResult("second"));
  await waitForQueueTick();

  const secondCompleted = queue.getStatus(secondJob.jobId);
  assert.ok(secondCompleted);
  assert.equal(secondCompleted.status, "completed");
  assert.equal(secondCompleted.sessionId, "session_second");
});
