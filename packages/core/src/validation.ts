import type { Deck, Slide, SlideNarration } from "@slidespeech/types";

type ValidationIssue = {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
  slideId?: string;
};

type ValidationResult<T> = {
  value: T;
  issues: ValidationIssue[];
  repaired: boolean;
};

type AudienceFacingSource =
  | "speakerNote"
  | "keyPoint"
  | "example"
  | "callout"
  | "diagramNode"
  | "explanation";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "we",
  "will",
  "with",
  "you",
  "your",
]);

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

const unique = <T>(values: T[]): T[] => [...new Set(values)];

const tokenOverlapRatio = (left: string, right: string): number => {
  const leftTokens = unique(tokenize(left));
  const rightTokens = unique(tokenize(right));

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length);
};

const slideConceptTokens = (slide: Slide): string[] =>
  unique(
    tokenize(
      [
        slide.title,
        slide.learningGoal,
        slide.beginnerExplanation,
        ...slide.keyPoints,
        ...slide.visuals.cards.map((card) => `${card.title} ${card.body}`),
        ...slide.visuals.callouts.map((callout) => `${callout.label} ${callout.text}`),
        ...slide.visuals.diagramNodes.map((node) => node.label),
      ].join(" "),
    ),
  );

const PRESENTATION_META_PATTERNS = [
  /\bfor every slide\b/i,
  /\bthis slide\b/i,
  /\bthis session\b/i,
  /\bslides?\b/i,
  /\btext-heavy slide\b/i,
  /\bparagraphs? of text\b/i,
  /\buse screenshots?\b/i,
  /\bhigh-resolution\b/i,
  /\bavoid clutter(?:ing)?\b/i,
  /\bfollow key point\b/i,
  /\bvisual storytelling over text\b/i,
  /\bcompare a text-heavy slide\b/i,
  /\baudience will stop listening\b/i,
  /\bblueprint for your first deck\b/i,
  /\bshort opener\b/i,
  /\bvisually simple\b/i,
  /\bclean slide design\b/i,
  /\bour mission\b/i,
  /\bto wrap up\b/i,
  /\bnext steps?\b/i,
  /\borients? you\b/i,
  /^\s*welcome everyone\b/i,
];

const GENERIC_AUDIENCE_LANGUAGE_PATTERNS = [
  /\bis one concrete part of\b/i,
  /\bmatters because it shows how\b/i,
  /\bhelps explain how\b/i,
  /\bin practice, .+ shapes how .+ works\b/i,
  /\baffects real decisions, risks, or outcomes\b/i,
  /^\s*transition to\b/i,
  /^\s*term success derived from\b/i,
  /^\s*use specific\b/i,
];

const INFORMATIVE_STATEMENT_PATTERN =
  /\b(is|are|was|were|helps?|support(?:s)?|show(?:s)?|mean(?:s)?|include(?:s)?|use(?:s|d)?|serve(?:s|d)?|function(?:s)?|operate(?:s)?|connect(?:s)?|explain(?:s|ed)?|confirm(?:s|ed)?|provide(?:s|d)?|ensure(?:s|d)?|adapt(?:s|ed)?|improve(?:s|d)?|reduce(?:s|d)?|allow(?:s|ed)?|span(?:s|ned)?|cover(?:s|ed)?|enable(?:s|d)?)\b/i;

const PRESENTATION_DESIGN_TOPIC_PATTERNS = [
  /\bslide design\b/i,
  /\bpowerpoint\b/i,
  /\bkeynote\b/i,
  /\bpitch deck\b/i,
  /\bvisual communication\b/i,
  /\bpresentation design\b/i,
  /\bslide-making\b/i,
  /\bhow to present\b/i,
  /\bhow to make slides\b/i,
  /\bvisual storytelling\b/i,
];

const countMetaMatches = (value: string): number =>
  PRESENTATION_META_PATTERNS.reduce(
    (sum, pattern) => sum + (pattern.test(value) ? 1 : 0),
    0,
  );

