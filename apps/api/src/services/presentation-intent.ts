import type { PresentationIntent } from "@slidespeech/types";

const EXPLICIT_URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"')\]]+)/gi;

const splitIntoSentences = (value: string): string[] =>
  value
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

const normalizeIntentSentence = (sentence: string): string => {
  const trimmed = sentence.replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/g, "");
  if (!trimmed) {
    return "";
  }

  if (/^(use|see also|more information|more info)\b/i.test(trimmed)) {
    return "";
  }

  return trimmed;
};

const capitalizeFirst = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

const joinReadableList = (values: string[]): string => {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
};

const PROCEDURAL_SUBJECT_PREFIX_TRANSFORMS: Array<[RegExp, string]> = [
  [/^make\s+/i, "making "],
  [/^prepare\s+/i, "preparing "],
  [/^cook\s+/i, "cooking "],
  [/^build\s+/i, "building "],
  [/^assemble\s+/i, "assembling "],
  [/^configure\s+/i, "configuring "],
  [/^set\s+up\s+/i, "setting up "],
  [/^setup\s+/i, "setting up "],
  [/^use\s+/i, "using "],
];

const normalizeProceduralSubject = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim();

  for (const [pattern, replacement] of PROCEDURAL_SUBJECT_PREFIX_TRANSFORMS) {
    if (pattern.test(normalized)) {
      return capitalizeFirst(normalized.replace(pattern, replacement));
    }
  }

  return capitalizeFirst(normalized);
};

const normalizePresentationSubject = (value: string): string => {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/g, "");
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  if (lower.startsWith("how they can ")) {
    const remainder = normalized.slice("how they can ".length).trim();
    if (remainder.toLowerCase().startsWith("use ")) {
      return capitalizeFirst(`using ${remainder.slice(4).trim()}`);
    }

    return capitalizeFirst(remainder);
  }

  if (lower.startsWith("how to ")) {
    const remainder = normalized.slice("how to ".length).trim();
    return normalizeProceduralSubject(remainder);
  }

  return capitalizeFirst(normalized);
};

const subjectToActionPhrase = (subject: string): string => {
  const normalized = subject.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  if (lower.startsWith("using ")) {
    return `use ${normalized.slice(6).trim()}`;
  }

  if (lower.startsWith("making ")) {
    return `make ${normalized.slice(7).trim()}`;
  }

  if (lower.startsWith("preparing ")) {
    return `prepare ${normalized.slice(10).trim()}`;
  }

  if (lower.startsWith("building ")) {
    return `build ${normalized.slice(9).trim()}`;
  }

  return `work with ${normalized}`;
};

const inferContentMode = (topic: string, brief: string, subject: string): "descriptive" | "procedural" => {
  const normalized = `${topic} ${brief} ${subject}`.toLowerCase();
  return /\b(how to|make|prepare|cook|build|assemble|set up|setup|configure)\b/.test(normalized)
    ? "procedural"
    : "descriptive";
};

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

  return [
    ...new Set(
      matches
        .map((match) => normalizeExplicitSourceUrl(match))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
};

export const stripExplicitSourceUrls = (topic: string): string =>
  topic.replace(EXPLICIT_URL_PATTERN, " ").replace(/\s+/g, " ").trim();

const stripInstructionalSuffixes = (value: string): string =>
  value
    .replace(/\bmore information is available at\b.*$/i, " ")
    .replace(/\bmore info\b.*$/i, " ")
    .replace(/\bfor additional information\b.*$/i, " ")
    .replace(/\buse google\b.*$/i, " ")
    .replace(/\buse [^.?!]*\bfor additional information\b.*$/i, " ")
    .replace(/\bsee also\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

export const extractPresentationBrief = (topic: string): string => {
  const stripped = stripInstructionalSuffixes(stripExplicitSourceUrls(topic) || topic.trim());
  const normalizedSentences = splitIntoSentences(stripped)
    .map((sentence) =>
      sentence
        .replace(/^(create|make|build|generate|write|prepare|present)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(a|an)\s+/i, "")
        .trim(),
    )
    .map((sentence) => normalizeIntentSentence(sentence))
    .filter(Boolean);

  return normalizedSentences.join(". ").replace(/[.,;:!?]+$/g, "");
};

export const extractPresentationSubject = (topic: string): string => {
  const cleaned = extractPresentationBrief(topic);
  const firstSentence = splitIntoSentences(cleaned)[0] ?? cleaned;
  const aboutMatch = cleaned.match(
    /\b(?:about|on|regarding)\s+(.+?)(?:$|[.,;:!?]|\s+\bfor\b|\s+\busing\b|\s+\bwith\b)/i,
  );
  const howMatch = cleaned.match(
    /\b(?:explain|describe|show|teach|understand|walk me through)\s+(.+?)(?:,\s+and\s+(?:it\s+must|the presentation should)\b|$)/i,
  );
  const candidate = aboutMatch?.[1] ?? howMatch?.[1] ?? firstSentence;

  return normalizePresentationSubject(
    candidate
    .replace(/^(?:the\s+)?(?:tool|company|organisation|organization|platform|product|service)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, ""),
  );
};

const splitCoverageRequirement = (value: string): string[] => {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/[.]+$/g, "");
  if (!normalized) {
    return [];
  }

  const explainWhyMatch = normalized.match(/^(.*?)\s+and\s+explain why\s+(.+)$/i);
  if (explainWhyMatch?.[1] && explainWhyMatch[2]) {
    const subject = explainWhyMatch[1].trim();
    const whyClause = explainWhyMatch[2].trim().replace(/\bit\b/gi, subject);
    return [...new Set([subject, `Why ${whyClause}`])];
  }

  const whyMatch = normalized.match(/^(.*?)\s+and why\s+(.+)$/i);
  if (whyMatch?.[1] && whyMatch[2]) {
    const subject = whyMatch[1].trim();
    const whyClause = whyMatch[2].trim().replace(/\bit\b/gi, subject);
    return [...new Set([subject, `Why ${whyClause}`])];
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

  return [...new Set(results)].slice(0, 4);
};

const extractAudienceCues = (brief: string): string[] => {
  const lower = brief.toLowerCase();
  const forIndex = lower.indexOf(" for ");
  if (forIndex === -1) {
    return [];
  }

  const start = forIndex + 5;
  const boundaries = [
    " that ",
    " which ",
    " who ",
    " about ",
    " on ",
    " using ",
    " with ",
    " at ",
    ".",
  ];
  const end = boundaries
    .map((needle) => lower.indexOf(needle, start))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? brief.length;

  const segment = brief.slice(start, end).trim().replace(/[.,;:!?]+$/g, "");
  if (!segment || segment.length < 3) {
    return [];
  }

  return segment
    .split(/,| and /i)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 3)
    .slice(0, 6);
};

const extractOrganization = (brief: string): string | undefined => {
  const lower = brief.toLowerCase();
  const atIndex = lower.indexOf(" at ");
  if (atIndex === -1) {
    return undefined;
  }

  const start = atIndex + 4;
  const boundaries = [" that ", " which ", " who ", " about ", " on ", " using ", " with ", "."];
  const end =
    boundaries
      .map((needle) => lower.indexOf(needle, start))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0] ?? brief.length;

  const segment = brief.slice(start, end).trim().replace(/[.,;:!?]+$/g, "");
  return segment.length >= 2 ? segment : undefined;
};

