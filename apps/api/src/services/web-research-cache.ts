import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type WebResearchQueryResponse,
  WebResearchQueryResponseSchema,
} from "@slidespeech/types";

import { envRoot } from "../config/env";

export type ResearchCacheKeyInput =
  | {
      kind: "search";
      query: string;
      maxResults: number;
      allowedHostnames?: string[];
    }
  | {
      kind: "explicit";
      query: string;
      urls: string[];
    };

const RESEARCH_CACHE_DIR = resolve(envRoot, "data/research-cache");
const RESEARCH_CACHE_VERSION = 31;

const cacheKeyFor = (input: ResearchCacheKeyInput): string => {
  const hash = createHash("sha1");
  hash.update(JSON.stringify({ version: RESEARCH_CACHE_VERSION, ...input }));
  return hash.digest("hex");
};

export const readResearchCache = async (
  input: ResearchCacheKeyInput & { ttlMs: number },
) => {
  try {
    const { ttlMs: _ttlMs, ...cacheKeyInput } = input;
    const cachePath = resolve(RESEARCH_CACHE_DIR, `${cacheKeyFor(cacheKeyInput)}.json`);
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as {
      createdAt?: string;
      response?: unknown;
    };

    if (!parsed.createdAt || !parsed.response) {
      return null;
    }

    const ageMs = Date.now() - new Date(parsed.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > input.ttlMs) {
      return null;
    }

    return WebResearchQueryResponseSchema.parse(parsed.response);
  } catch {
    return null;
  }
};

export const writeResearchCache = async (
  input: ResearchCacheKeyInput & { response: WebResearchQueryResponse },
) => {
  try {
    await mkdir(RESEARCH_CACHE_DIR, { recursive: true });
    const { response, ...cacheKeyInput } = input;
    const cachePath = resolve(RESEARCH_CACHE_DIR, `${cacheKeyFor(cacheKeyInput)}.json`);
    await writeFile(
      cachePath,
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          response,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // Best-effort cache only.
  }
};