const META_REPAIR_AVOID_PATTERNS = [
  ...PRESENTATION_META_PATTERNS,
  /\bslide-building advice\b/i,
  /\bpresentation technique\b/i,
  /\bpresentation mechanics\b/i,
  /\bdesign slides\b/i,
  /\bsubject of the talk\b/i,
  /\bmain subject\b/i,
  /\btopic-focused visual\b/i,
  /\binstructions? for how to\b/i,
  /\brather than (?:on )?how slides should be constructed\b/i,
  /^\s*(walk through|review|direct new hires|show the audience|tell the audience|emphasize|map out|validate that|highlight)\b/i,
  /\binternal portal\b/i,
  /\bcore messaging\b/i,
  /^\s*how do i\b/i,
  /\binternal ai tools?\b/i,
  /\btraining on\b/i,
  /\byour first deck\b/i,
  /\bshould be explained with a clear connection back to\b/i,
  /\bthe audience should leave this slide understanding\b/i,
  /^\s*explain that\b/i,
  /^\s*begin by\b/i,
  /^\s*focus on\b/i,
  /^\s*discuss\b/i,
  /^\s*establish that\b/i,
  /^\s*mention\b/i,
  /^\s*note that\b/i,
  /^\s*point out\b/i,
  /^\s*call out\b/i,
  /^a concrete example, consequence, or real-world application of\b/i,
  /^the main services, products, or focus areas connected to\b/i,
  /^the main systems, parts, or focus areas that define\b/i,
  /\bthis session\b/i,
  /\bour mission\b/i,
  /\bto wrap up\b/i,
  /\bnext steps?\b/i,
  /\borients? you\b/i,
  /^\s*welcome everyone\b/i,
];

const topicAllowsPresentationMeta = (topic: string): boolean =>
  PRESENTATION_DESIGN_TOPIC_PATTERNS.some((pattern) => pattern.test(topic));

const deckLooksSystemicallyMeta = (deck: Deck, slides: Slide[]): boolean => {
  if (topicAllowsPresentationMeta(deck.topic)) {
    return false;
  }

  const metaLikeSlides = slides.filter((slide) => {
    const slideText = [
      slide.title,
      slide.learningGoal,
      slide.beginnerExplanation,
      slide.advancedExplanation,
      ...slide.keyPoints,
      ...slide.examples,
      ...slide.visualNotes,
      ...slide.visuals.cards.map((card) => `${card.title} ${card.body}`),
      ...slide.visuals.callouts.map((callout) => `${callout.label} ${callout.text}`),
    ].join(" ");

    return countMetaMatches(slideText) >= 1;
  }).length;

  return metaLikeSlides >= Math.max(2, Math.ceil(slides.length / 2));
};

const isMetaPresentationSlide = (deck: Deck, slide: Slide): boolean => {
  if (topicAllowsPresentationMeta(deck.topic)) {
    return false;
  }

  const slideText = [
    slide.title,
    slide.learningGoal,
    slide.beginnerExplanation,
    slide.advancedExplanation,
    ...slide.keyPoints,
    ...slide.examples,
    ...slide.visualNotes,
    ...slide.visuals.cards.map((card) => `${card.title} ${card.body}`),
    ...slide.visuals.callouts.map((callout) => `${callout.label} ${callout.text}`),
  ].join(" ");
  const metaMatches = countMetaMatches(slideText);
  const topicTokens = unique(tokenize(deck.topic));
  const slideTokens = slideConceptTokens(slide);
  const topicOverlap = topicTokens.filter((token) => slideTokens.includes(token));

  return (
    metaMatches >= 2 ||
    (metaMatches >= 1 && topicOverlap.length < Math.max(2, Math.floor(topicTokens.length / 3)))
  );
};

const splitStatements = (values: string[]): string[] =>
  values
    .flatMap((value) =>
      value
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+|\s*;\s*|\s*\n+\s*/)
        .map((segment) => segment.trim()),
    )
    .filter(Boolean);

const uniqueStatements = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
};

