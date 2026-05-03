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

const stripLeadingResearchInstructionClause = (value: string): string =>
  value
    .replace(
      /^(?:googla|google|search(?:\s+for)?|look\s+up)\b[^.?!]*?\band\s+(?=(?:create|make|build|generate|write|prepare|present)\b)/i,
      "",
    )
    .replace(
      /^(?:please\s+)?(?:googla|google|search(?:\s+for)?|look\s+up)\b[^.?!]*?(?=(?:create|make|build|generate|write|prepare|present)\b)/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

const GENERIC_COMPANY_REFERENCE_PATTERN =
  /\b(?:our|my|the)\s+(?:company|organisation|organization|business|employer|client)\b/i;

const COMPANY_FRAMING_HINT_PATTERN =
  /\b(?:company|organisation|organization|business|employer|client|about us|company overview|onboarding)\b/i;

export const subjectIsGenericEntityReference = (subject: string): boolean =>
  /^(?:our|my|the)\s+(?:company|organisation|organization|business|employer|client)$/i.test(
    subject.trim(),
  ) ||
  /^(?:company|organisation|organization|business|employer|client)$/i.test(subject.trim());

const tokenizeIntentText = (value: string): string[] =>
  (value.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu) ?? [])
    .map((token) => token.normalize("NFKC"))
    .filter((token) => token.length >= 2 || /\p{N}/u.test(token));

const overlapTokenCount = (left: string, right: string): number => {
  const leftTokens = [...new Set(tokenizeIntentText(left))];
  const rightTokens = new Set(tokenizeIntentText(right));
  return leftTokens.filter((token) => rightTokens.has(token)).length;
};

const deriveFocusAnchor = (input: {
  subject: string;
  coverageRequirements: string[];
  presentationFrame: PresentationIntent["presentationFrame"];
  contentMode: NonNullable<PresentationIntent["contentMode"]>;
  deliveryFormat: PresentationIntent["deliveryFormat"];
}): string | undefined => {
  if (
    input.presentationFrame !== "subject" ||
    input.contentMode !== "descriptive" ||
    input.deliveryFormat !== "presentation"
  ) {
    return undefined;
  }

  const subjectTokens = new Set(tokenizeIntentText(input.subject));

  for (const requirement of input.coverageRequirements) {
    const normalized = normalizePresentationSubject(requirement)
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.,;:!?]+$/g, "");
    const tokens = [...new Set(tokenizeIntentText(normalized))];
    const novelTokenCount = tokens.filter((token) => !subjectTokens.has(token)).length;

    if (tokens.length >= 3 && novelTokenCount >= 2) {
      return normalized;
    }
  }

  return undefined;
};

const extractLeadingResearchInstructionSubject = (topic: string): string | undefined => {
  const match = topic.match(
    /^(?:please\s+)?(?:googla|google|search(?:\s+for)?|look\s+up)\s+(?:information\s+about\s+|about\s+)?(.+?)\s+and\s+(?=(?:create|make|build|generate|write|prepare|present)\b)/i,
  );
  const candidate = match?.[1]
    ?.replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  if (!candidate || candidate.length < 2) {
    return undefined;
  }

  return normalizePresentationSubject(candidate);
};

