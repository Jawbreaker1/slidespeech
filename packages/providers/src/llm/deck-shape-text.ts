import { decodeHtmlEntities } from "../shared";

export const normalizeComparableText = (value: string): string =>
  decodeHtmlEntities(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const uniqueNonEmptyStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
    const key = normalized.toLowerCase();

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const PROMOTIONAL_SOURCE_PATTERNS = [
  /\bsubscribe now\b/i,
  /\blearn more\b/i,
  /\b6-month subscription offer\b/i,
  /\bblaze through\b/i,
  /\bfree trial\b/i,
  /\bupgrade now\b/i,
  /\bby purchasing\b/i,
  /\bstarter edition\b/i,
  /\bcharity\b/i,
  /\bdonation\b/i,
  /\bbundle\b/i,
];

export const looksOverlyPromotionalSourceCopy = (value: string): boolean =>
  PROMOTIONAL_SOURCE_PATTERNS.some((pattern) => pattern.test(value));

const WORD_LIKE_TOKEN_PATTERN = /[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu;

export const tokenizeSemanticText = (value: string): string[] =>
  (value.toLocaleLowerCase().match(WORD_LIKE_TOKEN_PATTERN) ?? [])
    .map((token) => token.normalize("NFKC").replace(/^-+|-+$/g, ""))
    .flatMap((token) =>
      token.includes("-")
        ? [
            token,
            ...token
              .split("-")
              .map((part) => part.trim())
              .filter(Boolean),
          ]
        : [token],
    )
    .filter((token) => token.length >= 2 || /\p{N}/u.test(token));

export const tokenizeDeckShapeText = (value: string): string[] =>
  tokenizeSemanticText(value);

export const semanticTextSimilarity = (left: string, right: string): number => {
  const leftTokens = [...new Set(tokenizeDeckShapeText(left))];
  const rightTokens = new Set(tokenizeDeckShapeText(right));

  if (leftTokens.length === 0 || rightTokens.size === 0) {
    return 0;
  }

  const overlap = leftTokens.filter((token) => rightTokens.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.size);
};