const ensureSentence = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const looksFragmentaryAudienceStatement = (value: string): boolean => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return true;
  }

  if (/^[a-z]/.test(trimmed)) {
    return true;
  }

  if (hasConcreteDetailSignals(trimmed)) {
    return false;
  }

  const tokens = unique(tokenize(trimmed));
  return tokens.length >= 5 && !INFORMATIVE_STATEMENT_PATTERN.test(trimmed);
};

const hasConcreteDetailSignals = (value: string): boolean => {
  if (/\b\d{1,4}\b/.test(value)) {
    return true;
  }

  const properNouns =
    value.match(/\b[A-Z][a-z]+(?:['-][A-Z][a-z]+)*\b/g)?.filter(
      (token) => !["A", "An", "The", "This", "That", "In"].includes(token),
    ) ?? [];
  if (properNouns.length >= 1) {
    return true;
  }

  return /\b(research(?:er|ers)?|stud(?:y|ied|ies)|outbreak|incident|quarantine|contagion|epidemi\w*|spread|leaked|launched|founded|released|observed|measured|boss)\b/i.test(
    value,
  );
};

const paraphraseForNarration = (value: string, index: number): string => {
  let normalized = value.replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  if (!normalized) {
    return "";
  }

  const replacements: Array<[RegExp, string]> = [
    [/\bDD\s*&\s*Insights\b/gi, "data and insight work"],
    [/\bQA Operations\b/gi, "quality-assurance operations"],
    [/\bAI-accelerated\b/gi, "AI-supported"],
    [/\bleverages\b/gi, "uses"],
    [/\bwhile maintaining\b/gi, "and still keeps"],
    [/\bensures\b/gi, "helps make sure"],
    [/\bdrive(s|)\b/gi, "support$1"],
    [/\bbridges the gap between\b/gi, "connects"],
    [/\blead to\b/gi, "show up as"],
    [/\ballow us to see deeper into\b/gi, "give the team a clearer view into"],
  ];

  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = normalized.replace(/^our\s+/i, "the company's ");
  normalized = normalized.replace(/^we\s+/i, "the team ");
  normalized = normalized.replace(/^this slide\s+/i, "");

  const lowered = normalized.charAt(0).toLowerCase() + normalized.slice(1);
  const prefix =
    index === 0
      ? "A practical point here is that "
      : index === 1
        ? "Another thing to notice is that "
        : "This also means that ";

  return ensureSentence(`${prefix}${lowered}`);
};

const buildNarrationSupportStatements = (slide: Slide): string[] =>
  uniqueStatements(
    [
      ...splitStatements([
        slide.beginnerExplanation,
        slide.advancedExplanation,
        ...slide.speakerNotes.filter((note) => /[.!?]\s*$/.test(note.trim())),
      ]),
      ...slide.keyPoints.slice(0, 3),
      ...slide.examples.slice(0, 1).map((example) => `A concrete example is ${example}`),
    ]
      .map((value, index) => paraphraseForNarration(value, index))
      .filter((value) => value.length >= 24),
  );

const looksUsefulForMetaRepair = (
  deck: Deck,
  slide: Slide,
  value: string,
  source: AudienceFacingSource = "keyPoint",
): boolean => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length < 24) {
    return false;
  }

  if (
    META_REPAIR_AVOID_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    GENERIC_AUDIENCE_LANGUAGE_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    looksFragmentaryAudienceStatement(trimmed)
  ) {
    return false;
  }

  const deckTokens = unique(tokenize(deck.topic));
  const titleTokens = unique(tokenize(slide.title));
  const statementTokens = unique(tokenize(trimmed));
  if (/\?$/.test(trimmed)) {
    return false;
  }
  const overlapCount = [...deckTokens, ...titleTokens].filter((token) =>
    statementTokens.includes(token),
  ).length;

  if (overlapCount >= 1) {
    return true;
  }

  if (
    ["diagramNode", "callout", "example", "speakerNote"].includes(source) &&
    hasConcreteDetailSignals(trimmed)
  ) {
    return true;
  }

  return false;
};

