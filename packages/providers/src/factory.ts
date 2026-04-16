import type {
  LLMProvider,
  SlideIllustrationProvider,
  SpeechToTextProvider,
  TextToSpeechProvider,
  VoiceActivityProvider,
  WebResearchProvider,
} from "@slidespeech/types";

import { HostedIllustrationProvider } from "./illustration/hosted-illustration-provider";
import { MockIllustrationProvider } from "./illustration/mock-illustration-provider";
import { LMStudioLLMProvider } from "./llm/lmstudio-llm-provider";
import { MockLLMProvider } from "./llm/mock-llm-provider";
import { ResilientLLMProvider } from "./llm/resilient-llm-provider";
import {
  FASTER_WHISPER_STT_DEFAULTS,
  FasterWhisperSTTProvider,
} from "./stt/faster-whisper-stt-provider";
import { MockSTTProvider } from "./stt/mock-stt-provider";
import { MockTTSProvider } from "./tts/mock-tts-provider";
import {
  SYSTEM_TTS_DEFAULTS,
  SystemTTSProvider,
} from "./tts/system-tts-provider";
import { MockVADProvider } from "./vad/mock-vad-provider";
import { HostedWebResearchProvider } from "./web-research/hosted-web-research-provider";
import { MockWebResearchProvider } from "./web-research/mock-web-research-provider";

export interface ProviderFactoryConfig {
  llmProvider: "mock" | "lmstudio" | "openai-compatible" | "hosted";
  illustrationProvider: "mock" | "hosted";
  sttProvider: "mock" | "faster-whisper" | "hosted";
  ttsProvider: "mock" | "piper" | "system" | "hosted";
  vadProvider: "mock" | "silero";
  webResearchProvider: "mock" | "hosted";
  fasterWhisperPythonBin: string;
  fasterWhisperModel: string;
  fasterWhisperComputeType: string;
  fasterWhisperBeamSize: number;
  fasterWhisperLanguage: string;
  systemTtsVoice: string;
  systemTtsRateWpm: number;
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

export const createIllustrationProvider = (
  config: Pick<
    ProviderFactoryConfig,
    "illustrationProvider" | "webResearchTimeoutMs"
  > & { webResearchProvider: WebResearchProvider },
): SlideIllustrationProvider => {
  switch (config.illustrationProvider) {
    case "hosted":
      return new HostedIllustrationProvider({
        webResearchProvider: config.webResearchProvider,
        timeoutMs: config.webResearchTimeoutMs,
      });
    case "mock":
    default:
      return new MockIllustrationProvider();
  }
};

export const createSpeechToTextProvider = (
  config: Pick<
    ProviderFactoryConfig,
    | "sttProvider"
    | "fasterWhisperPythonBin"
    | "fasterWhisperModel"
    | "fasterWhisperComputeType"
    | "fasterWhisperBeamSize"
    | "fasterWhisperLanguage"
  >,
): SpeechToTextProvider => {
  switch (config.sttProvider) {
    case "faster-whisper":
      return new FasterWhisperSTTProvider({
        pythonBin:
          config.fasterWhisperPythonBin ||
          FASTER_WHISPER_STT_DEFAULTS.pythonBin,
        model:
          config.fasterWhisperModel || FASTER_WHISPER_STT_DEFAULTS.model,
        computeType:
          config.fasterWhisperComputeType ||
          FASTER_WHISPER_STT_DEFAULTS.computeType,
        beamSize:
          config.fasterWhisperBeamSize ||
          FASTER_WHISPER_STT_DEFAULTS.beamSize,
        language:
          config.fasterWhisperLanguage ||
          FASTER_WHISPER_STT_DEFAULTS.language,
      });
    case "hosted":
    case "mock":
    default:
      return new MockSTTProvider();
  }
};

export const createTextToSpeechProvider = (
  config: Pick<
    ProviderFactoryConfig,
    "ttsProvider" | "systemTtsVoice" | "systemTtsRateWpm"
  >,
): TextToSpeechProvider => {
  switch (config.ttsProvider) {
    case "system":
      return new SystemTTSProvider({
        voice: config.systemTtsVoice || SYSTEM_TTS_DEFAULTS.voice,
        defaultRateWpm:
          config.systemTtsRateWpm || SYSTEM_TTS_DEFAULTS.defaultRateWpm,
      });
    case "piper":
    case "hosted":
    case "mock":
    default:
      return new MockTTSProvider();
  }
};

export const createVoiceActivityProvider = (
  config: Pick<ProviderFactoryConfig, "vadProvider">,
): VoiceActivityProvider => {
  switch (config.vadProvider) {
    case "silero":
    case "mock":
    default:
      return new MockVADProvider();
  }
};
