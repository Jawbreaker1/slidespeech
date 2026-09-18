import { createSlideLayoutFrame, type PresentationThemeId } from "@slidespeech/types";

/** A schematic of actual composition geometry, not a generated content preview. */
export function ThemePreview({ theme }: { theme: PresentationThemeId }) {
  const frame = createSlideLayoutFrame({ slideId: "theme_preview", themeId: theme,
    layoutId: "editorial-opening", layoutFamily: "hero", contentDensity: "sparse",
    visualRole: "hero", imageStrategy: "none", variationSeed: 0,
  }, {}, { heading: "Source Serif 4", body: "Source Sans 3" });
  return <svg viewBox="0 0 1280 720" aria-hidden="true" focusable="false" style={{ display: "block", width: "100%", height: "auto" }}>
    <rect width="1280" height="720" fill={`#${frame.background}`} />
    {frame.elements.map((element, index) => {
      if (element.kind === "rectangle") return <rect key={index} x={element.x} y={element.y} width={element.width} height={element.height} fill={`#${element.fill}`} />;
      if (element.kind !== "text" || element.contentPath?.[0] === "sourceLine") return null;
      if (element.contentPath?.[0] === "title") return <text key={index} x={element.x} y={element.y + element.size} fontFamily={JSON.stringify(element.font)} fontSize={element.size} fill={`#${element.color}`}>Your story</text>;
      const lines = Math.min(3, Math.floor(element.height / (element.size * 1.5)));
      return <g key={index} fill={`#${element.color}`} opacity="0.45">{Array.from({ length: lines }, (_, line) => <rect key={line} x={element.x} y={element.y + line * element.size * 1.5} width={element.width * (line === lines - 1 ? 0.55 : 0.9)} height={Math.max(3, element.size / 6)} />)}</g>;
    })}
  </svg>;
}