const buildAudienceFacingStatements = (deck: Deck, slide: Slide): string[] => {
  const candidates: Array<{ source: AudienceFacingSource; text: string }> = [
    ...slide.speakerNotes.map((text) => ({ source: "speakerNote" as const, text })),
    ...slide.keyPoints.map((text) => ({ source: "keyPoint" as const, text })),
    ...slide.examples.map((text) => ({ source: "example" as const, text })),
    ...slide.visuals.callouts.map((callout) => ({
      source: "callout" as const,
      text: callout.text,
    })),
    ...slide.visuals.diagramNodes.map((node) => ({
      source: "diagramNode" as const,
      text: node.label,
    })),
    { source: "explanation" as const, text: slide.beginnerExplanation },
    { source: "explanation" as const, text: slide.advancedExplanation },
  ]
    .flatMap(({ source, text }) =>
      splitStatements([text]).map((statement) => ({ source, text: statement })),
    )
    .filter(({ source, text }) => looksUsefulForMetaRepair(deck, slide, text, source));

  const bestByStatement = new Map<string, { source: AudienceFacingSource; text: string }>();
  for (const candidate of candidates) {
    const key = candidate.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const existing = bestByStatement.get(key);
    const sourcePriority = (value: AudienceFacingSource) =>
      value === "diagramNode"
        ? 5
        : value === "callout"
          ? 4
          : value === "example"
            ? 3
            : value === "speakerNote"
              ? 2
              : value === "explanation"
                ? 1
                : 0;
    if (!existing || sourcePriority(candidate.source) > sourcePriority(existing.source)) {
      bestByStatement.set(key, candidate);
    }
  }

  const ranked = [...bestByStatement.values()].sort((left, right) => {
    const score = ({ source, text }: { source: AudienceFacingSource; text: string }) => {
      const sourceBoost =
        source === "diagramNode"
          ? 6
          : source === "callout"
            ? 4
            : source === "example"
              ? 3
              : source === "speakerNote"
                ? 2
                : 1;
      const value = text;
      const tokens = unique(tokenize(value));
      const titleOverlap = tokenize(slide.title).filter((token) => tokens.includes(token)).length;
      const deckOverlap = tokenize(deck.topic).filter((token) => tokens.includes(token)).length;
      const numericBoost = /\b\d+\b/.test(value) ? 1 : 0;
      const detailBoost = hasConcreteDetailSignals(value) ? 2 : 0;
      return sourceBoost + titleOverlap * 3 + deckOverlap * 2 + numericBoost + detailBoost;
    };

    return score(right) - score(left);
  });

  return ranked.slice(0, 3).map((candidate) => candidate.text);
};

const buildDeckLevelConcreteStatements = (deck: Deck, currentSlide: Slide): string[] =>
  uniqueStatements(
    deck.slides
      .filter((slide) => slide.id !== currentSlide.id)
      .flatMap((slide) => buildAudienceFacingStatements(deck, slide))
      .filter((statement) => {
        const tokens = unique(tokenize(statement));
        const deckOverlap = tokenize(deck.topic).filter((token) => tokens.includes(token)).length;
        return hasConcreteDetailSignals(statement) || deckOverlap >= 1;
      }),
  ).slice(0, 3);

const buildAudienceFacingLearningGoal = (deck: Deck, slide: Slide): string => {
  const normalizedTitle = normalizeAudienceFacingTitle(deck, slide);
  const lowerTitle = normalizedTitle.charAt(0).toLowerCase() + normalizedTitle.slice(1);

  if (slide.order === 0) {
    return `Understand what ${deck.topic} is, why it matters, and one concrete way it shows up in practice.`;
  }

  if (/^why\b/i.test(normalizedTitle)) {
    return `Understand why ${deck.topic} matters in practice.`;
  }

  if (/^what\b/i.test(normalizedTitle)) {
    return `Understand what ${deck.topic} is and why it matters.`;
  }

  if (/^core systems and focus areas$/i.test(normalizedTitle)) {
    return `Understand the main systems, features, or focus areas that define ${deck.topic}.`;
  }

  return `Understand how ${lowerTitle} contributes to ${deck.topic}.`;
};

