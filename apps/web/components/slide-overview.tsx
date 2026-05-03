import type {
  PresentationTheme,
  Slide,
  SlideIllustrationAsset,
} from "@slidespeech/types";
import { SlidePreviewCard } from "@slidespeech/ui";

type SlideOverviewProps = {
  slides: Slide[];
  currentSlideIndex: number;
  illustrationsBySlideId: Record<string, SlideIllustrationAsset>;
  theme?: PresentationTheme | undefined;
  onSelectSlide: (slideIndex: number) => void;
};

export const SlideOverview = ({
  slides,
  currentSlideIndex,
  illustrationsBySlideId,
  theme,
  onSelectSlide,
}: SlideOverviewProps) => (
  <section className="mt-6">
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-lg font-semibold">Slides</h3>
      <p className="text-sm text-paper/55">Choose any slide in the current deck.</p>
    </div>
    <div className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
      {slides.map((slide, index) => (
        <button
          className="min-w-0 text-left"
          key={slide.id}
          onClick={() => onSelectSlide(index)}
          type="button"
        >
          <SlidePreviewCard
            isActive={index === currentSlideIndex}
            illustrationAsset={illustrationsBySlideId[slide.id]}
            slide={slide}
            slideNumber={index + 1}
            theme={theme}
          />
        </button>
      ))}
    </div>
  </section>
);