const inferPresentationFrame = (input: {
  topic: string;
  brief: string;
  subject: string;
  explicitSourceUrls: string[];
  organization?: string;
}): PresentationIntent["presentationFrame"] => {
  const framingText = `${input.topic} ${input.brief}`.replace(/\s+/g, " ").trim();
  const mentionsOwnCompany = GENERIC_COMPANY_REFERENCE_PATTERN.test(framingText);
  const companyFramingHint = COMPANY_FRAMING_HINT_PATTERN.test(framingText);
  const organizationOverlap =
    input.organization && input.subject
      ? overlapTokenCount(input.organization, input.subject) >= 2
      : false;
  const sourceBackedCompanyFraming =
    input.explicitSourceUrls.length > 0 && companyFramingHint;

  if (mentionsOwnCompany || organizationOverlap) {
    return "organization";
  }

  if (sourceBackedCompanyFraming) {
    return input.organization ? "mixed" : "organization";
  }

  if (input.organization) {
    return "mixed";
  }

  return "subject";
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

const deriveHostnameEntityAnchor = (url: string): string | undefined => {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    const root = hostname.split(".")[0]?.trim() ?? "";
    if (root.length < 3) {
      return undefined;
    }

    const normalized = root
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return undefined;
    }

    return normalized.replace(/\b\p{L}/gu, (value) => value.toLocaleUpperCase());
  } catch {
    return undefined;
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

export const stripInstructionalSuffixes = (value: string): string =>
  value
    .replace(
      /^(?:googla|google|search(?:\s+for)?|look\s+up)\b[^.?!]*?\band\s+(?=(?:create|make|build|generate|write|prepare|present)\b)/i,
      "",
    )
    .replace(
      /^(?:please\s+)?(?:googla|google|search(?:\s+for)?|look\s+up)\b[^.?!]*?(?=(?:create|make|build|generate|write|prepare|present)\b)/i,
      "",
    )
    .replace(/\bmore information is available at\b.*$/i, " ")
    .replace(/\bmore info\b.*$/i, " ")
    .replace(/\bfor additional information\b.*$/i, " ")
    .replace(/\buse google\b.*$/i, " ")
    .replace(/\bgoogla\b.*$/i, " ")
    .replace(/\bgoogle for additional information\b.*$/i, " ")
    .replace(/\buse [^.?!]*\bfor additional information\b.*$/i, " ")
    .replace(/\bsee also\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

export const extractPresentationBrief = (topic: string): string => {
  const stripped = stripInstructionalSuffixes(stripExplicitSourceUrls(topic) || topic.trim());
  const normalizedSentences = splitIntoSentences(stripped)
    .map((sentence) =>
      stripLeadingResearchInstructionClause(sentence)
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
  const audiencePresentationSubjectMatch = firstSentence.match(
    /^(?:a\s+|an\s+)?(?:workshop\s+)?presentation\s+for\s+.+?\s+(in\s+using|using|about|on)\s+(.+)$/i,
  );
  const presentationExplainingSubjectMatch = firstSentence.match(
    /^(?:a\s+|an\s+)?(?:short\s+)?presentation\s+(?:explaining|describing|showing|teaching)\s+(.+?)(?:\s+\bfor\b.+)?$/i,
  );
  const overviewSubjectMatch = firstSentence.match(
    /^(?:\d+\s*-\s*slide\s+)?(?:onboarding\s+|introductory\s+)?(?:overview|introduction|intro)\s+of\s+(.+?)(?:\s+\bfor\b.+)?$/i,
  );
  const aboutMatch = cleaned.match(
    /\b(?:about|on|regarding)\s+(.+?)(?:$|[.,;:!?]|\s+\bfor\b|\s+\busing\b|\s+\bwith\b)/i,
  );
  const howMatch = cleaned.match(
    /\b(?:explain|describe|show|teach|understand|walk me through)\s+(.+?)(?:,\s+and\s+(?:it\s+must|the presentation should)\b|$)/i,
  );
  const candidate =
    audiencePresentationSubjectMatch?.[1] && audiencePresentationSubjectMatch[2]
      ? /using/i.test(audiencePresentationSubjectMatch[1])
        ? `Using ${audiencePresentationSubjectMatch[2]}`
        : audiencePresentationSubjectMatch[2]
      : presentationExplainingSubjectMatch?.[1]
        ? presentationExplainingSubjectMatch[1]
      : overviewSubjectMatch?.[1]
        ? overviewSubjectMatch[1]
      : aboutMatch?.[1] ?? howMatch?.[1] ?? firstSentence;

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
    " in using ",
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
  const leadingSegment = brief.slice(start).trimStart();
  if (!/^[\p{Lu}\p{N}]/u.test(leadingSegment)) {
    return undefined;
  }

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
  const leadingResearchInstructionSubject = extractLeadingResearchInstructionSubject(topic);
  const extractedSubject = extractPresentationSubject(topic) || brief || topic.trim();
  const coverageRequirements = extractCoverageRequirements(topic);
  const audienceCues = extractAudienceCues(brief);
  const explicitOrganization = extractOrganization(brief);
  const presentationFrame = inferPresentationFrame({
    topic,
    brief,
    subject: extractedSubject,
    explicitSourceUrls,
    ...(explicitOrganization ? { organization: explicitOrganization } : {}),
  });
  const organization =
    explicitOrganization ??
    (presentationFrame === "organization" &&
    leadingResearchInstructionSubject &&
    !subjectIsGenericEntityReference(leadingResearchInstructionSubject)
      ? leadingResearchInstructionSubject
      : undefined) ??
    (presentationFrame === "organization" &&
    extractedSubject.length >= 2 &&
    !subjectIsGenericEntityReference(extractedSubject)
      ? extractedSubject
      : explicitSourceUrls
          .map((url) => deriveHostnameEntityAnchor(url))
          .find(
            (candidate): candidate is string =>
              typeof candidate === "string" &&
              !subjectIsGenericEntityReference(candidate),
          ));
  const subject =
    presentationFrame === "organization" &&
    subjectIsGenericEntityReference(extractedSubject) &&
    organization
      ? organization
      : extractedSubject;
  const deliveryFormat = /\bworkshop\b/i.test(brief) ? "workshop" : "presentation";
  const activityRequirement = extractActivityRequirement(topic, coverageRequirements);
  const contentMode = inferContentMode(topic, brief, subject);
  const focusAnchor = deriveFocusAnchor({
    subject,
    coverageRequirements,
    presentationFrame,
    contentMode,
    deliveryFormat,
  });
  const presentationGoal = extractPresentationGoal({
    topic,
    brief,
    subject,
    audienceCues,
  });

  return {
    subject,
    ...(focusAnchor ? { focusAnchor } : {}),
    framing: brief,
    presentationFrame,
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
