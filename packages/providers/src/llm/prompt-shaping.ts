import {
  looksOverlyPromotionalSourceCopy,
  uniqueNonEmptyStrings,
} from "./deck-shape-text";

const GROUNDING_SUMMARY_LABEL_PATTERN =
  /^(?:Direct source grounding|Search research \d+):\s*/i;

export const compactGroundingSummary = (value: string): string => {
  const lines = value
    .split(/\n+/)
    .map((line) =>
      line
        .replace(GROUNDING_SUMMARY_LABEL_PATTERN, "")
        .replace(/\bsubscribe now\b/gi, " ")
        .replace(/\blearn more\b/gi, " ")
        .replace(/\b6-month subscription offer\b/gi, " ")
        .replace(/\bblaze through\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .filter((line) => !looksOverlyPromotionalSourceCopy(line));

  const uniqueLines = uniqueNonEmptyStrings(lines);
  const compact = uniqueLines.slice(0, 6).join(" ");
  return compact.length > 1400 ? compact.slice(0, 1400).trim() : compact;
};
