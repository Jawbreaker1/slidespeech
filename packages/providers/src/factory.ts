import type { LLMProvider, WebResearchProvider } from "@slidespeech/types";

import { LMStudioLLMProvider } from "./llm/lmstudio-llm-provider";
import { MockLLMProvider } from "./llm/mock-llm-provider";
import { ResilientLLMProvider } from "./llm/resilient-llm-provider";
import { HostedWebResearchProvider } from "./web-research/hosted-web-research-provider";
import { MockWebResearchProvider } from "./web-research/mock-web-research-provider";

export interface ProviderFactoryConfig {
  llmProvider: "mock" | "lmstudio" | "openai-compatible" | "hosted";
  webResearchProvider: "mock" | "hosted";
  lmstudioBaseUrl: string;
  lmstudioModel: string;
  lmstudioApiKey?: string | undefined;
  llmTimeoutMs: number;
  fallbackToMockOnError: boolean;
  webResearchTimeoutMs: number;
}

export const createLLMProvider = (config: ProviderFactoryConfig): LLMProvider => {
  const sharedConfig = {
    baseUrl: config.lmstudioBaseUrl,
    model: config.lmstudioModel,
    timeoutMs: config.llmTimeoutMs,
    ...(config.lmstudioApiKey ? { apiKey: config.lmstudioApiKey } : {}),
  };

  const mockProvider = new MockLLMProvider();
  let primaryProvider: LLMProvider;

  switch (config.llmProvider) {
    case "lmstudio":
      primaryProvider = new LMStudioLLMProvider(sharedConfig);
      break;
    case "openai-compatible":
    case "hosted":
      primaryProvider = new LMStudioLLMProvider(sharedConfig);
      break;
    case "mock":
    default:
      return mockProvider;
  }

  return config.fallbackToMockOnError
    ? new ResilientLLMProvider(primaryProvider, mockProvider)
    : primaryProvider;
};

export const createWebResearchProvider = (
  config: Pick<ProviderFactoryConfig, "webResearchProvider" | "webResearchTimeoutMs">,
): WebResearchProvider => {
  switch (config.webResearchProvider) {
    case "hosted":
      return new HostedWebResearchProvider({
        timeoutMs: config.webResearchTimeoutMs,
      });
    case "mock":
    default:
      return new MockWebResearchProvider();
  }
};
