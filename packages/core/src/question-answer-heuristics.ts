export const normalizeContextText = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

export const domainFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const tokenizeContext = (value: string): string[] =>
  normalizeContextText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const ENGLISH_RELEVANCE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "you",
  "are",
  "is",
  "was",
  "were",
  "been",
  "being",
  "has",
  "had",
  "not",
  "but",
  "into",
  "onto",
  "than",
  "then",
  "them",
  "they",
  "its",
  "our",
  "his",
  "her",
  "him",
  "she",
  "he",
  "also",
  "too",
  "very",
  "more",
  "most",
  "some",
  "any",
  "all",
  "one",
  "two",
  "three",
  "first",
  "second",
  "third",
  "there",
  "here",
  "them",
  "than",
  "from",
  "with",
  "without",
  "about",
  "between",
  "through",
  "across",
  "around",
  "while",
  "because",
  "could",
  "would",
  "should",
  "might",
  "must",
  "tomorrow",
  "today",
  "tonight",
  "yesterday",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "does",
  "did",
  "can",
  "this",
  "that",
  "these",
  "those",
  "their",
  "your",
  "under",
  "during",
  "over",
  "after",
  "before",
  "will",
]);

const WORD_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu;

export const tokenizeWords = (value: string): string[] =>
  Array.from(normalizeContextText(value).normalize("NFKC").matchAll(WORD_TOKEN_PATTERN))
    .map((match) => match[0]?.trim() ?? "")
    .filter(Boolean);

export const uniqueNonEmptyStrings = (
  values: Array<string | null | undefined>,
): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value ? normalizeContextText(value) : "";
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(normalized);
  }

  return unique;
};

export const countTokenOverlap = (left: string, right: string): number => {
  const leftTokens = [...new Set(tokenizeContext(left))];
  const rightTokens = new Set(tokenizeContext(right));
  return leftTokens.filter((token) => rightTokens.has(token)).length;
};

export const countRelevanceOverlap = (left: string, right: string): number => {
  const leftTokens = [
    ...new Set(
      tokenizeContext(left).filter((token) => !ENGLISH_RELEVANCE_STOPWORDS.has(token)),
    ),
  ];
  const rightTokens = new Set(
    tokenizeContext(right).filter((token) => !ENGLISH_RELEVANCE_STOPWORDS.has(token)),
  );
  return leftTokens.filter((token) => rightTokens.has(token)).length;
};

export const buildWordWindows = (
  content: string,
  windowSize = 36,
  stride = 18,
): string[] => {
  const words = normalizeContextText(content).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const windows = [words.slice(0, windowSize).join(" ")];
  for (let index = 0; index < words.length; index += stride) {
    const window = words.slice(index, index + windowSize).join(" ");
    if (window.trim()) {
      windows.push(window);
    }
  }

  return uniqueNonEmptyStrings(windows);
};

export const buildLeadingSourceExcerpts = (
  content: string,
  wordCounts = [32, 48, 64],
): string[] => {
  const words = normalizeContextText(content).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  return uniqueNonEmptyStrings(
    wordCounts
      .map((wordCount) => words.slice(0, wordCount).join(" ").trim())
      .filter(Boolean),
  );
};

export const ensureSentenceEnding = (value: string): string =>
  /[.!?]$/.test(value) ? value : `${value}.`;

export const normalizeExampleLeadIn = (value: string): string =>
  value.replace(/^(for example|example:|a concrete example is:?)/i, "").trim();

const normalizeSourceSnippetForAnswer = (value: string): string => {
  const normalized = normalizeContextText(value);
  if (!normalized) {
    return "";
  }

  const withoutPipes = normalized
    .split("|")
    .map((segment) => segment.trim())
    .find(Boolean);

  const candidate = withoutPipes ?? normalized;
  return candidate.replace(/^[^:]{1,120}:\s*/, "").trim();
};

const DATE_LIKE_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|\d{4})\b/i;
const SPECIFIC_DATE_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})\b/i;

