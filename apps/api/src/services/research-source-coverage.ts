const tokenizeForGrounding = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const GROUNDING_COVERAGE_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "can",
  "connected",
  "details",
  "does",
  "explicitly",
  "for",
  "from",
  "how",
  "include",
  "into",
  "matter",
  "matters",
  "primary",
  "provided",
  "source",
  "sources",
  "the",
  "this",
  "use",
  "what",
  "where",
  "why",
  "with",
]);

const coverageSpecificTokens = (coverageGoal: string, subject: string): string[] => {
  const subjectTokens = new Set(tokenizeForGrounding(subject));

  return [
    ...new Set(
      tokenizeForGrounding(coverageGoal).filter(
        (token) =>
          !GROUNDING_COVERAGE_STOPWORDS.has(token) &&
          !subjectTokens.has(token),
      ),
    ),
  ];
};

const coverageGoalLooksSpecific = (coverageGoal: string, subject: string): boolean => {
  if (
    /\b(?:explicitly provided sources?|primary grounding|what .+ is and why it matters)\b/i.test(
      coverageGoal,
    )
  ) {
    return false;
  }

  return coverageSpecificTokens(coverageGoal, subject).length >= 2;
};

const findingSupportsCoverageGoal = (
  coverageGoal: string,
  subject: string,
  finding: { title: string; content: string },
): boolean => {
  const tokens = coverageSpecificTokens(coverageGoal, subject);
  if (tokens.length === 0) {
    return true;
  }

  const haystack = `${finding.title} ${finding.content}`.toLowerCase();
  const overlap = tokens.filter((token) => haystack.includes(token)).length;
  const requiredOverlap = tokens.length <= 2
    ? tokens.length
    : Math.min(3, Math.max(2, Math.ceil(tokens.length * 0.5)));

  return overlap >= requiredOverlap;
};

export const unsupportedSpecificCoverageGoals = (input: {
  subject: string;
  coverageGoals: string[];
  findings: Array<{ title: string; content: string }>;
}): string[] =>
  input.coverageGoals
    .filter((goal) => coverageGoalLooksSpecific(goal, input.subject))
    .filter(
      (goal) =>
        !input.findings.some((finding) =>
          findingSupportsCoverageGoal(goal, input.subject, finding),
        ),
    );

export const directSourceGroundingLooksSufficient = (input: {
  subject: string;
  coverageGoals: string[];
  findings: Array<{ title: string; url: string; content: string }>;
}): boolean => {
  if (unsupportedSpecificCoverageGoals(input).length > 0) {
    return false;
  }

  const anchors = [
    input.subject,
    ...input.coverageGoals,
  ]
    .flatMap((value) => tokenizeForGrounding(value))
    .filter((token) => token.length >= 3);

  if (anchors.length === 0) {
    return input.findings.length > 0;
  }

  return input.findings.some((finding) => {
    const haystack = `${finding.title} ${finding.content}`.toLowerCase();
    const overlap = anchors.filter((token) => haystack.includes(token)).length;
    return overlap >= 2;
  });
};
