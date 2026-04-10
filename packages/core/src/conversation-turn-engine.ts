import type {
  ConversationTurnDecision,
  ConversationTurnEngine,
  Deck,
  InterruptionType,
  LLMProvider,
  Session,
  Slide,
  UserInterruption,
} from "@slidespeech/types";

import { createId, nowIso } from "./utils";

const matchesAny = (text: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

const unique = <T>(items: T[]): T[] => [...new Set(items)];

export class RuleBasedConversationTurnEngine implements ConversationTurnEngine {
  async planTurn(input: {
    session: Session;
    deck: Deck;
    slide: Slide;
    text: string;
    transcript: Array<{
      id: string;
      sessionId: string;
      role: "system" | "assistant" | "user";
      text: string;
      createdAt: string;
      relatedSlideId?: string | undefined;
      interruptionType?: InterruptionType | undefined;
    }>;
  }): Promise<ConversationTurnDecision> {
    const text = input.text.trim();
    const lowerText = text.toLowerCase();

    const pauseIntent = matchesAny(text, [/^stop\b/i, /^pause\b/i, /^hold on\b/i]);
    const resumeIntent = matchesAny(text, [/^continue\b/i, /^resume\b/i, /^go on\b/i]);
    const backIntent = matchesAny(text, [/^back\b/i, /go back/i, /previous slide/i]);
    const simplifyIntent = matchesAny(text, [
      /explain simpler/i,
      /simpler/i,
      /make it simpler/i,
      /i don't get/i,
      /i do not get/i,
      /i'm confused/i,
      /im confused/i,
      /i am confused/i,
      /i'm lost/i,
      /too hard/i,
      /not following/i,
      /unclear/i,
    ]);
    const exampleIntent = matchesAny(text, [
      /give .*example/i,
      /\bexample\b/i,
      /show me an example/i,
      /concrete example/i,
    ]);
    const deepenIntent = matchesAny(text, [
      /go deeper/i,
      /deepen/i,
      /more detail/i,
      /under the hood/i,
      /advanced/i,
      /technical detail/i,
    ]);
    const repeatIntent = matchesAny(text, [
      /^repeat\b/i,
      /say that again/i,
      /repeat that/i,
      /restate/i,
      /again/i,
    ]);
    const questionIntent =
      text.endsWith("?") ||
      matchesAny(text, [
        /\b(what|why|how|when|where|which|who)\b/i,
        /\bcan you\b/i,
        /\bcould you\b/i,
        /\bwould you\b/i,
        /\bhelp me understand\b/i,
      ]);

    let interruptionType: InterruptionType = "question";
    let responseMode: ConversationTurnDecision["responseMode"] = "question";
    const inferredNeeds: ConversationTurnDecision["inferredNeeds"] = [];
    const runtimeEffects: ConversationTurnDecision["runtimeEffects"] = {};

    if (pauseIntent) {
      interruptionType = "stop";
      responseMode = "ack_pause";
      inferredNeeds.push("pause", "navigation");
      runtimeEffects.pause = true;
    } else if (resumeIntent) {
      interruptionType = "continue";
      responseMode = "ack_resume";
      inferredNeeds.push("resume", "navigation");
      runtimeEffects.resume = true;
    } else if (backIntent) {
      interruptionType = "back";
      responseMode = "ack_back";
      inferredNeeds.push("navigation");
      runtimeEffects.goToPreviousSlide = true;
    } else {
      if (simplifyIntent) {
        inferredNeeds.push("confusion");
        runtimeEffects.adaptDetailLevel = "light";
        runtimeEffects.adaptPace = "slow";
        runtimeEffects.restartCurrentSlide = true;
      }

      if (exampleIntent) {
        inferredNeeds.push("example");
      }

      if (deepenIntent) {
        inferredNeeds.push("deepen");
      }

      if (repeatIntent) {
        inferredNeeds.push("repeat");
        runtimeEffects.restartCurrentSlide = true;
      }

      if (questionIntent) {
        inferredNeeds.push("question");
      }

      if (exampleIntent && !this.looksLikeCompositeQuestion(lowerText)) {
        interruptionType = "example";
        responseMode = "example";
      } else if (deepenIntent && !this.looksLikeCompositeQuestion(lowerText)) {
        interruptionType = "deepen";
        responseMode = "deepen";
      } else if (repeatIntent && !questionIntent) {
        interruptionType = "repeat";
        responseMode = "repeat";
      } else if (simplifyIntent && !questionIntent) {
        interruptionType = "simplify";
        responseMode = "simplify";
      } else {
        interruptionType = "question";
        responseMode = "question";
        if (!inferredNeeds.includes("question")) {
          inferredNeeds.push("question");
        }
      }
    }

    const interruption = this.createInterruption(
      input.session,
      text,
      interruptionType,
      unique(inferredNeeds),
    );

    return {
      interruption,
      interruptionType,
      inferredNeeds: unique(inferredNeeds),
      responseMode,
      runtimeEffects,
      confidence: interruption.confidence,
      rationale: interruption.rationale,
    };
  }

  private looksLikeCompositeQuestion(text: string): boolean {
    return (
      text.includes("?") ||
      /(why|what|how|can you|could you|would you|help me understand)/i.test(text)
    );
  }

  private createInterruption(
    session: Session,
    rawText: string,
    type: InterruptionType,
    inferredNeeds: ConversationTurnDecision["inferredNeeds"],
  ): UserInterruption {
    return {
      id: createId("interrupt"),
      sessionId: session.id,
      createdAt: nowIso(),
      rawText,
      type,
      confidence: type === "question" ? 0.72 : 0.9,
      rationale:
        inferredNeeds.length > 0
          ? `Conversation turn interpreted with inferred needs: ${inferredNeeds.join(", ")}.`
          : "Conversation turn interpreted from freeform input.",
    };
  }
}

export class LLMConversationTurnEngine implements ConversationTurnEngine {
  constructor(
    private readonly llmProvider: LLMProvider,
    private readonly fallback: ConversationTurnEngine = new RuleBasedConversationTurnEngine(),
  ) {}

  async planTurn(input: {
    session: Session;
    deck: Deck;
    slide: Slide;
    text: string;
    transcript: Array<{
      id: string;
      sessionId: string;
      role: "system" | "assistant" | "user";
      text: string;
      createdAt: string;
      relatedSlideId?: string | undefined;
      interruptionType?: InterruptionType | undefined;
    }>;
  }): Promise<ConversationTurnDecision> {
    try {
      const plan = await this.llmProvider.planConversationTurn({
        session: input.session,
        deck: input.deck,
        slide: input.slide,
        text: input.text,
        transcript: input.transcript,
      });

      return {
        interruption: this.createInterruption(
          input.session,
          input.text,
          plan.interruptionType,
          unique(plan.inferredNeeds),
          plan.confidence,
          plan.rationale,
        ),
        interruptionType: plan.interruptionType,
        inferredNeeds: unique(plan.inferredNeeds),
        responseMode: plan.responseMode,
        runtimeEffects: plan.runtimeEffects,
        confidence: plan.confidence,
        rationale: plan.rationale,
      };
    } catch (error) {
      console.warn(
        `[slidespeech] LLM conversation planner failed, falling back to rules: ${(error as Error).message}`,
      );

      return this.fallback.planTurn(input);
    }
  }

  private createInterruption(
    session: Session,
    rawText: string,
    type: InterruptionType,
    inferredNeeds: ConversationTurnDecision["inferredNeeds"],
    confidence: number,
    rationale: string,
  ): UserInterruption {
    return {
      id: createId("interrupt"),
      sessionId: session.id,
      createdAt: nowIso(),
      rawText,
      type,
      confidence,
      rationale,
    };
  }
}
