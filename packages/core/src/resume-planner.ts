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
    const previousSlide = input.deck.slides.find(
      (slide) =>
        input.session.currentSlideId &&
        slide.id === input.session.currentSlideId,
    );
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
          reasoning: "User asked to move backwards in the presentation.",
          adaptPedagogy: false,
        };
      case "simplify":
      case "repeat":
        return {
          sessionId: input.session.id,
          action: "restart_slide",
          targetSlideId: input.session.currentSlideId,
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
            reasoning:
              "The interpreted turn suggests the learner needs the current slide reframed before continuing.",
            adaptPedagogy: shouldAdaptPedagogy,
          };
        }

        return {
          sessionId: input.session.id,
          action: "resume_same_point",
          targetSlideId: input.session.currentSlideId,
          reasoning:
            "Resume from the current point because the turn did not require navigation or a slide restart.",
          adaptPedagogy: shouldAdaptPedagogy,
        };
    }
  }
}
