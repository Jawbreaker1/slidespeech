type WorkingOverlayProps = {
  title: string;
  message: string;
  pendingPresentationStart: boolean;
  hasSlides: boolean;
  firstSlideReady: boolean;
  isGeneratingNarrationAudio: boolean;
};

export const WorkingOverlay = ({
  title,
  message,
  pendingPresentationStart,
  hasSlides,
  firstSlideReady,
  isGeneratingNarrationAudio,
}: WorkingOverlayProps) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/72 px-6 backdrop-blur-sm">
    <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-slate-950/90 px-6 py-6 shadow-2xl">
      <div className="flex items-center gap-4">
        <span className="inline-flex h-10 w-10 animate-spin rounded-full border-[3px] border-white/15 border-t-coral" />
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-paper/55">
            Working
          </p>
          <p className="mt-1 text-xl font-semibold text-paper">{title}</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-paper/75">{message}</p>
      {pendingPresentationStart && hasSlides ? (
        <div className="mt-5">
          <div className="h-2 overflow-hidden rounded-full bg-white/8">
            <div
              className="h-full rounded-full bg-coral transition-[width] duration-300"
              style={{
                width: firstSlideReady ? "100%" : "35%",
              }}
            />
          </div>
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-paper/45">
            {firstSlideReady ? "First slide ready" : "Preparing first slide"}
          </p>
        </div>
      ) : isGeneratingNarrationAudio ? (
        <div className="mt-5 rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-paper/75">
          The presenter will start speaking automatically as soon as the audio clip is ready.
        </div>
      ) : null}
    </div>
  </div>
);