const extractDateLikeSentence = (value: string): string | null => {
  const sentences = normalizeContextText(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  return (
    sentences.find((sentence) => DATE_LIKE_PATTERN.test(sentence)) ?? null
  );
};

const extractCreatorEntity = (value: string): string | null => {
  const normalized = normalizeContextText(value);
  const match = normalized.match(
    /^([A-Z][\p{L}\p{N}&.'’-]*(?:\s+[A-Z][\p{L}\p{N}&.'’-]*){0,3})\s+(?:today\s+)?(?:introduced|created|developed|built|made|invented|launched|released)\b/u,
  );

  return match?.[1]?.trim() ?? null;
};

const extractLocationListFromSnippet = (value: string): string | null => {
  const normalized = normalizeContextText(value);
  if (!normalized) {
    return null;
  }

  const markedMatch = normalized.match(
    /(?:offices include|locations include|countries include|located in|based in|about us)\s+([^.!?]+)/i,
  );
  const rawCandidate = markedMatch?.[1] ?? normalized;
  const cleaned = rawCandidate
    .replace(/\b(contact|search|postal address|visiting address)\b.*$/i, "")
    .trim()
    .replace(/^[:,-]\s*/, "")
    .trim();

  const titleishTokenCount = tokenizeWords(cleaned).filter((token) =>
    /^\p{Lu}/u.test(token),
  ).length;

  if (titleishTokenCount < 2) {
    return null;
  }

  return cleaned;
};

const questionRequestsLocationList = (question: string): boolean =>
  tokenizeContext(question).some((token) =>
    ["country", "countries", "office", "offices", "location", "locations"].includes(
      token,
    ),
  );

const questionRequestsDateLikeAnswer = (question: string): boolean =>
  tokenizeContext(question).some((token) =>
    ["when", "date", "launched", "released", "premiere", "premiered", "aired"].includes(
      token,
    ),
  );

const questionRequestsSpecificReleaseDate = (question: string): boolean =>
  tokenizeContext(question).some((token) =>
    ["premiere", "premiered", "aired", "launched", "released"].includes(token),
  );

const questionRequestsCreatorEntity = (question: string): boolean =>
  tokenizeContext(question).some((token) =>
    ["company", "created", "developed", "built", "made", "invented"].includes(
      token,
    ),
  );

export const isResponsiveGroundedAnswer = (
  value: string,
  question: string,
): boolean => {
  const normalized = normalizeContextText(value);
  if (!normalized) {
    return false;
  }

  if (
    /provided grounding context does not contain information|available source material|current slide or available source material/i.test(
      normalized,
    )
  ) {
    return false;
  }

  if (questionRequestsLocationList(question)) {
    return extractLocationListFromSnippet(normalized) !== null;
  }

  if (questionRequestsDateLikeAnswer(question)) {
    return questionRequestsSpecificReleaseDate(question)
      ? SPECIFIC_DATE_PATTERN.test(normalized)
      : DATE_LIKE_PATTERN.test(normalized);
  }

  if (questionRequestsCreatorEntity(question)) {
    return /^[A-Z][\p{L}\p{N}&.'’-]*(?:\s+[A-Z][\p{L}\p{N}&.'’-]*){0,4}$/u.test(
      normalized,
    );
  }

  return tokenizeWords(normalized).length >= 3;
};

export const formatGroundedSourceAnswer = (
  value: string,
  question: string,
): string => {
  const normalized = normalizeSourceSnippetForAnswer(value);
  if (!normalized) {
    return "";
  }

  if (questionRequestsLocationList(question)) {
    const locationList = extractLocationListFromSnippet(normalized);
    if (locationList) {
      return locationList;
    }
  }

  if (questionRequestsDateLikeAnswer(question)) {
    const datedSentence = extractDateLikeSentence(normalized);
    if (datedSentence) {
      return datedSentence;
    }
  }

  if (questionRequestsCreatorEntity(question)) {
    const creatorEntity = extractCreatorEntity(normalized);
    if (creatorEntity) {
      return creatorEntity;
    }
  }

  return normalized;
};

