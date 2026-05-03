import type {
  PresentationTheme,
  Slide,
  SlideIllustrationAsset,
} from "@slidespeech/types";

import { VisualSlideCanvas } from "./visual-slide-canvas";

interface SlidePreviewCardProps {
  slide: Slide;
  isActive?: boolean;
  illustrationAsset?: SlideIllustrationAsset | undefined;
  slideNumber?: number;
  theme?: PresentationTheme | undefined;
}

export const SlidePreviewCard = ({
  slide,
  isActive = false,
  illustrationAsset,
  slideNumber,
  theme,
}: SlidePreviewCardProps) => (
  <article
    className={`h-full overflow-hidden rounded-[24px] border p-3 shadow-panel transition ${
      isActive
        ? "border-coral bg-white shadow-[0_18px_50px_rgba(255,91,78,0.16)]"
        : "border-slate-200 bg-white/75 hover:border-slate-300 hover:bg-white"
    }`}
  >
    <div className="relative aspect-video overflow-hidden rounded-[20px] bg-slate-100">
      <VisualSlideCanvas
        illustrationAsset={illustrationAsset}
        slide={slide}
        thumbnail
        theme={theme}
      />
      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
        <span className="rounded-full bg-slate-950/72 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white shadow-sm backdrop-blur">
          Slide {slideNumber ?? slide.order + 1}
        </span>
        {isActive ? (
          <span className="rounded-full bg-coral px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm">
            Current
          </span>
        ) : null}
      </div>
    </div>
    <div className="mt-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="line-clamp-1 text-sm font-semibold text-ink">
          {slide.title}
        </h3>
        <p className="mt-1 line-clamp-2 font-body text-xs leading-5 text-slate-600">
          {slide.learningGoal}
        </p>
      </div>
      {slide.canSkip ? (
        <span className="shrink-0 rounded-full bg-teal/10 px-2.5 py-1 text-[10px] font-semibold text-teal">
          Skip
        </span>
      ) : null}
    </div>
  </article>
);
