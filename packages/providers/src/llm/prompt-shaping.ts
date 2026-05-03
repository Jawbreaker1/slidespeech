import {
  looksOverlyPromotionalSourceCopy,
  uniqueNonEmptyStrings,
} from "./deck-shape-text";

export const sanitizePromptShapingText = (value: string, topic: string): string => {
  const normalized = value
    .replace(/\bmore information is available at\b.*$/i, " ")
    .replace(/\buse google\b.*$/i, " ")
    .replace(
      /\b(?:our|my|the)\s+(?:company|organisation|organization|business|employer)\b/gi,
      topic,
    )
    .replace(
      /\b(?:create|make|build|generate|write|prepare)\s+(?:an?|the)?\s*(onboarding|orientation|overview|introduction)\s+presentation\b/gi,
      "$1",
    )
    .replace(/\b(?:create|make|build|generate|write|prepare)\s+(?:an?|the)?\s*presentation\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  return normalized;
};

export const compactGroundingSummary = (value: string): string => {
  const lines = value
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/^(Direct source grounding|Fallback web search after explicit source fetch failure|Search research \d+):\s*/i, "")
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

const splitCoverageRequirement = (value: string): string[] => {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/[.]+$/g, "");
  if (!normalized) {
    return [];
  }

  const explainWhyMatch = normalized.match(/^(.*?)\s+and\s+explain why\s+(.+)$/i);
  if (explainWhyMatch?.[1] && explainWhyMatch[2]) {
    const subject = explainWhyMatch[1].trim();
    const whyClause = explainWhyMatch[2]
      .trim()
      .replace(/\bit\b/gi, subject);
    return uniqueNonEmptyStrings([
      subject,
      `Why ${whyClause}`,
    ]);
  }

  const whyMatch = normalized.match(/^(.*?)\s+and why\s+(.+)$/i);
  if (whyMatch?.[1] && whyMatch[2]) {
    const subject = whyMatch[1].trim();
    const whyClause = whyMatch[2]
      .trim()
      .replace(/\bit\b/gi, subject);
    return uniqueNonEmptyStrings([
      subject,
      `Why ${whyClause}`,
    ]);
  }

  return [normalized];
};

export const extractCoverageRequirements = (value: string): string[] => {
  const descriptivePatterns = [
    /\binclude at least one slide about\s+([^.!?]+)(?:[.!?]|$)/gi,
    /\binclude a slide about\s+([^.!?]+)(?:[.!?]|$)/gi,
    /\bfocus on\s+([^.!?]+)(?:[.!?]|$)/gi,
    /\bcover\s+([^.!?]+)(?:[.!?]|$)/gi,
  ];
  const explainWhyPattern = /\bexplain why\s+([^.!?]+)(?:[.!?]|$)/gi;

  const results: string[] = [];
  const anchorSubjects: string[] = [];

  for (const pattern of descriptivePatterns) {
    for (const match of value.matchAll(pattern)) {
      const captured = match[1]?.replace(/\s+/g, " ").trim();
      if (captured && captured.length > 8) {
        const requirements = splitCoverageRequirement(captured);
        results.push(...requirements);
        const anchorSubject = requirements.find((requirement) => !/^why\b/i.test(requirement));
        if (anchorSubject) {
          anchorSubjects.push(anchorSubject);
        }
      }
    }
  }

  for (const match of value.matchAll(explainWhyPattern)) {
    const captured = match[1]?.replace(/\s+/g, " ").trim();
    if (captured && captured.length > 8) {
      const anchorSubject = anchorSubjects.at(-1);
      const normalizedCaptured = anchorSubject
        ? captured.replace(/\bit\b/gi, anchorSubject)
        : captured;
      results.push(`Why ${normalizedCaptured}`);
    }
  }

  return uniqueNonEmptyStrings(results).slice(0, 4);
};
