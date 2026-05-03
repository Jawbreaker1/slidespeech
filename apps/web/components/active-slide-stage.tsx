import type { ReactNode } from "react";
import type { Slide } from "@slidespeech/types";

import { CurrentNarrationPanel } from "./current-narration-panel";

type ActiveSlideStageProps = {
  activeSlide: Slide;
  activeSlideCanvas: ReactNode;
  currentSlideIndex: number;
  currentNarrationIndex: number;
  currentNarrationDisplayText: string;
  isGeneratingNarrationAudio: boolean;
  isIllustrationLoading: boolean;
  narrationSegments: string[];
  provider: string;
  totalSlides: number;
};

export const ActiveSlideStage = ({
  activeSlide,
  activeSlideCanvas,
  currentSlideIndex,
  currentNarrationIndex,
  currentNarrationDisplayText,
  isGeneratingNarrationAudio,
  isIllustrationLoading,
  narrationSegments,
  provider,
  totalSlides,
}: ActiveSlideStageProps) => (
  <div className="rounded-[32px] bg-white p-4 text-ink shadow-2xl md:p-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
          Slide {currentSlideIndex + 1} of {totalSlides}
        </p>
        <h2 className="mt-2 text-3xl font-semibold md:text-4xl">
          {activeSlide.title}
        </h2>
        <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
          {activeSlide.learningGoal}
        </p>
      </div>
      <div className="rounded-[22px] bg-slate-100 px-4 py-3 text-sm text-slate-700">
        <p>
          Narration point {currentNarrationIndex + 1} /{" "}
          {Math.max(narrationSegments.length, 1)}
        </p>
        <p className="mt-1">Provider: {provider}</p>
      </div>
    </div>

    <div className="mt-5 rounded-[28px] border border-slate-200 bg-slate-50 p-3 md:p-5">
      {activeSlideCanvas}
      {isIllustrationLoading ? (
        <p className="mt-3 text-sm text-slate-500">Resolving slide illustration...</p>
      ) : null}
    </div>

    <CurrentNarrationPanel
      currentNarrationDisplayText={currentNarrationDisplayText}
      currentNarrationIndex={currentNarrationIndex}
      isGeneratingNarrationAudio={isGeneratingNarrationAudio}
      narrationSegments={narrationSegments}
      slideId={activeSlide.id}
    />
  </div>
);