const buildAudienceFacingFallbackStatements = (deck: Deck, slide: Slide): string[] => {
  const normalizedTitle = normalizeAudienceFacingTitle(deck, slide);
  const lowerTitle = normalizedTitle.toLowerCase();
  const titleTokens = unique(tokenize(normalizedTitle));
  const topicTokens = unique(tokenize(deck.topic));
  const overlapCount = titleTokens.filter((token) => topicTokens.includes(token)).length;
  const titleMostlyRepeatsTopic =
    titleTokens.length > 0 &&
    overlapCount >= Math.max(1, Math.ceil(titleTokens.length * 0.6));

  if (slide.order === 0 || /^why\b/i.test(normalizedTitle) || titleMostlyRepeatsTopic) {
    return uniqueStatements([
      `${deck.topic} influences real outcomes, not just abstract descriptions.`,
      `In practice, understanding ${deck.topic} changes decisions, priorities, or behavior.`,
      `That is why ${deck.topic} matters beyond a simple definition.`,
    ]);
  }

  return uniqueStatements([
    `${normalizedTitle} reveals a specific part of how ${deck.topic} works.`,
    `The main takeaway is that ${lowerTitle} becomes clearer when you connect it to concrete evidence.`,
    `Seen in context, ${lowerTitle} makes ${deck.topic} more specific and easier to apply.`,
  ]);
};

const normalizeAudienceFacingTitle = (deck: Deck, slide: Slide): string => {
  const normalized = slide.title.replace(/[.:!?]+$/g, "").trim();
  const compact = normalized
    .replace(/^the main services, products, or focus areas connected to\b.*$/i, "Core services and focus areas")
    .replace(/^the main systems, parts, or focus areas that define\b.*$/i, "Core systems and focus areas")
    .replace(/^services, products, and core focus areas$/i, "Core systems and focus areas")
    .replace(
      /^a concrete example, consequence, or real-world application of\b.*$/i,
      "Real-world applications",
    )
    .replace(/^application in\b/i, "Applications in")
    .replace(/^the most important lessons about\b.*$/i, "Key takeaways")
    .replace(/^what .* is and why it matters$/i, `Why ${deck.topic} matters`)
    .replace(/\s+/g, " ")
    .trim();

  if (!compact) {
    return slide.order === 0 ? `Why ${deck.topic} matters` : slide.title;
  }

  return compact.charAt(0).toUpperCase() + compact.slice(1);
};

const buildAudienceFacingVisualPrompt = (deck: Deck, slide: Slide, statements: string[]): string => {
  const focus = statements.slice(0, 2).join(" ");
  return `Editorial presentation visual about ${deck.topic}: ${slide.title}. ${focus}`;
};

const slideNeedsLanguageRepair = (deck: Deck, slide: Slide): boolean => {
  const normalizedTitle = normalizeAudienceFacingTitle(deck, slide);
  const learningGoal = slide.learningGoal.replace(/\s+/g, " ").trim();
  const awkwardLearningGoal =
    /^understand how why\b/i.test(learningGoal) ||
    /^understand how what\b/i.test(learningGoal) ||
    (/^why\b/i.test(normalizedTitle) && /\bcontributes to\b/i.test(learningGoal)) ||
    (/^what\b/i.test(normalizedTitle) && /\bcontributes to\b/i.test(learningGoal)) ||
    (/^core systems and focus areas$/i.test(normalizedTitle) &&
      /\bcontributes to\b/i.test(learningGoal));
  const weakKeyPoints = slide.keyPoints.some(
    (point) =>
      META_REPAIR_AVOID_PATTERNS.some((pattern) => pattern.test(point)) ||
      GENERIC_AUDIENCE_LANGUAGE_PATTERNS.some((pattern) => pattern.test(point)) ||
      looksFragmentaryAudienceStatement(point),
  );

  return awkwardLearningGoal || weakKeyPoints;
};

