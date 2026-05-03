import type {
  Deck,
  NarrationProgressResponse,
  SelectSlideResponse,
  Session,
  SessionInteractionResponse as SessionInteractionPayload,
  SessionSnapshotResponse,
  SlideNarration,
  SpeechSynthesisResponse,
  TranscriptTurn,
  VoiceTurnResponse,
} from "@slidespeech/types";

export type InteractionEntry = {
  role: "user" | "assistant";
  text: string;
};

export type PresenterState = {
  deck: Deck;
  session: Session;
  provider: string;
  transcripts: TranscriptTurn[];
  narrationsBySlideId: Record<string, SlideNarration>;
};

type PresenterUpdate =
  | SelectSlideResponse
  | NarrationProgressResponse
  | SpeechSynthesisResponse
  | SessionInteractionPayload
  | VoiceTurnResponse;

export type VoiceTranscriptSummary = {
  source: "browser" | "backend";
  provider: string;
  text: string;
  confidence?: number;
  hadSpeech: boolean;
  transcriptAvailable: boolean;
};

export type AnswerReadyNotice = {
  question: string | null;
  answer: string;
};

export type BackendVoiceRecordingSupport = {
  available: boolean;
  reason: string | null;
};

export type QuestionFlowSource = "typed" | "record" | "live";

export type QuestionFlowStage =
  | "listening"
  | "transcribing"
  | "transcript_review"
  | "generating_answer"
  | "speaking_answer";

export type QuestionFlowState = {
  requestId: number;
  source: QuestionFlowSource;
  stage: QuestionFlowStage;
  promptText: string;
  interimTranscript: string;
  transcriptText: string;
  answerText: string;
  warning: string | null;
  note: string | null;
  wasPresentingAtStart: boolean;
};

export const toInteractionLog = (
  transcripts: TranscriptTurn[],
): InteractionEntry[] =>
  transcripts
    .filter(
      (turn): turn is TranscriptTurn & { role: "user" | "assistant" } =>
        turn.role === "user" || turn.role === "assistant",
    )
    .map((turn) => ({
      role: turn.role,
      text: turn.text,
    }));

export const getNarrationSegments = (
  narration: SlideNarration | undefined,
  fallbackText: string | undefined,
): string[] => {
  const explicitSegments = narration?.segments ?? [];

  if (explicitSegments.length > 0) {
    return explicitSegments;
  }

  const baseText = narration?.narration ?? fallbackText ?? "";
  const normalized = baseText.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const sentenceLikeSegments = normalized
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return sentenceLikeSegments.length > 0 ? sentenceLikeSegments : [normalized];
};

export const fromSnapshot = (snapshot: SessionSnapshotResponse): PresenterState => ({
  deck: snapshot.deck,
  session: snapshot.session,
  provider: snapshot.provider,
  transcripts: snapshot.transcripts,
  narrationsBySlideId: {
    ...snapshot.session.narrationBySlideId,
    ...(snapshot.narration ? { [snapshot.narration.slideId]: snapshot.narration } : {}),
  },
});

const preserveDeckIfUnchanged = (
  previousDeck: Deck,
  nextDeck: Deck,
): Deck =>
  previousDeck.id === nextDeck.id &&
  previousDeck.updatedAt === nextDeck.updatedAt &&
  previousDeck.slides.length === nextDeck.slides.length
    ? previousDeck
    : nextDeck;

export const applyUpdate = (
  previous: PresenterState,
  next: PresenterUpdate,
): PresenterState => {
  const deck = preserveDeckIfUnchanged(previous.deck, next.deck);
  const updatedNarrations = {
    ...previous.narrationsBySlideId,
    ...next.session.narrationBySlideId,
    ...(next.narration ? { [next.narration.slideId]: next.narration } : {}),
  };

  return {
    ...previous,
    deck,
    session: {
      ...next.session,
      narrationBySlideId: updatedNarrations,
    },
    provider: next.provider,
    narrationsBySlideId: updatedNarrations,
  };
};

export const getBackendVoiceRecordingSupport = (): BackendVoiceRecordingSupport => {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      available: false,
      reason:
        "Microphone recording is not available before the presenter finishes loading.",
    };
  }

  if (!window.isSecureContext) {
    return {
      available: false,
      reason:
        "Microphone recording requires a secure browser context. Open the presenter on http://localhost:3000 or HTTPS.",
    };
  }

  if (
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== "function"
  ) {
    return {
      available: false,
      reason:
        "This browser/context does not expose microphone recording APIs for backend STT.",
    };
  }

  if (typeof MediaRecorder === "undefined") {
    return {
      available: false,
      reason:
        "This browser does not support in-browser audio recording for backend STT.",
    };
  }

  return {
    available: true,
    reason: null,
  };
};
