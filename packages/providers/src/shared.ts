import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ProviderHealthStatus } from "@slidespeech/types";

export const nowIso = (): string => new Date().toISOString();

export const createId = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

export const healthy = (
  provider: string,
  detail: string,
): ProviderHealthStatus => ({
  provider,
  ok: true,
  detail,
  checkedAt: nowIso(),
});

export const unhealthy = (
  provider: string,
  detail: string,
): ProviderHealthStatus => ({
  provider,
  ok: false,
  detail,
  checkedAt: nowIso(),
});

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

const decodeHtmlEntitiesOnce = (value: string): string =>
  value
    .replace(/&([a-z][a-z0-9]+);/gi, (match, entity: string) => {
      return HTML_ENTITY_MAP[entity.toLowerCase()] ?? match;
    })
    .replace(/&#x([0-9a-f]+);?/gi, (match, codePoint: string) => {
      const parsed = Number.parseInt(codePoint, 16);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 0x10ffff) {
        return match;
      }
      return String.fromCodePoint(parsed);
    })
    .replace(/&#([0-9]+);?/g, (match, codePoint: string) => {
      const parsed = Number.parseInt(codePoint, 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 0x10ffff) {
        return match;
      }
      return String.fromCodePoint(parsed);
    });

export const decodeHtmlEntities = (value: string): string => {
  let current = value;

  for (let index = 0; index < 3; index += 1) {
    const next = decodeHtmlEntitiesOnce(current);
    if (next === current) {
      return next;
    }
    current = next;
  }

  return current;
};

export const ensureDirForFile = async (filePath: string): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
};

export const writeJsonFile = async (
  filePath: string,
  value: unknown,
): Promise<void> => {
  await ensureDirForFile(filePath);
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
};

export const readJsonFile = async <T>(filePath: string): Promise<T | null> => {
  try {
    const contents = await readFile(filePath, "utf8");
    return JSON.parse(contents) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
};

export const extractJsonFromText = (text: string): string => {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```json\s*([\s\S]+?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");

  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  throw new Error("No JSON object found in provider response.");
};

export const splitTextIntoSegments = (text: string): string[] => {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const sentenceLikeSegments = normalized
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (sentenceLikeSegments.length > 1) {
    return sentenceLikeSegments;
  }

  const clauseSegments = normalized
    .split(/,\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return clauseSegments.length > 1 ? clauseSegments : [normalized];
};
