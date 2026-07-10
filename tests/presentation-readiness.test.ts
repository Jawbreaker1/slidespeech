import test from "node:test";
import assert from "node:assert/strict";

import { deckIsReadyForReuse } from "../apps/api/src/services/presentation-readiness";

const deckWithState = (input: {
  validationPassed?: boolean | undefined;
  backgroundEnrichmentPending?: boolean | undefined;
  narrationReadySlides?: number | undefined;
  totalSlides?: number | undefined;
}) => ({
  metadata: {
    ...(input.validationPassed === undefined
      ? {}
      : {
          validation: {
            passed: input.validationPassed,
            repaired: false,
            validatedAt: "2026-05-07T10:00:00.000Z",
            issues: [],
          },
        }),
    generation: {
      backgroundEnrichmentPending: input.backgroundEnrichmentPending ?? false,
      narrationReadySlides: input.narrationReadySlides ?? 4,
      totalSlides: input.totalSlides ?? 4,
    },
  },
});

test("deck readiness requires completed generation and passed validation", () => {
  assert.equal(
    deckIsReadyForReuse(deckWithState({ validationPassed: true })),
    true,
  );
  assert.equal(
    deckIsReadyForReuse(deckWithState({ validationPassed: false })),
    false,
  );
  assert.equal(
    deckIsReadyForReuse(deckWithState({ validationPassed: undefined })),
    false,
  );
  assert.equal(
    deckIsReadyForReuse(
      deckWithState({
        validationPassed: true,
        backgroundEnrichmentPending: true,
      }),
    ),
    false,
  );
  assert.equal(
    deckIsReadyForReuse(
      deckWithState({
        validationPassed: true,
        narrationReadySlides: 2,
        totalSlides: 4,
      }),
    ),
    false,
  );
});
