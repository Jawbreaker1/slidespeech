interface PresenterControlsProps {
  canGoBack: boolean;
  canGoForward: boolean;
  isBusy?: boolean;
  isPresenting: boolean;
  onBack: () => void;
  onTogglePresenting: () => void;
  onForward: () => void;
  presentLabel?: string;
}

const buttonClassName =
  "rounded-full border border-ink px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 disabled:hover:bg-transparent";

export const PresenterControls = ({
  canGoBack,
  canGoForward,
  isBusy = false,
  isPresenting,
  onBack,
  onTogglePresenting,
  onForward,
  presentLabel,
}: PresenterControlsProps) => (
  <div className="flex flex-wrap gap-2.5">
    <button
      className={buttonClassName}
      disabled={!canGoBack}
      onClick={onBack}
      type="button"
    >
      Previous slide
    </button>
    <button
      className="rounded-full bg-coral px-5 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
      disabled={isBusy}
      onClick={onTogglePresenting}
      type="button"
    >
      {presentLabel ?? (isPresenting ? "Pause" : "Present")}
    </button>
    <button
      className={buttonClassName}
      disabled={!canGoForward}
      onClick={onForward}
      type="button"
    >
      Next slide
    </button>
  </div>
);
