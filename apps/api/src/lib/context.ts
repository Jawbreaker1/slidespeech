import { resolve } from "node:path";

import {
  LLMConversationTurnEngine,
  PresentationSessionService,
} from "@slidespeech/core";
import {
  createLLMProvider,
  createWebResearchProvider,
  FileDeckRepository,
  FileSessionRepository,
  FileTranscriptRepository,
} from "@slidespeech/providers";

import { env } from "../config/env";

const storageRoot = resolve(process.cwd(), env.STORAGE_ROOT);

const llmProvider = createLLMProvider({
  llmProvider: env.LLM_PROVIDER,
  webResearchProvider: env.WEB_RESEARCH_PROVIDER,
  lmstudioBaseUrl: env.LMSTUDIO_BASE_URL,
  lmstudioModel: env.LMSTUDIO_MODEL,
  llmTimeoutMs: env.LLM_TIMEOUT_MS,
  fallbackToMockOnError: env.LLM_FALLBACK_TO_MOCK_ON_ERROR,
  webResearchTimeoutMs: env.WEB_RESEARCH_TIMEOUT_MS,
  ...(env.LMSTUDIO_API_KEY ? { lmstudioApiKey: env.LMSTUDIO_API_KEY } : {}),
});
const webResearchProvider = createWebResearchProvider({
  webResearchProvider: env.WEB_RESEARCH_PROVIDER,
  webResearchTimeoutMs: env.WEB_RESEARCH_TIMEOUT_MS,
});

const deckRepository = new FileDeckRepository({ rootDir: storageRoot });
const sessionRepository = new FileSessionRepository({ rootDir: storageRoot });
const transcriptRepository = new FileTranscriptRepository({
  rootDir: storageRoot,
});
const conversationTurnEngine = new LLMConversationTurnEngine(llmProvider);

export const appContext = {
  llmProvider,
  webResearchProvider,
  deckRepository,
  sessionRepository,
  transcriptRepository,
  sessionService: new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
    conversationTurnEngine,
  ),
};
