import { decodeHtmlEntities } from "../shared";

export const parseStringifiedArray = (value: string): string[] | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[")) {
    return null;
  }
  const jsonCandidate = trimmed.endsWith("]") ? trimmed : `${trimmed}]`;

  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    const items = parsed
      .flatMap((item) => {
        if (typeof item !== "string") {
          return [];
        }

        return parseStringifiedArray(item) ?? [item];
      })
      .map((item) => decodeHtmlEntities(item).trim())
      .filter(Boolean);

    return items.length > 0 ? items : null;
  } catch {
    const looseItems = Array.from(
      trimmed.matchAll(/"((?:\\.|[^"\\])*)"/g),
    )
      .map((match) => {
        const raw = match[1] ?? "";
        try {
          return JSON.parse(`"${raw}"`) as unknown;
        } catch {
          return raw.replace(/\\"/g, '"').replace(/\\n/g, " ");
        }
      })
      .filter((item): item is string => typeof item === "string")
      .map((item) => decodeHtmlEntities(item).replace(/\s+/g, " ").trim())
      .filter(Boolean);

    return looseItems.length > 0 ? looseItems : null;
  }
};

export const parseTaggedStringArray = (value: string): string[] | null => {
  const trimmed = decodeHtmlEntities(value).trim();
  if (!/<item\b/i.test(trimmed)) {
    return null;
  }

  const closedItems = Array.from(
    trimmed.matchAll(/<item\b[^>]*>\s*([\s\S]*?)\s*<\/item>/gi),
  )
    .map((match) => (match[1] ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (closedItems.length > 0) {
    return closedItems;
  }

  const looseItems = trimmed
    .split(/<item\b[^>]*>/i)
    .map((item) =>
      item
        .replace(/<\/item>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

  return looseItems.length > 0 ? looseItems : [];
};

export const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) =>
        typeof item === "string"
          ? parseTaggedStringArray(item) ?? parseStringifiedArray(item) ?? [item]
          : [],
      )
      .map((item) => decodeHtmlEntities(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const taggedArray = parseTaggedStringArray(value);
    if (taggedArray) {
      return taggedArray;
    }

    const parsedArray = parseStringifiedArray(value);
    if (parsedArray) {
      return parsedArray;
    }

    return value
      .replace(/\r\n/g, "\n")
      .replace(/(?:^|\n)\s*[-*]\s+/g, "\n")
      .split(/\n|•|;|\d+[.)]\s/g)
      .map((item) => decodeHtmlEntities(item).trim())
      .filter(Boolean);
  }

  return [];
};

export const toRecordArray = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object",
  );
};
