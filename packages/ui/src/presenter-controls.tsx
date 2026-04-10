interface PresenterControlsProps {
  canGoBack: boolean;
  canGoForward: boolean;
  isPresenting: boolean;
  onBack: () => void;
  onTogglePresenting: () => void;
  onForward: () => void;
}

const buttonClassName =
  "rounded-full border border-ink px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:hover:bg-transparent";

export const PresenterControls = ({
  canGoBack,
  canGoForward,
  isPresenting,
  onBack,
  onTogglePresenting,
  onForward,
}: PresenterControlsProps) => (
  <div className="flex flex-wrap gap-2.5">
    <button
      className={buttonClassName}
      disabled={!canGoBack}
      onClick={onBack}
      type="button"
    >
      Back
    </button>
    <button
      className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white transition hover:brightness-95"
      onClick={onTogglePresenting}
      type="button"
    >
      {isPresenting ? "Pause" : "Present"}
    </button>
    <button
      className={buttonClassName}
      disabled={!canGoForward}
      onClick={onForward}
      type="button"
    >
      Next
    </button>
  </div>
);
