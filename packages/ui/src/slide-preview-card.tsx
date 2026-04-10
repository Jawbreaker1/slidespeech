import type { Slide } from "@slidespeech/types";

interface SlidePreviewCardProps {
  slide: Slide;
  isActive?: boolean;
}

export const SlidePreviewCard = ({
  slide,
  isActive = false,
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
        Slide {slide.order + 1}
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
    <ul className="mt-4 space-y-2 text-sm text-slate-700">
      {slide.keyPoints.map((point) => (
        <li key={point} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-coral" />
          <span className="line-clamp-2">{point}</span>
        </li>
      ))}
    </ul>
  </article>
);