const extractPresentationGoal = (input: {
  topic: string;
  brief: string;
  subject: string;
  audienceCues: string[];
}): string | undefined => {
  const candidateSentences = splitIntoSentences(stripExplicitSourceUrls(input.topic) || input.topic)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const sentence of candidateSentences) {
    const normalized = sentence
      .replace(/^the presentation should\s+/i, "")
      .replace(/^it should\s+/i, "")
      .replace(/^it must\s+/i, "")
      .replace(/^this presentation should\s+/i, "")
      .replace(/\s+and\s+it\s+must\b.*$/i, "")
      .replace(/,\s*and\s+it\s+must\b.*$/i, "")
      .replace(/[.,;:!?]+$/g, "")
      .trim();

    if (!normalized) {
      continue;
    }

    const goalClause = normalized
      .replace(/^(?:explain|show|teach|describe|cover|focus on|walk(?: me)? through)\s+/i, "")
      .trim();

    if (!goalClause || goalClause.length < 8) {
      continue;
    }

    if (/^(?:include|at least one|one practical exercise)\b/i.test(goalClause)) {
      continue;
    }

    if (/^how they can\b/i.test(goalClause) && input.audienceCues.length > 0) {
      return capitalizeFirst(
        goalClause.replace(/^how they can\b/i, `How ${joinReadableList(input.audienceCues)} can`),
      );
    }

    if (/^(?:how|what|why)\b/i.test(goalClause)) {
      return capitalizeFirst(goalClause);
    }
  }

  if (input.audienceCues.length > 0) {
    return `How ${joinReadableList(input.audienceCues)} can ${subjectToActionPhrase(input.subject)}`;
  }

  return undefined;
};

const extractActivityRequirement = (
  topic: string,
  coverageRequirements: string[],
): string | undefined => {
  const lower = topic.toLowerCase();
  const matchedCoverage = coverageRequirements.find((requirement) =>
    /\b(exercise|assignment|task|activity)\b/i.test(requirement),
  );
  if (matchedCoverage) {
    return matchedCoverage;
  }

  const sentence = splitIntoSentences(topic).find((value) =>
    /\b(exercise|assignment|task|activity)\b/i.test(value),
  );

  if (!sentence) {
    return undefined;
  }

  const normalized = sentence
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "")
    .replace(/^the presentation should /i, "")
    .replace(/^it /i, "")
    .trim();

  const mustIncludeIndex = normalized.toLowerCase().indexOf("must include ");
  if (mustIncludeIndex >= 0) {
    return normalized.slice(mustIncludeIndex + "must include ".length).trim();
  }

  return normalized;
};

export const derivePresentationIntent = (topic: string): PresentationIntent => {
  const explicitSourceUrls = extractExplicitSourceUrls(topic);
  const brief = extractPresentationBrief(topic);
  const subject = extractPresentationSubject(topic) || brief || topic.trim();
  const coverageRequirements = extractCoverageRequirements(topic);
  const audienceCues = extractAudienceCues(brief);
  const organization = extractOrganization(brief);
  const deliveryFormat = /\bworkshop\b/i.test(brief) ? "workshop" : "presentation";
  const activityRequirement = extractActivityRequirement(topic, coverageRequirements);
  const contentMode = inferContentMode(topic, brief, subject);
  const presentationGoal = extractPresentationGoal({
    topic,
    brief,
    subject,
    audienceCues,
  });

  return {
    subject,
    framing: brief,
    contentMode,
    explicitSourceUrls,
    coverageRequirements,
    audienceCues,
    ...(organization ? { organization } : {}),
    ...(presentationGoal ? { presentationGoal } : {}),
    deliveryFormat,
    ...(activityRequirement ? { activityRequirement } : {}),
  };
};
