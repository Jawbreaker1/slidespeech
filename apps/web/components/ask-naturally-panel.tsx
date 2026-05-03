import type {
  AnswerReadyNotice,
  VoiceTranscriptSummary,
} from "./session-presenter-state";
import { AnswerNoticePanel } from "./answer-notice-panel";

type AskNaturallyPanelProps = {
  backendVoiceRecordingAvailable: boolean;
  backendVoiceRecordingReason: string | null;
  browserSpeechSupported: boolean;
  commandInput: string;
  isInteracting: boolean;
  isListeningBrowserVoice: boolean;
  isPending: boolean;
  isRecordingVoice: boolean;
  isSubmittingVoice: boolean;
  isSynthesizingSpeech: boolean;
  lastVoiceTranscript: VoiceTranscriptSummary | null;
  latestAnswerNotice: AnswerReadyNotice | null;
  latestAssistantMessage: string | null;
  liveVoiceMode: boolean;
  questionFlowActive: boolean;
  recordQuestionUnavailable: boolean;
  recordQuestionUsesBrowserFallback: boolean;
  onCommandInputChange: (value: string) => void;
  onRecordQuestion: () => void;
  onSendInteraction: () => void;
  onSpeakAnswer: (answer: string) => void;
  onToggleLiveVoice: () => void;
};

export const AskNaturallyPanel = ({
  backendVoiceRecordingAvailable,
  backendVoiceRecordingReason,
  browserSpeechSupported,
  commandInput,
  isInteracting,
  isListeningBrowserVoice,
  isPending,
  isRecordingVoice,
  isSubmittingVoice,
  isSynthesizingSpeech,
  lastVoiceTranscript,
  latestAnswerNotice,
  latestAssistantMessage,
  liveVoiceMode,
  questionFlowActive,
  recordQuestionUnavailable,
  recordQuestionUsesBrowserFallback,
  onCommandInputChange,
  onRecordQuestion,
  onSendInteraction,
  onSpeakAnswer,
  onToggleLiveVoice,
}: AskNaturallyPanelProps) => {
  const recordButtonLabel = isRecordingVoice
    ? "Stop recording"
    : isListeningBrowserVoice
      ? "Stop listening"
      : isSubmittingVoice
        ? "Processing..."
        : backendVoiceRecordingAvailable
          ? "Record question"
          : recordQuestionUsesBrowserFallback
            ? "Speak question"
            : "Record question unavailable";
  const voiceHelpText = backendVoiceRecordingAvailable
    ? browserSpeechSupported
      ? liveVoiceMode
        ? "Browser speech recognition is armed for live interruption testing. It disarms automatically when a question is sent."
        : "Record question captures audio for backend STT. Live voice remains available for interruption-style browser testing."
      : "Record question captures audio for backend STT. Browser speech recognition is not available here."
    : recordQuestionUsesBrowserFallback
      ? "This browser/context cannot record audio directly for backend STT here, so Record question falls back to one-shot browser speech recognition."
      : backendVoiceRecordingReason ?? "Voice input is not available here right now.";
  const voiceState = isSubmittingVoice
    ? "processing"
    : isRecordingVoice
      ? "recording"
      : isListeningBrowserVoice
        ? "listening"
        : liveVoiceMode
          ? "armed"
          : "idle";

  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/55">
        Ask naturally
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
            liveVoiceMode
              ? "bg-coral text-white"
              : "border border-white/20 text-paper hover:border-white/40"
          }`}
          disabled={!browserSpeechSupported || questionFlowActive}
          onClick={onToggleLiveVoice}
          type="button"
        >
          {liveVoiceMode ? "Live voice on" : "Live voice off"}
        </button>
        <button
          className="rounded-full border border-white/20 px-4 py-2 text-sm transition hover:border-white/40 disabled:opacity-50"
          disabled={
            isSubmittingVoice ||
            isListeningBrowserVoice ||
            isInteracting ||
            questionFlowActive ||
            (recordQuestionUnavailable && !isRecordingVoice)
          }
          onClick={onRecordQuestion}
          type="button"
        >
          {recordButtonLabel}
        </button>
      </div>
      <p className="mt-3 text-sm leading-6 text-paper/60">{voiceHelpText}</p>
      <div className="mt-3 rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-paper/75">
        <p>
          Voice state: <span className="font-semibold text-paper">{voiceState}</span>
        </p>
      </div>
      {lastVoiceTranscript ? (
        <div className="mt-3 rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-paper/80">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/50">
            Last voice input
          </p>
          <p className="mt-2">
            {lastVoiceTranscript.transcriptAvailable
              ? lastVoiceTranscript.text
              : lastVoiceTranscript.hadSpeech
                ? "Speech was detected, but no transcript was produced."
                : "No speech detected."}
          </p>
          <p className="mt-2 text-xs text-paper/50">
            Source: {lastVoiceTranscript.source} / {lastVoiceTranscript.provider}
          </p>
        </div>
      ) : null}
      <textarea
        className="mt-4 min-h-28 w-full rounded-[22px] border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-paper outline-none placeholder:text-paper/35"
        onChange={(event) => onCommandInputChange(event.target.value)}
        placeholder="Ask a question, ask for a simpler explanation, ask for an example, or continue the conversation."
        value={commandInput}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:opacity-90 disabled:opacity-50"
          disabled={
            !commandInput.trim() ||
            isInteracting ||
            isPending ||
            questionFlowActive
          }
          onClick={onSendInteraction}
          type="button"
        >
          {questionFlowActive ? "Generating..." : "Send"}
        </button>
      </div>
      <AnswerNoticePanel
        isSynthesizingSpeech={isSynthesizingSpeech}
        latestAnswerNotice={latestAnswerNotice}
        latestAssistantMessage={latestAssistantMessage}
        onSpeakAnswer={onSpeakAnswer}
      />
    </section>
  );
};