export const hasRepeatedWordWindow = (
  value: string,
  minWindowSize = 5,
): boolean => {
  const tokens = tokenizeWords(value)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 2);

  if (tokens.length < minWindowSize * 2) {
    return false;
  }

  const maxWindowSize = Math.min(10, Math.floor(tokens.length / 2));

  for (let windowSize = maxWindowSize; windowSize >= minWindowSize; windowSize -= 1) {
    for (let start = 0; start + windowSize * 2 <= tokens.length; start += 1) {
      let matches = true;
      for (let index = 0; index < windowSize; index += 1) {
        if (tokens[start + index] !== tokens[start + windowSize + index]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        return true;
      }
    }
  }

  return false;
};

export const looksLikeTaxonomyNoise = (value: string): boolean => {
  const tokens = tokenizeWords(value).filter((token) => /\p{L}/u.test(token));

  if (tokens.length < 8) {
    return false;
  }

  const isTitleishToken = (token: string): boolean => /^\p{Lu}/u.test(token);
  const titleishCount = tokens.filter(isTitleishToken).length;
  const lowercaseCount = tokens.filter((token) => /^\p{Ll}/u.test(token)).length;
  const titleRatio = titleishCount / tokens.length;

  let longestTitleishRun = 0;
  let currentRun = 0;
  for (const token of tokens) {
    if (isTitleishToken(token)) {
      currentRun += 1;
      if (currentRun > longestTitleishRun) {
        longestTitleishRun = currentRun;
      }
    } else {
      currentRun = 0;
    }
  }

  return (
    (hasRepeatedWordWindow(value) || longestTitleishRun >= 7 || titleRatio >= 0.7) &&
    lowercaseCount <= Math.max(3, Math.floor(tokens.length * 0.3))
  );
};

export const looksLikeInternalPresentationScaffold = (value: string): boolean =>
  /\bsee how\b.+\b(frames the concrete case within|makes .+ concrete|shows what .+ offers|works in practice|matters within|anchors the story of|fits within)\b/i.test(
    value,
  );

export const computeContextQualityPenalty = (value: string): number => {
  let penalty = 0;

  if (looksLikeInternalPresentationScaffold(value)) {
    penalty += 12;
  }

  if (looksLikeTaxonomyNoise(value)) {
    penalty += 8;
  }

  if (hasRepeatedWordWindow(value)) {
    penalty += 6;
  }

  return penalty;
};

export const PRESENTATION_REFERENTIAL_PATTERN =
  /\b(this|current)\s+(slide|presentation|deck)\b|\b(main point|summari[sz]e|repeat|example|what does this mean|why does this matter|can you explain|how would this help|how does this help|how would this apply|how does this apply|what problem does this solve)\b|\b(this|that|here)\b.*\b(solve|help|matter|matters|mean|means|important|processing)\b|\b(do not get|don't get|confused|unclear)\b|\bwhy\b.*\bhere\b/i;
export const FACTUAL_INFORMATION_PATTERN =
  /\b(who|where|when|which|how many|how much|countries?|offices?|headquarters?|hq|ceo|founder|founding|certifications?|locations?|based|located|customers?|industries?|revenue|company|created|developed|built|made|invented|launched|released|date|premiere|premiered|aired)\b/i;
export const FACTUAL_RESEARCH_CUE_TOKENS = new Set([
  "ceo",
  "founder",
  "founding",
  "headquarters",
  "hq",
  "office",
  "offices",
  "country",
  "countries",
  "location",
  "locations",
  "certification",
  "certifications",
  "customer",
  "customers",
  "industry",
  "industries",
  "revenue",
  "based",
  "located",
  "company",
  "created",
  "developed",
  "built",
  "made",
  "invented",
  "launched",
  "released",
  "date",
  "premiere",
  "premiered",
  "aired",
]);