const repairMetaPresentationSlide = (deck: Deck, slide: Slide): Slide => {
  const normalizedTitle = normalizeAudienceFacingTitle(deck, slide);
  const repairedStatements = buildAudienceFacingStatements(deck, slide);
  const deckLevelStatements =
    repairedStatements.length >= 2 ? [] : buildDeckLevelConcreteStatements(deck, slide);
  const repairedKeyPoints =
    uniqueStatements([
      ...repairedStatements,
      ...deckLevelStatements,
      ...buildAudienceFacingFallbackStatements(deck, slide),
    ]).slice(0, 3);
  const nextTitle =
    countMetaMatches(slide.title) >= 1 ||
    slide.title.length > 72 ||
    /^the main services, products, or focus areas connected to\b/i.test(slide.title) ||
    /^the main systems, parts, or focus areas that define\b/i.test(slide.title) ||
    /^a concrete example, consequence, or real-world application of\b/i.test(slide.title) ||
    /^application in\b/i.test(slide.title) ||
    /^what .* is and why it matters$/i.test(slide.title) ||
    /^services, products, and core focus areas$/i.test(slide.title)
      ? normalizedTitle
      : slide.title;
  const filteredCallouts = slide.visuals.callouts
    .filter((callout) => looksUsefulForMetaRepair(deck, slide, `${callout.label} ${callout.text}`))
    .slice(0, 2);
  const filteredExamples = uniqueStatements(
    slide.examples.filter((example) => looksUsefulForMetaRepair(deck, slide, example)),
  );
  const likelyQuestions = uniqueStatements([
    ...slide.likelyQuestions.filter((question) =>
      looksUsefulForMetaRepair(deck, slide, question),
    ),
    ...filteredCallouts
      .filter((callout) => /likely question/i.test(callout.label))
      .map((callout) => callout.text),
  ]).slice(0, 2);
  const visualsPrompt = buildAudienceFacingVisualPrompt(deck, slide, repairedKeyPoints);

  return {
    ...slide,
    title: nextTitle,
    learningGoal: buildAudienceFacingLearningGoal(deck, slide),
    keyPoints: repairedKeyPoints,
    beginnerExplanation: repairedKeyPoints.slice(0, 2).join(" "),
    advancedExplanation:
      repairedKeyPoints[2] ??
      `${slide.title} matters because it changes how ${deck.topic} works in practice.`,
    examples:
      filteredExamples.length > 0
        ? filteredExamples
        : slide.visuals.callouts
            .filter((callout) => /example/i.test(callout.label))
            .map((callout) => callout.text)
            .filter((example) => looksUsefulForMetaRepair(deck, slide, example))
            .slice(0, 1),
    likelyQuestions:
      likelyQuestions.length > 0
        ? likelyQuestions
        : [`What does ${nextTitle.toLowerCase()} reveal about ${deck.topic}?`],
    visualNotes: [
      `Use a concrete visual that reinforces ${nextTitle.toLowerCase()} in the context of ${deck.topic}.`,
    ],
    visuals: {
      ...slide.visuals,
      heroStatement: repairedKeyPoints[0],
      cards: repairedKeyPoints.slice(0, 3).map((point, index) => ({
        id: `${slide.id}-meta-repair-card-${index + 1}`,
        title: `Key point ${index + 1}`,
        body: point,
        tone:
          index === 0
            ? "accent"
            : index === 1
              ? "neutral"
              : "success",
      })),
      callouts: filteredCallouts,
      imagePrompt: visualsPrompt,
      imageSlots:
        slide.visuals.imageSlots.length > 0
          ? slide.visuals.imageSlots.map((slot, index) => ({
              ...slot,
              id: `${slide.id}-meta-repair-image-${index + 1}`,
              prompt: visualsPrompt,
              caption: slot.caption ?? `${slide.title} in the context of ${deck.topic}.`,
            }))
          : slide.visuals.imageSlots,
    },
  };
};

