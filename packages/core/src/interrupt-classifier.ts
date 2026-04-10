import type {
  InterruptClassifier,
  InterruptionType,
  Session,
  UserInterruption,
} from "@slidespeech/types";

import { createId, nowIso } from "./utils";

const commandPatterns: Array<{ type: InterruptionType; patterns: RegExp[] }> = [
  { type: "stop", patterns: [/^stop\b/i, /^stopp\b/i, /^pause\b/i] },
  { type: "back", patterns: [/^back\b/i, /^tillbaka\b/i, /^gå tillbaka\b/i] },
  {
    type: "simplify",
    patterns: [/förklara enklare/i, /explain simpler/i, /simplify/i, /enklare/i],
  },
  { type: "deepen", patterns: [/gå djupare/i, /go deeper/i, /deepen/i, /deeper/i, /fördjupa/i] },
  { type: "example", patterns: [/ge exempel/i, /example/i, /exempel/i] },
  { type: "repeat", patterns: [/repeat/i, /upprepa/i, /igen/i] },
  {
    type: "continue",
    patterns: [/continue/i, /fortsätt/i, /kör vidare/i],
  },
];

export class KeywordInterruptClassifier implements InterruptClassifier {
  async classify(input: {
    session: Session;
    text: string;
  }): Promise<UserInterruption> {
    const text = input.text.trim();
    const match = commandPatterns.find(({ patterns }) =>
      patterns.some((pattern) => pattern.test(text)),
    );

    const type: InterruptionType = match
      ? match.type
      : text.endsWith("?")
        ? "question"
        : text.length > 0
          ? "question"
          : "unknown";

    return {
      id: createId("interrupt"),
      sessionId: input.session.id,
      createdAt: nowIso(),
      rawText: text,
      type,
      confidence: match ? 0.93 : type === "question" ? 0.76 : 0.4,
      rationale: match
        ? "Matched deterministic MVP command patterns."
        : type === "question"
          ? "Fallback to question because the input was freeform user text."
          : "No known interruption pattern matched.",
    };
  }
}
