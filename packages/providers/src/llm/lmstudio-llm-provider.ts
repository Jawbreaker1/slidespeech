import type { OpenAICompatibleConfig } from "./openai-compatible";

import { OpenAICompatibleLLMProvider } from "./openai-compatible";

export interface LMStudioConfig {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  timeoutMs?: number | undefined;
}

export class LMStudioLLMProvider extends OpenAICompatibleLLMProvider {
  constructor(config: LMStudioConfig) {
    const baseConfig: OpenAICompatibleConfig = {
      providerName: "lmstudio",
      baseUrl: config.baseUrl,
      model: config.model,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
    };

    super(baseConfig);
  }
}