export const rebuildNarrationFromSlideAnchors = (
  deck: Deck,
  slide: Slide,
  existing: SlideNarration | undefined,
): SlideNarration => {
  const nextSlide = deck.slides[slide.order + 1];
  const isIntro = slide.order === 0;
  const supportStatements = buildNarrationSupportStatements(slide);
  const primaryStatement =
    supportStatements[0] ??
    ensureSentence(`A practical point here is that ${slide.beginnerExplanation.toLowerCase()}`);
  const secondaryStatement = supportStatements[1];
  const tertiaryStatement = supportStatements[2];
  const openingSegment = isIntro
    ? `Today I want to orient you to ${deck.topic} and show why it matters.`
    : slide.order === deck.slides.length - 1
      ? `To bring the story together, let us look at ${slide.title.toLowerCase()}.`
      : `The next piece of the story is ${slide.title.toLowerCase()}.`;
  const transitionSegment = nextSlide
    ? `From here, we can move into ${nextSlide.title.toLowerCase()}.`
    : "This brings the presentation to a clear close.";
  const draftSegments = [
    openingSegment,
    primaryStatement,
    ...(secondaryStatement ? [secondaryStatement] : []),
    ...(tertiaryStatement && isIntro ? [tertiaryStatement] : []),
    transitionSegment,
  ]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const minSegmentCount = isIntro ? 4 : 3;
  const segments: string[] = [];

  for (const candidate of draftSegments) {
    if (segments.some((segment) => tokenOverlapRatio(segment, candidate) >= 0.72)) {
      continue;
    }

    segments.push(candidate);
  }

  while (segments.length < minSegmentCount && !segments.includes(transitionSegment)) {
    segments.push(transitionSegment);
  }

  return {
    slideId: slide.id,
    narration: segments.join(" "),
    segments,
    summaryLine: existing?.summaryLine ?? slide.learningGoal,
    promptsForPauses:
      existing?.promptsForPauses.length
        ? existing.promptsForPauses
        : [
            "Pause me if you want this explained more simply.",
            "Ask for an example if you want something more concrete.",
          ],
    suggestedTransition:
      existing?.suggestedTransition ??
      (nextSlide
        ? `Bridge clearly into ${nextSlide.title}.`
        : "Finish with a concise recap of the final slide."),
  };
};

export const validateAndRepairDeck = (deck: Deck): ValidationResult<Deck> => {
  const issues: ValidationIssue[] = [];
  let repaired = false;

  let slides = deck.slides.map((slide, index) => {
    let nextSlide = slide;

    if (slide.order !== index) {
      repaired = true;
      issues.push({
        code: "slide_order_normalized",
        message: `Slide order for "${slide.title}" was normalized to match deck position.`,
        severity: "warning",
        slideId: slide.id,
      });
      nextSlide = {
        ...nextSlide,
        order: index,
      };
    }

    if (nextSlide.visuals.cards.length === 0 && nextSlide.keyPoints.length > 0) {
      repaired = true;
      issues.push({
        code: "missing_visual_cards_repaired",
        message: `Slide "${slide.title}" had no visual cards and was repaired from key points.`,
        severity: "warning",
        slideId: slide.id,
      });
      nextSlide = {
        ...nextSlide,
        visuals: {
          ...nextSlide.visuals,
          cards: nextSlide.keyPoints.slice(0, 3).map((point, keyPointIndex) => ({
            id: `${slide.id}-auto-card-${keyPointIndex + 1}`,
            title: `Key point ${keyPointIndex + 1}`,
            body: point,
            tone:
              keyPointIndex === 0
                ? "accent"
                : keyPointIndex === 1
                  ? "neutral"
                  : "success",
          })),
        },
      };
    }

    if (isMetaPresentationSlide(deck, nextSlide)) {
      repaired = true;
      issues.push({
        code: "meta_presentation_slide_repaired",
        message: `Slide "${nextSlide.title}" looked like slide-making advice instead of audience-facing subject content and was rewritten.`,
        severity: "warning",
        slideId: nextSlide.id,
      });
      nextSlide = repairMetaPresentationSlide(deck, nextSlide);
    }

    if (slideNeedsLanguageRepair(deck, nextSlide)) {
      repaired = true;
      issues.push({
        code: "slide_language_repaired",
        message: `Slide "${nextSlide.title}" had awkward or fragmentary audience language and was normalized.`,
        severity: "warning",
        slideId: nextSlide.id,
      });
      nextSlide = repairMetaPresentationSlide(deck, nextSlide);
    }

    return nextSlide;
  });

  if (deckLooksSystemicallyMeta(deck, slides)) {
    repaired = true;
    issues.push({
      code: "deck_wide_meta_presentation_repaired",
      message:
        "Most slides looked like presentation-making advice instead of audience-facing subject content, so the deck was repaired aggressively.",
      severity: "warning",
    });
    slides = slides.map((slide) => repairMetaPresentationSlide(deck, slide));
  }

  const introSlide = slides[0];
  if (introSlide && introSlide.keyPoints.length < 3) {
    issues.push({
      code: "intro_slide_thin",
      message: "The opening slide is thinner than expected and may feel weak.",
      severity: "warning",
      slideId: introSlide.id,
    });
  }

  return {
    value: {
      ...deck,
      slides,
      metadata: {
        ...deck.metadata,
        validation: {
          passed: !issues.some((issue) => issue.severity === "error"),
          repaired,
          validatedAt: new Date().toISOString(),
          issues,
        },
      },
    },
    issues,
    repaired,
  };
};

