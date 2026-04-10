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

