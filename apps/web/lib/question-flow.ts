export type VoiceQuestionSource = "record" | "live";

export type VoiceQuestionAssessment = {
  decision: "submit" | "review";
  warning?: string;
  note?: string;
};

const VOICE_WORD_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;

const PRESENTER_QUESTION_PATTERN =
  /\b(what|who|when|where|why|how|which|can you|could you|would you|do you|did you|is it|are there|tell me|show me|give me|explain|clarify|summarize|repeat|walk me through|talk about|help me understand|i have a question|my question is|question)\b/i;

const PRESENTER_COMMAND_PATTERN =
  /\b(go back|previous point|previous slide|next point|next slide|continue|resume|pause|restart|start over|repeat that|say that again|give me an example|another example|simplify|slow down)\b/i;

export const tokenizeVoiceTranscript = (value: string): string[] =>
  Array.from(value.normalize("NFKC").matchAll(VOICE_WORD_TOKEN_PATTERN))
    .map((match) => match[0]?.trim() ?? "")
    .filter(Boolean);

export const isLowSignalBrowserVoiceTranscript = (value: string): boolean => {
  const tokens = tokenizeVoiceTranscript(value);

  if (tokens.length === 0) {
    return true;
  }

  return tokens.length === 1 && tokens[0]!.length <= 3;
};

export const isLowSignalVoiceTranscript = (
  value: string,
  confidence?: number,
): boolean => {
  const normalized = value.replace(/\s+/g, " ").trim();
  const tokens = tokenizeVoiceTranscript(normalized);

  if (tokens.length === 0) {
    return true;
  }

  if (tokens.length === 1 && tokens[0]!.length <= 3) {
    return true;
  }

  if (normalized.length < 10 && tokens.length < 3) {
    return true;
  }

  const uniqueTokenCount = new Set(tokens.map((token) => token.toLowerCase())).size;
  if (uniqueTokenCount === 1 && tokens.length <= 2) {
    return true;
  }

  if (typeof confidence === "number" && confidence < 0.45 && tokens.length < 4) {
    return true;
  }

  return false;
};

const isLikelyPresenterQuestion = (value: string): boolean => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }

  if (normalized.includes("?")) {
    return true;
  }

  return (
    PRESENTER_QUESTION_PATTERN.test(normalized) ||
    PRESENTER_COMMAND_PATTERN.test(normalized)
  );
};

export const assessVoiceQuestionTranscript = (input: {
  source: VoiceQuestionSource;
  text: string;
  confidence?: number;
}): VoiceQuestionAssessment => {
  if (
    isLowSignalBrowserVoiceTranscript(input.text) ||
    isLowSignalVoiceTranscript(input.text, input.confidence)
  ) {
    return {
      decision: "review",
      warning: "This transcript may be wrong. Cancel it or send it anyway.",
      note: "Review the captured question before it is sent.",
    };
  }

  if (input.source === "record") {
    return { decision: "submit" };
  }

  if (!isLikelyPresenterQuestion(input.text)) {
    return {
      decision: "review",
      warning:
        "Live voice only auto-sends clear presenter questions. Cancel this transcript or send it anyway.",
      note:
        "This did not look like a clear question for the presenter, so it was held for review.",
    };
  }

  return { decision: "submit" };
};

export const getSpeechRecognitionLanguage = (
  preferredLanguage: string | undefined,
): string => {
  const normalized = preferredLanguage?.trim().toLowerCase() ?? "";

  if (normalized.startsWith("sv")) {
    return "sv-SE";
  }

  if (normalized.startsWith("de")) {
    return "de-DE";
  }

  if (normalized.startsWith("da")) {
    return "da-DK";
  }

  if (normalized.startsWith("pl")) {
    return "pl-PL";
  }

  if (normalized.startsWith("bs")) {
    return "bs-BA";
  }

  if (normalized.startsWith("en")) {
    return "en-US";
  }

  if (typeof navigator !== "undefined" && navigator.language.trim()) {
    return navigator.language;
  }

  return "en-US";
};