export const validateAndRepairNarrations = (
  deck: Deck,
  narrations: SlideNarration[],
  options?: {
    generateMissing?: boolean | undefined;
  },
): ValidationResult<SlideNarration[]> => {
  const issues: ValidationIssue[] = [];
  let repaired = false;
  const narrationBySlideId = new Map(
    narrations.map((narration) => [narration.slideId, narration]),
  );
  const generateMissing = options?.generateMissing ?? true;

  const validatedNarrations = deck.slides.map((slide) => {
    const existing = narrationBySlideId.get(slide.id);
    if (!existing && !generateMissing) {
      return null;
    }
    const minSegments = slide.order === 0 ? 4 : 3;
    const slideTokens = slideConceptTokens(slide);
    const narrationTokens = tokenize(
      [
        existing?.narration ?? "",
        ...(existing?.segments ?? []),
      ].join(" "),
    );
    const overlap = slideTokens.filter((token) => narrationTokens.includes(token));
    const visibleSlidePhrases = [
      slide.visuals.heroStatement ?? "",
      ...slide.keyPoints,
      ...slide.visuals.cards.map((card) => card.body),
      ...slide.visuals.callouts.map((callout) => callout.text),
    ]
      .map((value) => value.replace(/\s+/g, " ").trim().toLowerCase())
      .filter((value) => value.length >= 24);
    const normalizedNarration = (existing?.narration ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    const readsVisualTextTooClosely =
      /\b(first|second|third) key point\b/i.test(existing?.narration ?? "") ||
      /\bas shown here\b/i.test(existing?.narration ?? "") ||
      /\bon this slide\b/i.test(existing?.narration ?? "") ||
      visibleSlidePhrases.some((phrase) => normalizedNarration.includes(phrase));
    const needsRepair =
      !existing ||
      existing.segments.length < minSegments ||
      existing.narration.trim().length < (slide.order === 0 ? 180 : 110) ||
      overlap.length < Math.min(3, Math.max(1, Math.floor(slideTokens.length / 6))) ||
      readsVisualTextTooClosely;

    if (!needsRepair) {
      return existing;
    }

    repaired = true;
    issues.push({
      code: existing ? "narration_reanchored" : "narration_generated_fallback",
      message: existing
        ? `Narration for "${slide.title}" was repaired to align more tightly with the slide.`
        : `Narration for "${slide.title}" was generated from deterministic slide anchors.`,
      severity: "warning",
      slideId: slide.id,
    });

    return rebuildNarrationFromSlideAnchors(deck, slide, existing);
  }).filter((narration): narration is SlideNarration => Boolean(narration));

  return {
    value: validatedNarrations,
    issues,
    repaired,
  };
};
