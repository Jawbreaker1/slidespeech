import type {
  ConversationTurnDecision,
  Deck,
  ResumePlan,
  ResumePlanner,
  Session,
  UserInterruption,
} from "@slidespeech/types";

export class SimpleResumePlanner implements ResumePlanner {
  async createPlan(input: {
    session: Session;
    interruption: UserInterruption;
    turnDecision?: ConversationTurnDecision;
    deck: Deck;
  }): Promise<ResumePlan> {
    const currentNarrationIndex = input.session.currentNarrationIndex ?? 0;
    const currentSlideIndex = input.deck.slides.findIndex(
      (slide) =>
        input.session.currentSlideId &&
        slide.id === input.session.currentSlideId,
    );
    const currentSlide = input.deck.slides.find(
      (slide) =>
        input.session.currentSlideId &&
        slide.id === input.session.currentSlideId,
    );
    const previousSlide = currentSlide;
    const currentNarration =
      input.session.currentSlideId
        ? input.session.narrationBySlideId[input.session.currentSlideId]
        : undefined;
    const shouldRestartCurrentSlide =
      input.turnDecision?.runtimeEffects.restartCurrentSlide === true ||
      input.interruption.type === "simplify" ||
      input.interruption.type === "repeat";
    const shouldAdaptPedagogy =
      input.turnDecision?.runtimeEffects.adaptDetailLevel !== undefined ||
      input.turnDecision?.runtimeEffects.adaptPace !== undefined ||
      input.turnDecision?.inferredNeeds.includes("confusion") === true;

    switch (input.interruption.type) {
      case "back":
        return {
          sessionId: input.session.id,
          action: "go_to_previous_slide",
          targetSlideId:
            input.deck.slides[Math.max((previousSlide?.order ?? 1) - 1, 0)]?.id,
          targetNarrationIndex: 0,
          reasoning: "User asked to move backwards in the presentation.",
          adaptPedagogy: false,
        };
      case "simplify":
      case "repeat":
        return {
          sessionId: input.session.id,
          action: "restart_slide",
          targetSlideId: input.session.currentSlideId,
          targetNarrationIndex: 0,
          reasoning:
            input.interruption.type === "repeat"
              ? "Restart the current slide because the learner asked to hear it again."
              : "Restart the current slide with a simpler explanation.",
          adaptPedagogy: shouldAdaptPedagogy,
        };
      default:
        if (shouldRestartCurrentSlide) {
          return {
            sessionId: input.session.id,
            action: "restart_slide",
            targetSlideId: input.session.currentSlideId,
            targetNarrationIndex: 0,
            reasoning:
              "The interpreted turn suggests the learner needs the current slide reframed before continuing.",
            adaptPedagogy: shouldAdaptPedagogy,
          };
        }

        const shouldAdvanceAfterAnswer =
          input.interruption.type === "question" ||
          input.interruption.type === "example" ||
          input.interruption.type === "deepen";
        const segmentCount =
          currentNarration?.segments.length && currentNarration.segments.length > 0
            ? currentNarration.segments.length
            : 1;
        const nextSlide =
          currentSlideIndex >= 0
            ? input.deck.slides[currentSlideIndex + 1]
            : undefined;

        if (
          shouldAdvanceAfterAnswer &&
          currentNarrationIndex >= segmentCount - 1 &&
          nextSlide
        ) {
          return {
            sessionId: input.session.id,
            action: "resume_same_point",
            targetSlideId: nextSlide.id,
            targetNarrationIndex: 0,
            reasoning:
              "Continue on the next slide because the answer interrupted the final narration point on the current slide.",
            adaptPedagogy: shouldAdaptPedagogy,
          };
        }

        return {
          sessionId: input.session.id,
          action: "resume_same_point",
          targetSlideId: input.session.currentSlideId,
          targetNarrationIndex: shouldAdvanceAfterAnswer
            ? currentNarrationIndex + 1
            : currentNarrationIndex,
          reasoning:
            shouldAdvanceAfterAnswer
              ? "Continue from the next narration point after answering the interruption."
              : "Resume from the current point because the turn did not require navigation or a slide restart.",
          adaptPedagogy: shouldAdaptPedagogy,
        };
    }
  }
}
