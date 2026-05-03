import type { QuestionFlowState } from "./session-presenter-state";

type QuestionFlowOverlayProps = {
  questionFlow: QuestionFlowState;
  isRecordingVoice: boolean;
  onCancel: () => void;
  onFinishRecording: () => void;
  onSendAnyway: () => void;
};

const getQuestionFlowTitle = (questionFlow: QuestionFlowState): string => {
  switch (questionFlow.stage) {
    case "listening":
      return "Listening for question";
    case "transcribing":
      return "Transcribing question";
    case "transcript_review":
      return "Review transcript";
    case "generating_answer":
      return "Generating answer";
    case "speaking_answer":
      return "Speaking answer";
  }
};

const getQuestionFlowMessage = (questionFlow: QuestionFlowState): string => {
  if (questionFlow.note) {
    return questionFlow.note;
  }

  switch (questionFlow.stage) {
    case "listening":
      return "The presenter has paused and is listening for a question.";
    case "transcribing":
      return "Converting speech into text before Q&A runs.";
    case "transcript_review":
      return "The transcript looks uncertain, so review it before it reaches Q&A.";
    case "generating_answer":
      return "Q&A is generating a grounded answer now.";
    case "speaking_answer":
      return "The answer is ready and is now being spoken.";
  }
};

const questionSourceLabel = (questionFlow: QuestionFlowState): string => {
  switch (questionFlow.source) {
    case "typed":
      return "Typed question";
    case "record":
      return "Recorded question";
    case "live":
      return "Live voice";
  }
};

export const QuestionFlowOverlay = ({
  questionFlow,
  isRecordingVoice,
  onCancel,
  onFinishRecording,
  onSendAnyway,
}: QuestionFlowOverlayProps) => {
  const title = getQuestionFlowTitle(questionFlow);
  const message = getQuestionFlowMessage(questionFlow);
  const canCancel =
    questionFlow.stage === "listening" ||
    questionFlow.stage === "transcript_review";
  const canFinishRecording =
    questionFlow.stage === "listening" &&
    questionFlow.source === "record" &&
    isRecordingVoice;
  const canSendAnyway =
    questionFlow.stage === "transcript_review" &&
    questionFlow.transcriptText.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/72 px-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/10 bg-slate-950/95 px-6 py-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="inline-flex h-10 w-10 animate-pulse rounded-full border-[3px] border-white/15 border-t-coral" />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-paper/55">
                {questionSourceLabel(questionFlow)}
              </p>
              <p className="mt-1 text-xl font-semibold text-paper">{title}</p>
            </div>
          </div>
          {canCancel ? (
            <button
              className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-paper transition hover:border-white/40"
              onClick={onCancel}
              type="button"
            >
              Cancel question
            </button>
          ) : null}
        </div>

        <p className="mt-4 text-sm leading-6 text-paper/75">{message}</p>

        {questionFlow.warning ? (
          <div className="mt-4 rounded-[18px] border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-paper/90">
            {questionFlow.warning}
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/50">
              Transcript
            </p>
            <p className="mt-3 text-base leading-7 text-paper/95">
              {questionFlow.transcriptText ||
                questionFlow.interimTranscript ||
                "Waiting for speech..."}
            </p>
            {questionFlow.interimTranscript &&
            questionFlow.interimTranscript !== questionFlow.transcriptText ? (
              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-paper/45">
                Live transcription preview
              </p>
            ) : null}
          </div>
          <div className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/50">
              Answer
            </p>
            <p className="mt-3 text-base leading-7 text-paper/90">
              {questionFlow.answerText ||
                (questionFlow.stage === "speaking_answer"
                  ? "Starting answer playback..."
                  : "No answer yet.")}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          {canFinishRecording ? (
            <button
              className="rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95"
              onClick={onFinishRecording}
              type="button"
            >
              Finish question
            </button>
          ) : null}
          {canSendAnyway ? (
            <button
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:opacity-90"
              onClick={onSendAnyway}
              type="button"
            >
              Send anyway
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
