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

export const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) =>
        typeof item === "string" ? parseStringifiedArray(item) ?? [item] : [],
      )
      .map((item) => decodeHtmlEntities(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
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

export const normalizeHexColor = (
  value: unknown,
  fallback = "1C7C7D",
): string => {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
};

export const normalizeLayoutTemplate = (value: unknown, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "hero-focus" ||
    normalized === "three-step-flow" ||
    normalized === "two-column-callouts" ||
    normalized === "summary-board"
  ) {
    return normalized;
  }

  return fallback;
};

export const normalizeVisualTone = (
  value: unknown,
): "accent" | "neutral" | "success" | "warning" | "info" => {
  if (typeof value !== "string") {
    return "neutral";
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "accent" ||
    normalized === "neutral" ||
    normalized === "success" ||
    normalized === "warning" ||
    normalized === "info"
  ) {
    return normalized;
  }

  return "neutral";
};
