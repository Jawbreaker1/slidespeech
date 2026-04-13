import type { Slide, SlideIllustrationAsset } from "@slidespeech/types";

import { VisualSlideCanvas } from "./visual-slide-canvas";

interface SlidePreviewCardProps {
  slide: Slide;
  isActive?: boolean;
  illustrationAsset?: SlideIllustrationAsset | undefined;
  slideNumber?: number;
}

export const SlidePreviewCard = ({
  slide,
  isActive = false,
  illustrationAsset,
  slideNumber,
}: SlidePreviewCardProps) => (
  <article
    className={`h-full overflow-hidden rounded-[22px] border p-4 shadow-panel transition md:p-5 ${
      isActive
        ? "border-coral bg-white"
        : "border-slate-200 bg-white/80"
    }`}
  >
    <div className="mb-3 flex items-center justify-between">
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">
        Slide {slideNumber ?? slide.order + 1}
      </span>
      {slide.canSkip ? (
        <span className="text-xs font-semibold text-teal">Can skip</span>
      ) : null}
    </div>
    <h3 className="line-clamp-2 text-lg font-semibold text-ink md:text-xl">
      {slide.title}
    </h3>
    <p className="mt-3 font-body text-sm leading-6 text-slate-700">
      {slide.learningGoal}
    </p>
    <div className="mt-4">
      <VisualSlideCanvas
        compact
        illustrationAsset={illustrationAsset}
        slide={slide}
      />
    </div>
  </article>
);
