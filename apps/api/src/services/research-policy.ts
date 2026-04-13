const EXPLICIT_URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"')\]]+)/gi;

const normalizeExplicitSourceUrl = (value: string): string | null => {
  const trimmed = value.trim().replace(/[.,;:!?]+$/g, "");

  if (!trimmed) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

export const extractExplicitSourceUrls = (topic: string): string[] => {
  const matches = topic.match(EXPLICIT_URL_PATTERN) ?? [];

  return [...new Set(matches.map((match) => normalizeExplicitSourceUrl(match)).filter(
    (value): value is string => Boolean(value),
  ))];
};

export const stripExplicitSourceUrls = (topic: string): string =>
  topic.replace(EXPLICIT_URL_PATTERN, " ").replace(/\s+/g, " ").trim();

export const topicLooksTimeSensitive = (topic: string): boolean => {
  const normalized = topic.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return [
    /\b(current|latest|recent|today|this week|this month|this year)\b/i,
    /\b(news|update|updates|trend|trends|market|markets|price|prices)\b/i,
    /\b202[4-9]\b/,
    /\bpresident|prime minister|ceo|earnings|release\b/i,
  ].some((pattern) => pattern.test(normalized));
};

export const topicLooksEntitySpecific = (topic: string): boolean => {
  const normalized = topic.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return [
    /\b(company|organization|organisation|firm|startup|vendor|employer|client)\b/i,
    /\b(brand|business|corporation|manufacturer|automaker|car maker|car company)\b/i,
    /\babout us|about the company|company presentation|company overview\b/i,
    /\b(create|make|build)\s+a?\s*(presentation|overview|deck)\s+about\b/i,
    /\bpresentation about\b/i,
    /\boverview of\b/i,
    /\bwho is\b.+\b(company|organization|organisation)\b/i,
    /\bwork at\b|\bour company\b|\bmy company\b/i,
  ].some((pattern) => pattern.test(normalized));
};

export const topicRequiresGroundedFacts = (topic: string): boolean =>
  topicLooksTimeSensitive(topic) || topicLooksEntitySpecific(topic);

export const shouldUseWebResearchForTopic = (input: {
  topic: string;
  requestedUseWebResearch?: boolean | undefined;
}): boolean => {
  if (input.requestedUseWebResearch === true) {
    return true;
  }

  if (input.requestedUseWebResearch === false) {
    return false;
  }

  return topicRequiresGroundedFacts(input.topic);
};
