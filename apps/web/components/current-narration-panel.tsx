type CurrentNarrationPanelProps = {
  slideId: string;
  currentNarrationDisplayText: string;
  currentNarrationIndex: number;
  narrationSegments: string[];
  isGeneratingNarrationAudio: boolean;
};

export const CurrentNarrationPanel = ({
  slideId,
  currentNarrationDisplayText,
  currentNarrationIndex,
  narrationSegments,
  isGeneratingNarrationAudio,
}: CurrentNarrationPanelProps) => (
  <div className="mt-6 rounded-[26px] bg-ink px-5 py-5 text-paper">
    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/55">
      Current narration
    </p>
    {isGeneratingNarrationAudio ? (
      <p className="mt-3 text-sm leading-6 text-paper/70">
        Generating spoken audio for this point. Playback starts automatically when the clip is
        ready.
      </p>
    ) : null}
    <p className="mt-3 max-h-40 min-h-24 overflow-y-auto pr-2 text-lg leading-8">
      {currentNarrationDisplayText}
    </p>
    {narrationSegments.length > 1 ? (
      <div className="mt-4 grid max-h-72 gap-2 overflow-y-auto pr-1">
        {narrationSegments.map((segment, index) => (
          <div
            className={`rounded-[16px] border px-3 py-2 text-sm leading-6 ${
              index === currentNarrationIndex
                ? "border-coral bg-coral/15 text-paper"
                : "border-white/10 bg-white/5 text-paper/70"
            }`}
            key={`${slideId}-${index}`}
          >
            <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper/50">
              {index + 1}
            </span>
            {segment}
          </div>
        ))}
      </div>
    ) : null}
  </div>
);
