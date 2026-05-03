import type { Slide } from "@slidespeech/types";

import {
  countAnchorOverlap,
  looksFragmentarySlidePoint,
  toAudienceFacingSentence,
  tokenizeDeckShapeText,
  uniqueNonEmptyStrings,
} from "./deck-shape-text";

const PLAIN_TEXT_SLIDE_SECTION_ALIASES = {
  title: ["TITLE", "SLIDE TITLE"],
  goal: ["GOAL", "LEARNING GOAL", "OBJECTIVE"],
  points: ["POINTS", "KEY POINTS"],
  beginner: ["BEGINNER", "BEGINNER EXPLANATION"],
  advanced: ["ADVANCED", "ADVANCED EXPLANATION"],
  example: ["EXAMPLE", "EXAMPLES"],
  question: ["QUESTION", "LIKELY QUESTION"],
} as const;

type PlainTextSlideSectionKey = keyof typeof PLAIN_TEXT_SLIDE_SECTION_ALIASES;

const PLAIN_TEXT_SLIDE_HEADER_TO_SECTION = new Map<string, PlainTextSlideSectionKey>(
  Object.entries(PLAIN_TEXT_SLIDE_SECTION_ALIASES).flatMap(([section, aliases]) =>
    aliases.map((alias) => [alias, section as PlainTextSlideSectionKey]),
  ),
);

const parsePlainTextSlideSections = (
  text: string,
): Record<PlainTextSlideSectionKey, string> => {
  const sections: Record<PlainTextSlideSectionKey, string[]> = {
    title: [],
    goal: [],
    points: [],
    beginner: [],
    advanced: [],
    example: [],
    question: [],
  };
  let currentSection: PlainTextSlideSectionKey | null = null;

  for (const rawLine of text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").split("\n")) {
    const line = rawLine.trimEnd();
    const headerMatch = line.match(/^\s*([\p{L}][\p{L} ]{1,40})\s*:\s*(.*)$/u);
    if (headerMatch) {
      const normalizedHeader = headerMatch[1]!.replace(/\s+/g, " ").trim().toUpperCase();
      const section = PLAIN_TEXT_SLIDE_HEADER_TO_SECTION.get(normalizedHeader) ?? null;
      if (section) {
        currentSection = section;
        const inlineValue = headerMatch[2]?.trim();
        if (inlineValue) {
          sections[section].push(inlineValue);
        }
        continue;
      }
    }

    if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  return {
    title: sections.title.join("\n").trim(),
    goal: sections.goal.join("\n").trim(),
    points: sections.points.join("\n").trim(),
    beginner: sections.beginner.join("\n").trim(),
    advanced: sections.advanced.join("\n").trim(),
    example: sections.example.join("\n").trim(),
    question: sections.question.join("\n").trim(),
  };
};

export const buildSlideFromPlainText = (
  text: string,
  slide: Slide,
): Record<string, unknown> | null => {
  const normalizeInlineText = (value: string): string =>
    value.replace(/\s+/g, " ").trim();

  const splitPlainTextSlidePoints = (value: string): string[] =>
    (() => {
      const normalized = value
        .replace(/\n(?=[^\n]*?:\s*$)/g, "\n")
        .replace(/\s+[•*-]\s+/g, "\n- ")
        .trim();
      const bulletLikeEntries = normalized
        .split(/\n+/)
        .flatMap((line) => line.split(/(?<=\.)\s+(?=[•*-]\s+|\d+[.)]\s+)/))
        .map((entry) => entry.replace(/^[\s\-*•\d.)]+/, ""))
        .map(normalizeInlineText)
        .filter(Boolean);

      if (bulletLikeEntries.length >= 3) {
        return bulletLikeEntries;
      }

      return normalized
        .split(/(?<=[.!?])\s+/)
        .map((entry) => entry.replace(/^[\s\-*•\d.)]+/, ""))
        .map(normalizeInlineText)
        .filter(Boolean);
    })();

  const collectSupplementalSentences = (values: string[]): string[] =>
    uniqueNonEmptyStrings(
      values
        .flatMap((value) =>
          value
            .split(/(?<=[.!?])\s+/)
            .map(normalizeInlineText)
            .filter((sentence) => sentence.length >= 24),
        ),
    );

  const sections = parsePlainTextSlideSections(text);
  const title = normalizeInlineText(sections.title);
  const learningGoal = normalizeInlineText(sections.goal);
  const pointsBlock = sections.points;
  const beginnerExplanation = normalizeInlineText(sections.beginner);
  const advancedExplanation = normalizeInlineText(sections.advanced);
  const example = normalizeInlineText(sections.example);
  const question = normalizeInlineText(sections.question);
  const effectiveTitle = title || slide.title;
  const effectiveLearningGoal = learningGoal || slide.learningGoal;
  const pointCandidates = uniqueNonEmptyStrings([
    ...splitPlainTextSlidePoints(pointsBlock),
    ...collectSupplementalSentences([
      beginnerExplanation,
      advancedExplanation,
      example,
    ]),
  ]);
  const pointAnchor = [
    effectiveTitle,
    effectiveLearningGoal,
    slide.title,
    slide.learningGoal,
  ].join(" ");
  const rankedPointCandidates = pointCandidates
    .map((value) => ({
      value,
      score:
        countAnchorOverlap(value, pointAnchor) * 2 +
        (looksFragmentarySlidePoint(value) ? 0 : 3) +
        (/[.!?]$/.test(value) ? 1 : 0) +
        Math.min(2, Math.floor(tokenizeDeckShapeText(value).length / 6)),
    }))
    .sort((left, right) => right.score - left.score);
  const keyPoints = rankedPointCandidates
    .map((candidate) => candidate.value)
    .map((value) => toAudienceFacingSentence(value))
    .filter(Boolean)
    .slice(0, 3);

  if (!effectiveTitle || !effectiveLearningGoal || keyPoints.length < 3) {
    return null;
  }

  return {
    ...(slide as unknown as Record<string, unknown>),
    title: effectiveTitle,
    learningGoal: effectiveLearningGoal,
    keyPoints,
    speakerNotes: [],
    examples: example ? [example] : [],
    likelyQuestions: question ? [question] : [],
    beginnerExplanation,
    advancedExplanation,
    id: slide.id,
    order: slide.order,
  };
};
