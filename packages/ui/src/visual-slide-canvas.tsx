import {
  getPrimarySlideIllustration,
  type SlideIllustrationAsset,
  type Slide,
  type SlideCallout,
  type SlideVisualCard,
  type SlideVisualTone,
} from "@slidespeech/types";

interface VisualSlideCanvasProps {
  slide: Slide;
  compact?: boolean;
  dark?: boolean;
  illustrationAsset?: SlideIllustrationAsset | undefined;
}

const FALLBACK_ACCENT = "1C7C7D";

const normalizeAccent = (value?: string) => {
  const normalized = value?.trim().replace(/^#/, "").toUpperCase();
  return normalized && /^[0-9A-F]{6}$/.test(normalized)
    ? `#${normalized}`
    : `#${FALLBACK_ACCENT}`;
};

const hostnameFromUrl = (value?: string) => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
};

const templateBadgeLabel = (value: Slide["visuals"]["layoutTemplate"]) => {
  switch (value) {
    case "hero-focus":
      return "Focus";
    case "three-step-flow":
      return "Flow";
    case "two-column-callouts":
      return "Compare";
    case "summary-board":
    default:
      return "Overview";
  }
};

const toneToSurface = (tone: SlideVisualTone, dark: boolean) => {
  if (dark) {
    switch (tone) {
      case "accent":
        return "border-white/20 bg-white/14 text-white shadow-[0_16px_40px_rgba(15,23,42,0.18)]";
      case "success":
        return "border-emerald-300/25 bg-emerald-400/12 text-emerald-50 shadow-[0_16px_40px_rgba(5,150,105,0.15)]";
      case "warning":
        return "border-amber-300/25 bg-amber-400/12 text-amber-50 shadow-[0_16px_40px_rgba(217,119,6,0.14)]";
      case "info":
        return "border-sky-300/25 bg-sky-400/12 text-sky-50 shadow-[0_16px_40px_rgba(37,99,235,0.14)]";
      case "neutral":
      default:
        return "border-white/10 bg-white/7 text-white/88 shadow-[0_16px_40px_rgba(15,23,42,0.12)]";
    }
  }

  switch (tone) {
    case "accent":
      return "border-slate-300 bg-white text-slate-900 shadow-[0_18px_40px_rgba(15,23,42,0.07)]";
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-900 shadow-[0_18px_40px_rgba(16,185,129,0.08)]";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-900 shadow-[0_18px_40px_rgba(245,158,11,0.09)]";
    case "info":
      return "border-sky-200 bg-sky-50 text-sky-900 shadow-[0_18px_40px_rgba(59,130,246,0.08)]";
    case "neutral":
    default:
      return "border-slate-200 bg-slate-50 text-slate-800 shadow-[0_18px_40px_rgba(15,23,42,0.05)]";
  }
};

const renderCard = (card: SlideVisualCard, dark: boolean, compact: boolean) => (
  <div
    className={`rounded-[20px] border p-3 ${toneToSurface(card.tone, dark)}`}
    key={card.id}
  >
    <p className={`font-semibold tracking-[-0.01em] ${compact ? "text-sm" : "text-[15px]"}`}>
      {card.title}
    </p>
    <p className={`mt-2 leading-6 ${compact ? "text-xs" : "text-sm"}`}>
      {card.body}
    </p>
  </div>
);

const renderCallout = (
  callout: SlideCallout,
  accent: string,
  dark: boolean,
  compact: boolean,
) => (
  <div
    className={`rounded-[18px] border px-3 py-3 ${
      dark ? "bg-white/8 text-white/90 shadow-[0_18px_40px_rgba(15,23,42,0.14)]" : "bg-white text-slate-800 shadow-[0_18px_40px_rgba(15,23,42,0.06)]"
    }`}
    key={callout.id}
    style={{ borderColor: `${accent}44`, borderLeftWidth: 4, borderLeftColor: accent }}
  >
    <p className={`font-semibold uppercase tracking-[0.16em] ${compact ? "text-[10px]" : "text-[11px]"}`}>
      {callout.label}
    </p>
    <p className={`mt-2 leading-6 ${compact ? "text-xs" : "text-sm"}`}>
      {callout.text}
    </p>
  </div>
);

