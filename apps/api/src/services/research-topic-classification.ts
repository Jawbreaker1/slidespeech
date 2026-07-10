import { extractPresentationSubject } from "./presentation-intent";

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
  const subject = extractPresentationSubject(topic);
  const subjectLooksLikeNamedEntity =
    !!subject &&
    !/^(?:how|what|why|when|where|who|using|make|build|create|explain|teach)\b/i.test(subject) &&
    /^[A-Z][A-Za-z0-9&+-]*(?:\s+(?:[A-Z][A-Za-z0-9&+-]*|of|the|and|for|in|on|to|a|an)){0,7}$/.test(
      subject,
    );

  if (!normalized) {
    return false;
  }

  return [
    /\b(company|organization|organisation|firm|startup|vendor|employer|client)\b/i,
    /\b(brand|business|corporation|manufacturer)\b/i,
    /\babout us|about the company|company presentation|company overview\b/i,
    /\boverview of\b/i,
    /\bwho is\b.+\b(company|organization|organisation)\b/i,
    /\bwork at\b|\bour company\b|\bmy company\b/i,
  ].some((pattern) => pattern.test(normalized)) || subjectLooksLikeNamedEntity;
};

export const topicLooksResearchSpecific = (topic: string): boolean => {
  const normalized = topic.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return [
    /\b(incident|outbreak|plague|pandemic|contagion|epidemi\w*)\b/i,
    /\b(research(?:er|ers)?|stud(?:y|ied|ies))\b/i,
    /\b(disease spread|infection spread|case study|historical|history|origins?)\b/i,
    /\b(real[- ]world|scientific|academic)\b/i,
    /\b(?:released|aired|broadcast|premiered)\s+(?:in|on|during)\s+(?:1[5-9]\d{2}|20\d{2})\b/i,
  ].some((pattern) => pattern.test(normalized));
};

export const topicRequiresGroundedFacts = (topic: string): boolean =>
  topicLooksTimeSensitive(topic) ||
  topicLooksEntitySpecific(topic) ||
  topicLooksResearchSpecific(topic);
