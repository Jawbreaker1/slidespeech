import {
  extractPresentationSubject,
  subjectIsGenericEntityReference,
} from "./research-policy";

const findingLooksUsableForGrounding = (content: string): boolean =>
  !content.startsWith("Failed to fetch source content:");

const normalizeGroundingFinding = <
  T extends { title: string; url: string; content: string },
>(finding: T): T => ({
  ...finding,
  content: finding.content
    .replace(/^Search result snippet:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim(),
});

const uniqueNonEmptyStrings = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];

const inferEntityNameFromTitle = (title: string): string | null => {
  const segments = title
    .split(/\s+[|•·\-–—]\s+|[|•·]| - | – | — /)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((segment) => segment.length >= 2 && segment.length <= 60)
    .filter(
      (segment) =>
        !/^(home|official site|welcome|careers|about|contact)$/i.test(segment),
    );

  return segments[0] ?? null;
};

const inferEntityNameFromUrl = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    const root = hostname.split(".")[0] ?? "";
    if (!root || root.length < 3) {
      return null;
    }

    return root
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (value) => value.toUpperCase());
  } catch {
    return null;
  }
};

export const normalizeEntityKey = (value: string): string =>
  value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

const editDistance = (left: string, right: string): number => {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const distances = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

  for (let row = 0; row < rows; row += 1) {
    distances[row]![0] = row;
  }
  for (let column = 0; column < columns; column += 1) {
    distances[0]![column] = column;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      distances[row]![column] = Math.min(
        distances[row - 1]![column]! + 1,
        distances[row]![column - 1]! + 1,
        distances[row - 1]![column - 1]! + substitutionCost,
      );
    }
  }

  return distances[left.length]![right.length]!;
};

const namesLookLikeTypoVariants = (left: string, right: string): boolean => {
  const leftKey = normalizeEntityKey(left);
  const rightKey = normalizeEntityKey(right);

  if (leftKey.length < 4 || rightKey.length < 4 || leftKey === rightKey) {
    return false;
  }

  const maxLength = Math.max(leftKey.length, rightKey.length);
  const allowedDistance = Math.max(2, Math.floor(maxLength * 0.28));
  return editDistance(leftKey, rightKey) <= allowedDistance;
};

const inferCorrectedEntityName = (input: {
  promptSubject: string;
  researchSubject: string;
  findings: Array<{ title: string; url: string; content: string }>;
}): string | null => {
  const candidates = uniqueNonEmptyStrings(
    input.findings.flatMap((finding) => [
      inferEntityNameFromTitle(finding.title),
      inferEntityNameFromUrl(finding.url),
    ]),
  )
    .filter((candidate) => !subjectIsGenericEntityReference(candidate))
    .filter((candidate) => candidate.length >= 4 && candidate.length <= 60);

  for (const candidate of candidates) {
    if (
      namesLookLikeTypoVariants(input.researchSubject, candidate) ||
      namesLookLikeTypoVariants(input.promptSubject, candidate)
    ) {
      return candidate;
    }
  }

  return null;
};

const subjectTokenCount = (value: string): number =>
  (
    value
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu) ?? []
  ).length;

const GENERIC_SUBJECT_DESCRIPTOR_TOKENS = new Set([
  "about",
  "and",
  "brand",
  "brands",
  "company",
  "entity",
  "for",
  "of",
  "organization",
  "presentation",
  "the",
]);

const PREFIX_CONNECTOR_TOKENS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

const STRUCTURAL_SUBJECT_DESCRIPTOR_TOKENS = new Set(
  [...GENERIC_SUBJECT_DESCRIPTOR_TOKENS].filter(
    (token) => !PREFIX_CONNECTOR_TOKENS.has(token),
  ),
);

const tokenLooksLikeEntityAnchor = (token: string): boolean =>
  /^[A-ZÅÄÖ][\p{L}\p{N}\p{M}-]*$/u.test(token) &&
  !PREFIX_CONNECTOR_TOKENS.has(token.toLocaleLowerCase());

const promptSubjectLooksLikeDescriptorAroundResearchSubject = (
  promptSubject: string,
  researchSubject: string,
): boolean => {
  const promptTokens =
    promptSubject.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu) ?? [];
  const researchTokens =
    researchSubject.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu) ?? [];

  if (promptTokens.length <= researchTokens.length || researchTokens.length === 0) {
    return false;
  }

  const suffix = promptTokens.slice(-researchTokens.length).join(" ");
  if (suffix !== researchTokens.join(" ")) {
    return false;
  }

  return promptTokens
    .slice(0, -researchTokens.length)
    .every((token) => !tokenLooksLikeEntityAnchor(token)) &&
    promptTokens
      .slice(0, -researchTokens.length)
      .some((token) => STRUCTURAL_SUBJECT_DESCRIPTOR_TOKENS.has(token));
};

export const resolvePresentationSubject = (input: {
  prompt: string;
  researchSubject: string;
  directFindings: Array<{ title: string; url: string; content: string }>;
  supplementalFindings: Array<{ title: string; url: string; content: string }>;
  searchFindings: Array<{ title: string; url: string; content: string }>;
}): string => {
  const promptSubject = extractPresentationSubject(input.prompt) || input.researchSubject;
  const fetchedFindings = [
    ...input.directFindings,
    ...input.supplementalFindings,
    ...input.searchFindings,
  ]
    .filter((finding) => findingLooksUsableForGrounding(finding.content))
    .map(normalizeGroundingFinding);

  if (!subjectIsGenericEntityReference(promptSubject)) {
    const correctedEntityName = inferCorrectedEntityName({
      promptSubject,
      researchSubject: input.researchSubject,
      findings: fetchedFindings,
    });
    if (correctedEntityName) {
      return correctedEntityName;
    }

    const normalizedPromptSubject = promptSubject.toLocaleLowerCase();
    const normalizedResearchSubject = input.researchSubject.toLocaleLowerCase();
    const researchSubjectTokenCount = subjectTokenCount(input.researchSubject);
    const promptSubjectTokenCount = subjectTokenCount(promptSubject);
    if (
      normalizedResearchSubject.length >= 3 &&
      normalizedResearchSubject !== normalizedPromptSubject &&
      normalizedPromptSubject.includes(normalizedResearchSubject) &&
      (
        researchSubjectTokenCount >= 2 ||
        promptSubjectTokenCount <= researchSubjectTokenCount + 2 ||
        promptSubjectLooksLikeDescriptorAroundResearchSubject(
          promptSubject,
          input.researchSubject,
        )
      )
    ) {
      return input.researchSubject;
    }

    return promptSubject;
  }

  for (const finding of fetchedFindings) {
    const fromTitle = inferEntityNameFromTitle(finding.title);
    if (fromTitle && !subjectIsGenericEntityReference(fromTitle)) {
      return fromTitle;
    }

    const fromUrl = inferEntityNameFromUrl(finding.url);
    if (fromUrl && !subjectIsGenericEntityReference(fromUrl)) {
      return fromUrl;
    }
  }

  return input.researchSubject || promptSubject;
};