const renderIllustrationFrame = (input: {
  illustration: SlideIllustrationAsset;
  slideTitle: string;
  dark: boolean;
  compact: boolean;
  accent: string;
  eyebrow?: string;
}) => (
  <div
    className={`overflow-hidden rounded-[22px] border p-2 ${
      input.dark
        ? "border-white/12 bg-white/7 shadow-[0_22px_50px_rgba(15,23,42,0.18)]"
        : "border-slate-200 bg-white shadow-[0_22px_50px_rgba(15,23,42,0.08)]"
    }`}
  >
    <div
      className={`mb-2 flex items-center justify-between rounded-[16px] px-3 py-2 ${
        input.dark ? "bg-white/6 text-white/70" : "bg-slate-50 text-slate-500"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
        {input.eyebrow ?? "Illustration"}
      </p>
      <span
        className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
        style={{
          backgroundColor: `${input.accent}18`,
          color: input.dark ? "#FFFFFF" : input.accent,
        }}
      >
        {input.illustration.sourceImageUrl ? "Source image" : "Visual"}
      </span>
    </div>
    <img
      alt={input.illustration.altText ?? input.slideTitle}
      className={`w-full rounded-[16px] object-cover ${
        input.compact ? "h-32" : "h-full min-h-52"
      }`}
      src={input.illustration.dataUri}
    />
    {input.illustration.sourcePageUrl ? (
      <p
        className={`mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] ${
          input.dark ? "text-white/48" : "text-slate-400"
        }`}
      >
        Image from {hostnameFromUrl(input.illustration.sourcePageUrl) ?? "external source"}
      </p>
    ) : null}
    {input.illustration.caption ? (
      <p
        className={`mt-2 text-xs leading-5 ${
          input.dark ? "text-white/60" : "text-slate-500"
        }`}
      >
        {input.illustration.caption}
      </p>
    ) : null}
  </div>
);

export const VisualSlideCanvas = ({
  slide,
  compact = false,
  dark = false,
  illustrationAsset,
}: VisualSlideCanvasProps) => {
  const visuals = slide.visuals;
  const accent = normalizeAccent(visuals.accentColor);
  const baseSurface = dark
    ? "border-white/10 bg-white/5 text-white"
    : "border-slate-200 bg-slate-50 text-slate-900";
  const illustration =
    illustrationAsset ??
    (() => {
      const fallback = getPrimarySlideIllustration(slide);
      if (!fallback) {
        return null;
      }

      return {
        slideId: slide.id,
        slotId: fallback.id,
        mimeType: "image/svg+xml",
        dataUri: fallback.dataUri,
        ...(fallback.altText ? { altText: fallback.altText } : {}),
        ...(fallback.caption ? { caption: fallback.caption } : {}),
      } satisfies SlideIllustrationAsset;
    })();
  const nodes =
    visuals.diagramNodes.length > 0
      ? visuals.diagramNodes
      : visuals.cards.slice(0, 3).map((card, index) => ({
          id: `${slide.id}-node-${index + 1}`,
          label: card.title,
          tone: card.tone,
        }));
  const keyPointChips = slide.keyPoints.slice(0, compact ? 2 : 3);
  const headingText = visuals.heroStatement ?? slide.learningGoal;

  return (
    <div
      className={`rounded-[28px] border p-4 ${baseSurface} ${compact ? "space-y-3" : "space-y-5"}`}
      style={{
        backgroundImage: `radial-gradient(circle at top right, ${accent}16 0%, transparent 26%), linear-gradient(135deg, ${accent}14 0%, transparent 45%)`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className={`font-semibold uppercase tracking-[0.22em] ${
              dark ? "text-white/55" : "text-slate-500"
            } ${compact ? "text-[10px]" : "text-[11px]"}`}
          >
            {visuals.eyebrow ?? slide.learningGoal}
          </p>
          <p className={`mt-2 font-semibold leading-tight tracking-[-0.02em] ${compact ? "text-base" : "text-xl"}`}>
            {headingText}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 font-semibold ${compact ? "text-[10px]" : "text-xs"}`}
          style={{
            backgroundColor: `${accent}20`,
            color: dark ? "#FFFFFF" : accent,
          }}
        >
          {templateBadgeLabel(visuals.layoutTemplate)}
        </span>
      </div>

      {keyPointChips.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {keyPointChips.map((point) => (
            <span
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                dark ? "bg-white/8 text-white/72" : "bg-white text-slate-600"
              }`}
              key={point}
            >
              {point}
            </span>
          ))}
        </div>
      ) : null}

      {visuals.layoutTemplate === "three-step-flow" ? (
        <div className={`grid gap-4 ${compact ? "grid-cols-1" : "grid-cols-[1.2fr_0.8fr]"}`}>
          <div className="space-y-4">
            <div className={`grid items-center gap-2 ${compact ? "grid-cols-1" : "grid-cols-[1fr_auto_1fr_auto_1fr]"}`}>
              {nodes.slice(0, 3).map((node, index) => (
                <div className="contents" key={node.id}>
                  <div
                    className={`rounded-[20px] border px-3 py-4 text-center ${toneToSurface(node.tone, dark)}`}
                  >
                    <p className={`font-semibold tracking-[-0.01em] ${compact ? "text-sm" : "text-base"}`}>
                      {node.label}
                    </p>
                  </div>
                  {index < Math.min(nodes.length, 3) - 1 && !compact ? (
                    <div
                      className={`text-center text-2xl font-semibold ${
                        dark ? "text-white/45" : "text-slate-400"
                      }`}
                    >
                      →
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {visuals.callouts.length > 0 ? (
              <div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
                {visuals.callouts.slice(0, compact ? 1 : 2).map((callout) =>
                  renderCallout(callout, accent, dark, compact),
                )}
              </div>
            ) : null}
          </div>
          {illustration && !compact ? (
            renderIllustrationFrame({
              illustration,
              slideTitle: slide.title,
              dark,
              compact,
              accent,
              eyebrow: "Process view",
            })
          ) : null}
        </div>
      ) : null}

      {visuals.layoutTemplate === "two-column-callouts" ? (
        <div className={`grid gap-4 ${compact ? "grid-cols-1" : "grid-cols-[minmax(0,1fr)_0.95fr]"}`}>
          <div className="grid gap-3">
            {visuals.cards.slice(0, compact ? 2 : 3).map((card) =>
              renderCard(card, dark, compact),
            )}
          </div>
          <div className="grid gap-3">
            {illustration ? (
              renderIllustrationFrame({
                illustration,
                slideTitle: slide.title,
                dark,
                compact,
                accent,
                eyebrow: "Key visual",
              })
            ) : null}
            {visuals.callouts.slice(0, compact ? 1 : 2).map((callout) =>
              renderCallout(callout, accent, dark, compact),
            )}
          </div>
        </div>
      ) : null}

      {visuals.layoutTemplate === "summary-board" ? (
        <div className="grid gap-3">
          <div className={`grid gap-4 ${compact ? "grid-cols-1" : "grid-cols-[1.15fr_0.85fr]"}`}>
            <div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
              {visuals.cards.slice(0, compact ? 2 : 3).map((card) =>
                renderCard(card, dark, compact),
              )}
              {visuals.callouts.length > 0 ? (
                visuals.callouts.slice(0, 1).map((callout) =>
                  renderCallout(callout, accent, dark, compact),
                )
              ) : (
                <div
                  className={`rounded-[22px] border px-4 py-4 ${
                    dark ? "border-white/10 bg-white/6 text-white/80" : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Summary
                  </p>
                  <p className="mt-3 text-sm leading-6">{slide.learningGoal}</p>
                </div>
              )}
            </div>
            {illustration ? (
              renderIllustrationFrame({
                illustration,
                slideTitle: slide.title,
                dark,
                compact,
                accent,
                eyebrow: "Overview visual",
              })
            ) : null}
          </div>
        </div>
      ) : null}

      {visuals.layoutTemplate === "hero-focus" ? (
        <div className="grid gap-4">
          <div className={`grid gap-4 ${compact ? "grid-cols-1" : "grid-cols-[1.15fr_0.85fr]"}`}>
            <div className="space-y-3">
              <div
                className={`rounded-[24px] border px-4 py-4 ${
                  dark
                    ? "border-white/10 bg-white/7 text-white shadow-[0_20px_50px_rgba(15,23,42,0.16)]"
                    : "border-slate-200 bg-white text-slate-900 shadow-[0_20px_50px_rgba(15,23,42,0.08)]"
                }`}
                style={{
                  backgroundImage: `linear-gradient(135deg, ${accent}15 0%, transparent 52%)`,
                }}
              >
                <p className={`font-semibold leading-tight tracking-[-0.02em] ${compact ? "text-lg" : "text-2xl"}`}>
                  {headingText}
                </p>
                <p className={`mt-3 leading-6 ${compact ? "text-xs" : "text-sm"} ${dark ? "text-white/72" : "text-slate-600"}`}>
                  {slide.beginnerExplanation}
                </p>
              </div>
              <div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-3"}`}>
                {visuals.cards.slice(0, 3).map((card) => renderCard(card, dark, compact))}
              </div>
            </div>
            {illustration ? (
              renderIllustrationFrame({
                illustration,
                slideTitle: slide.title,
                dark,
                compact,
                accent,
                eyebrow: "Featured visual",
              })
            ) : null}
          </div>
          {visuals.callouts.length > 0 ? (
            <div className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-2"}`}>
              {visuals.callouts.slice(0, compact ? 1 : 2).map((callout) =>
                renderCallout(callout, accent, dark, compact),
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
