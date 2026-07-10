import type {
  PlanResearchInput,
  ResearchPlanningSuggestion,
} from "@slidespeech/types";

const stripPlanningBulletPrefix = (value: string): string =>
  value.replace(/^[\-\u2022*]+\s*/, "").replace(/^\d+[.)]\s*/, "").trim();

const normalizeResearchPlanningSubject = (value: string): string | undefined => {
  const normalized = stripPlanningBulletPrefix(value)
    .replace(/^(?:subject|topic)\s*[:\-]\s*/i, "")
    .replace(
      /^(?:create|make|build|generate|write|prepare)\s+(?:a|an|the)?\s*(?:[\p{L}\p{M}-]+\s+){0,3}(?:presentation|deck|overview)\s+(?:about|on)\s+/iu,
      "",
    )
    .replace(
      /\b(?:company profile(?: and service portfolio)?|service portfolio|company overview|corporate|profile|overview|presentation|deck|talk)\b.*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  return normalized.length >= 2 ? normalized : undefined;
};

const normalizeResearchPlanningQuery = (value: string): string | null => {
  const normalized = stripPlanningBulletPrefix(value)
    .replace(/^(?:query|search|search query)\s*[:\-]\s*/i, "")
    .replace(/^search\s+for\s+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  if (normalized.length < 3 || normalized.length > 120) {
    return null;
  }

  return normalized;
};

const RESEARCH_GOAL_META_PATTERN =
  /\b(?:slide|slides|presentation|deck|speaker|narration|template|layout|design)\b/i;

const normalizeResearchCoverageGoal = (value: string): string | null => {
  const normalized = stripPlanningBulletPrefix(value)
    .replace(/^(?:goal|coverage|coverage goal)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");

  if (
    normalized.length < 8 ||
    normalized.length > 160 ||
    RESEARCH_GOAL_META_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
};

const toPlanningStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value
      .split(/\r?\n/)
      .map((line) => stripPlanningBulletPrefix(line).trim())
      .filter((line) => line.length > 0);
  }

  return [];
};

export const normalizeResearchPlanningSuggestion = (
  value: unknown,
  input: PlanResearchInput,
): ResearchPlanningSuggestion => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return parseResearchPlanningText(String(value ?? ""), input);
  }

  const record = value as Record<string, unknown>;
  const subject =
    (typeof record.subject === "string"
      ? normalizeResearchPlanningSubject(record.subject)
      : undefined) ?? input.heuristicSubject;
  const searchQueries = [
    ...input.heuristicQueries,
    ...toPlanningStringArray(record.searchQueries)
      .map((item) => normalizeResearchPlanningQuery(item))
      .filter((item): item is string => Boolean(item)),
  ]
    .filter((item, index, values) => values.indexOf(item) === index)
    .slice(0, 5);
  const coverageGoals = toPlanningStringArray(record.coverageGoals)
    .map((item) => normalizeResearchCoverageGoal(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
  const rationale = toPlanningStringArray(record.rationale)
    .map((item) => stripPlanningBulletPrefix(item).replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 8)
    .slice(0, 4);

  return {
    subject,
    searchQueries,
    coverageGoals,
    rationale,
  };
};

export const parseResearchPlanningText = (
  text: string,
  input: PlanResearchInput,
): ResearchPlanningSuggestion => {
  const sections: Record<"subject" | "queries" | "coverage" | "rationale", string[]> = {
    subject: [],
    queries: [],
    coverage: [],
    rationale: [],
  };
  let currentSection: keyof typeof sections | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const headerMatch = line.match(
      /^(SUBJECT|SEARCH QUERIES|COVERAGE GOALS|RATIONALE)\s*:\s*(.*)$/i,
    );
    if (headerMatch) {
      const header = headerMatch[1]!.toLowerCase();
      currentSection =
        header === "subject"
          ? "subject"
          : header === "search queries"
            ? "queries"
            : header === "coverage goals"
              ? "coverage"
              : "rationale";
      const inlineValue = headerMatch[2]?.trim();
      if (inlineValue) {
        sections[currentSection].push(inlineValue);
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  const subject =
    sections.subject
      .map((value) => normalizeResearchPlanningSubject(value))
      .find((value): value is string => Boolean(value)) ??
    input.heuristicSubject;

  const searchQueries = [
    ...input.heuristicQueries,
    ...sections.queries
      .map((value) => normalizeResearchPlanningQuery(value))
      .filter((value): value is string => Boolean(value)),
  ]
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 5);

  const coverageGoals = sections.coverage
    .map((value) => normalizeResearchCoverageGoal(value))
    .filter((value): value is string => Boolean(value))
    .slice(0, 4);

  const rationale = sections.rationale
    .map((value) => stripPlanningBulletPrefix(value).replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 8)
    .slice(0, 4);

  return {
    subject,
    searchQueries,
    coverageGoals,
    rationale,
  };
};
