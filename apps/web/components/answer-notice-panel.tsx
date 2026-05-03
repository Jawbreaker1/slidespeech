import type { AnswerReadyNotice } from "./session-presenter-state";

type AnswerNoticePanelProps = {
  latestAnswerNotice: AnswerReadyNotice | null;
  latestAssistantMessage: string | null;
  isSynthesizingSpeech: boolean;
  onSpeakAnswer: (answer: string) => void;
};

export const AnswerNoticePanel = ({
  latestAnswerNotice,
  latestAssistantMessage,
  isSynthesizingSpeech,
  onSpeakAnswer,
}: AnswerNoticePanelProps) => {
  if (latestAnswerNotice) {
    return (
      <div className="mt-4 rounded-[22px] border border-emerald-300/20 bg-emerald-400/10 px-4 py-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/20 text-base text-emerald-100">
            ✓
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/55">
              Answer ready
            </p>
            {latestAnswerNotice.question ? (
              <p className="mt-1 text-sm leading-6 text-paper/70">
                Question: “{latestAnswerNotice.question}”
              </p>
            ) : null}
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-paper/90">
          {latestAnswerNotice.answer}
        </p>
        <button
          className="mt-3 rounded-full border border-white/20 px-3 py-1.5 text-sm transition hover:border-white/40 disabled:opacity-50"
          disabled={isSynthesizingSpeech}
          onClick={() => onSpeakAnswer(latestAnswerNotice.answer)}
          type="button"
        >
          Speak last answer
        </button>
      </div>
    );
  }

  if (!latestAssistantMessage) {
    return null;
  }

  return (
    <div className="mt-4 rounded-[22px] bg-white/5 px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/55">
        Latest assistant message
      </p>
      <p className="mt-2 text-sm leading-6 text-paper/85">
        {latestAssistantMessage}
      </p>
    </div>
  );
};
