import type {
  LLMProvider,
  SlideIllustrationProvider,
  SpeechToTextProvider,
  TextToSpeechProvider,
  VisionProvider,
  VoiceActivityProvider,
  WebResearchProvider,
} from "@slidespeech/types";

import { HostedIllustrationProvider } from "./illustration/hosted-illustration-provider";
import { MockIllustrationProvider } from "./illustration/mock-illustration-provider";
import { LMStudioLLMProvider } from "./llm/lmstudio-llm-provider";
import { MockLLMProvider } from "./llm/mock-llm-provider";
import { OpenAICompatibleLLMProvider } from "./llm/openai-compatible";
import { ResilientLLMProvider } from "./llm/resilient-llm-provider";
import {
  FASTER_WHISPER_STT_DEFAULTS,
  FasterWhisperSTTProvider,
} from "./stt/faster-whisper-stt-provider";
import { MockSTTProvider } from "./stt/mock-stt-provider";
import { MockTTSProvider } from "./tts/mock-tts-provider";
import {
  PIPER_TTS_DEFAULTS,
  PiperTTSProvider,
} from "./tts/piper-tts-provider";
import { MockVADProvider } from "./vad/mock-vad-provider";
import { LMStudioVisionProvider } from "./vision/lmstudio-vision-provider";
import { MockVisionProvider } from "./vision/mock-vision-provider";
import { HostedWebResearchProvider } from "./web-research/hosted-web-research-provider";
import { MockWebResearchProvider } from "./web-research/mock-web-research-provider";

export interface ProviderFactoryConfig {
  llmProvider: "mock" | "lmstudio" | "openai-compatible";
  illustrationProvider: "mock" | "hosted";
  visionProvider: "mock" | "lmstudio";
  sttProvider: "mock" | "faster-whisper";
  ttsProvider: "mock" | "piper";
  vadProvider: "mock";
  webResearchProvider: "mock" | "hosted";
  fasterWhisperPythonBin: string;
  fasterWhisperModel: string;
  fasterWhisperComputeType: string;
  fasterWhisperBeamSize: number;
  fasterWhisperLanguage: string;
  piperTtsPythonBin: string;
  piperTtsModelPath: string;
  piperTtsConfigPath: string;
  piperTtsSpeakerId?: number;
  piperTtsSentenceSilenceMs: number;
  lmstudioBaseUrl: string;
  lmstudioModel: string;
  lmstudioVisionModel: string;
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
      primaryProvider = new OpenAICompatibleLLMProvider({
        providerName: "openai-compatible",
        ...sharedConfig,
      });
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
  > & {
    webResearchProvider: WebResearchProvider;
    visionProvider?: VisionProvider | undefined;
  },
): SlideIllustrationProvider => {
  switch (config.illustrationProvider) {
    case "hosted":
      return new HostedIllustrationProvider({
        webResearchProvider: config.webResearchProvider,
        timeoutMs: config.webResearchTimeoutMs,
        ...(config.visionProvider ? { visionProvider: config.visionProvider } : {}),
      });
    case "mock":
    default:
      return new MockIllustrationProvider();
  }
};

export const createVisionProvider = (
  config: Pick<
    ProviderFactoryConfig,
    | "visionProvider"
    | "lmstudioBaseUrl"
    | "lmstudioModel"
    | "lmstudioVisionModel"
    | "lmstudioApiKey"
    | "llmTimeoutMs"
  >,
): VisionProvider => {
  switch (config.visionProvider) {
    case "lmstudio":
      return new LMStudioVisionProvider({
        baseUrl: config.lmstudioBaseUrl,
        model:
          config.lmstudioVisionModel &&
          config.lmstudioVisionModel !== "local-vision-model"
            ? config.lmstudioVisionModel
            : config.lmstudioModel,
        ...(config.lmstudioApiKey ? { apiKey: config.lmstudioApiKey } : {}),
        timeoutMs: config.llmTimeoutMs,
      });
    case "mock":
    default:
      return new MockVisionProvider();
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
    case "mock":
    default:
      return new MockSTTProvider();
  }
};

export const createTextToSpeechProvider = (
  config: Pick<
    ProviderFactoryConfig,
    | "ttsProvider"
    | "piperTtsPythonBin"
    | "piperTtsModelPath"
    | "piperTtsConfigPath"
    | "piperTtsSpeakerId"
    | "piperTtsSentenceSilenceMs"
  >,
): TextToSpeechProvider => {
  switch (config.ttsProvider) {
    case "piper":
      return new PiperTTSProvider({
        pythonBin: config.piperTtsPythonBin || PIPER_TTS_DEFAULTS.pythonBin,
        modelPath: config.piperTtsModelPath || PIPER_TTS_DEFAULTS.modelPath,
        configPath:
          config.piperTtsConfigPath || PIPER_TTS_DEFAULTS.configPath,
        sentenceSilenceMs:
          config.piperTtsSentenceSilenceMs ||
          PIPER_TTS_DEFAULTS.sentenceSilenceMs,
        ...(config.piperTtsSpeakerId !== undefined
          ? { speakerId: config.piperTtsSpeakerId }
          : {}),
      });
    case "mock":
    default:
      return new MockTTSProvider();
  }
};

export const createVoiceActivityProvider = (
  config: Pick<ProviderFactoryConfig, "vadProvider">,
): VoiceActivityProvider => {
  switch (config.vadProvider) {
    case "mock":
    default:
      return new MockVADProvider();
  }
};
