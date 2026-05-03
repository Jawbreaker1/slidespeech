import type { Session } from "@slidespeech/types";
import { PresenterControls } from "@slidespeech/ui";

type PresenterControlsPanelProps = {
  canGoBack: boolean;
  canGoForward: boolean;
  currentNarrationIndex: number;
  isBusy: boolean;
  isGeneratingNarrationAudio: boolean;
  isInteracting: boolean;
  isListeningBrowserVoice: boolean;
  isPlayingSpeech: boolean;
  isPresenting: boolean;
  isRecordingVoice: boolean;
  isSubmittingVoice: boolean;
  isSynthesizingSpeech: boolean;
  isUpdatingNarrationProgress: boolean;
  lastSpokenText: string | null;
  narrationSegmentsLength: number;
  pendingPresentationStart: boolean;
  pendingUserTurn: string | null;
  presentLabel: string;
  sessionState: Session["state"];
  hasSlides: boolean;
  isNarrationLoadingForActiveSlide: boolean;
  onBack: () => void;
  onForward: () => void;
  onNextPoint: () => void;
  onPlayFromCurrentPoint: () => void;
  onPreviousPoint: () => void;
  onRestart: () => void;
  onStopAudio: () => void;
  onTogglePresenting: () => void;
};

export const PresenterControlsPanel = ({
  canGoBack,
  canGoForward,
  currentNarrationIndex,
  isBusy,
  isGeneratingNarrationAudio,
  isInteracting,
  isListeningBrowserVoice,
  isPlayingSpeech,
  isPresenting,
  isRecordingVoice,
  isSubmittingVoice,
  isSynthesizingSpeech,
  isUpdatingNarrationProgress,
  lastSpokenText,
  narrationSegmentsLength,
  pendingPresentationStart,
  pendingUserTurn,
  presentLabel,
  sessionState,
  hasSlides,
  isNarrationLoadingForActiveSlide,
  onBack,
  onForward,
  onNextPoint,
  onPlayFromCurrentPoint,
  onPreviousPoint,
  onRestart,
  onStopAudio,
  onTogglePresenting,
}: PresenterControlsPanelProps) => (
  <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/55">
      Controls
    </p>
    <div className="mt-4 rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-paper/75">
      <p>
        Session: <span className="font-semibold text-paper">{sessionState}</span>
      </p>
      <p className="mt-1">
        Speech:{" "}
        <span className="font-semibold text-paper">
          {isPlayingSpeech
            ? "playing"
            : isGeneratingNarrationAudio
              ? "generating voice"
              : isSynthesizingSpeech
                ? "synthesizing"
                : "idle"}
        </span>
      </p>
      <p className="mt-1">
        Response:{" "}
        <span className="font-semibold text-paper">
          {isListeningBrowserVoice || isRecordingVoice
            ? "listening"
            : isSubmittingVoice && !pendingUserTurn
              ? "processing voice"
              : isInteracting
                ? "generating answer"
                : isSynthesizingSpeech
                  ? "generating speech"
                  : isPlayingSpeech
                    ? "speaking"
                    : "idle"}
        </span>
      </p>
    </div>
    <div className="mt-4">
      <PresenterControls
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        isBusy={isBusy}
        isPresenting={isPresenting}
        onBack={onBack}
        onForward={onForward}
        onTogglePresenting={onTogglePresenting}
        presentLabel={presentLabel}
      />
      <p className="mt-3 text-sm leading-6 text-paper/60">
        Slide controls move between slides. Point controls below only move within the current
        slide&apos;s narration.
      </p>
      {isGeneratingNarrationAudio ? (
        <div className="mt-4 rounded-[18px] border border-coral/20 bg-coral/10 px-4 py-3 text-sm leading-6 text-paper/85">
          Generating spoken audio for the current point. Playback starts automatically when the
          voice clip is ready.
        </div>
      ) : null}
    </div>

    <div className="mt-4 flex flex-wrap gap-2">
      <button
        className="rounded-full border border-white/20 px-3 py-1.5 text-sm transition hover:border-white/40 disabled:opacity-50"
        disabled={
          narrationSegmentsLength <= 1 ||
          currentNarrationIndex === 0 ||
          isUpdatingNarrationProgress
        }
        onClick={onPreviousPoint}
        type="button"
      >
        Previous point
      </button>
      <button
        className="rounded-full border border-white/20 px-3 py-1.5 text-sm transition hover:border-white/40 disabled:opacity-50"
        disabled={
          narrationSegmentsLength <= 1 ||
          currentNarrationIndex >= narrationSegmentsLength - 1 ||
          isUpdatingNarrationProgress
        }
        onClick={onNextPoint}
        type="button"
      >
        {isUpdatingNarrationProgress ? "Updating..." : "Next point"}
      </button>
    </div>

    <div className="mt-4 flex flex-wrap gap-2">
      <button
        className="rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
        disabled={
          isNarrationLoadingForActiveSlide ||
          isSynthesizingSpeech ||
          pendingPresentationStart
        }
        onClick={onPlayFromCurrentPoint}
        type="button"
      >
        {isGeneratingNarrationAudio
          ? "Generating voice..."
          : isSynthesizingSpeech
            ? "Synthesizing..."
            : "Play from current point"}
      </button>
      <button
        className="rounded-full border border-white/20 px-4 py-2 text-sm transition hover:border-white/40 disabled:opacity-50"
        disabled={!isPlayingSpeech}
        onClick={onStopAudio}
        type="button"
      >
        Stop audio
      </button>
      <button
        className="rounded-full border border-white/20 px-4 py-2 text-sm transition hover:border-white/40 disabled:opacity-50"
        disabled={!hasSlides || pendingPresentationStart}
        onClick={onRestart}
        type="button"
      >
        Restart from beginning
      </button>
    </div>
    <p className="mt-3 text-sm leading-6 text-paper/60">
      Narration continues automatically. After a spoken answer, the presenter bridges back into
      the deck and resumes from the current point.
    </p>
    {lastSpokenText ? (
      <p className="mt-3 text-sm leading-6 text-paper/65">
        Last spoken: {lastSpokenText}
      </p>
    ) : null}
  </section>
);
