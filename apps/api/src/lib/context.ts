import { resolve } from "node:path";

import {
  LLMConversationTurnEngine,
  PresentationSessionService,
} from "@slidespeech/core";
import {
  createIllustrationProvider,
  createLLMProvider,
  createSpeechToTextProvider,
  createTextToSpeechProvider,
  createVisionProvider,
  createVoiceActivityProvider,
  createWebResearchProvider,
  FileDeckRepository,
  FileSessionRepository,
  FileTranscriptRepository,
  PptxGenJSDeckExporter,
} from "@slidespeech/providers";

import { env } from "../config/env";

const storageRoot = resolve(process.cwd(), env.STORAGE_ROOT);
const exportRoot = resolve(storageRoot, "exports");

const llmProvider = createLLMProvider({
  llmProvider: env.LLM_PROVIDER,
  illustrationProvider: env.ILLUSTRATION_PROVIDER,
  visionProvider: env.VISION_PROVIDER,
  sttProvider: env.STT_PROVIDER,
  ttsProvider: env.TTS_PROVIDER,
  vadProvider: env.VAD_PROVIDER,
  webResearchProvider: env.WEB_RESEARCH_PROVIDER,
  fasterWhisperPythonBin: env.FASTER_WHISPER_PYTHON_BIN,
  fasterWhisperModel: env.FASTER_WHISPER_MODEL,
  fasterWhisperComputeType: env.FASTER_WHISPER_COMPUTE_TYPE,
  fasterWhisperBeamSize: env.FASTER_WHISPER_BEAM_SIZE,
  fasterWhisperLanguage: env.FASTER_WHISPER_LANGUAGE,
  piperTtsPythonBin: env.PIPER_TTS_PYTHON_BIN,
  piperTtsModelPath: env.PIPER_TTS_MODEL_PATH,
  piperTtsConfigPath: env.PIPER_TTS_CONFIG_PATH,
  piperTtsSentenceSilenceMs: env.PIPER_TTS_SENTENCE_SILENCE_MS,
  systemTtsVoice: env.SYSTEM_TTS_VOICE,
  systemTtsRateWpm: env.SYSTEM_TTS_RATE_WPM,
  lmstudioBaseUrl: env.LMSTUDIO_BASE_URL,
  lmstudioModel: env.LMSTUDIO_MODEL,
  lmstudioVisionModel: env.LMSTUDIO_VISION_MODEL,
  llmTimeoutMs: env.LLM_TIMEOUT_MS,
  fallbackToMockOnError: env.LLM_FALLBACK_TO_MOCK_ON_ERROR,
  webResearchTimeoutMs: env.WEB_RESEARCH_TIMEOUT_MS,
  ...(env.LMSTUDIO_API_KEY ? { lmstudioApiKey: env.LMSTUDIO_API_KEY } : {}),
  ...(env.PIPER_TTS_SPEAKER_ID !== undefined
    ? { piperTtsSpeakerId: env.PIPER_TTS_SPEAKER_ID }
    : {}),
});
const webResearchProvider = createWebResearchProvider({
  webResearchProvider: env.WEB_RESEARCH_PROVIDER,
  webResearchTimeoutMs: env.WEB_RESEARCH_TIMEOUT_MS,
});
const visionProvider = createVisionProvider({
  visionProvider: env.VISION_PROVIDER,
  lmstudioBaseUrl: env.LMSTUDIO_BASE_URL,
  lmstudioModel: env.LMSTUDIO_MODEL,
  lmstudioVisionModel: env.LMSTUDIO_VISION_MODEL,
  llmTimeoutMs: env.LLM_TIMEOUT_MS,
  ...(env.LMSTUDIO_API_KEY ? { lmstudioApiKey: env.LMSTUDIO_API_KEY } : {}),
});
const illustrationProvider = createIllustrationProvider({
  illustrationProvider: env.ILLUSTRATION_PROVIDER,
  webResearchTimeoutMs: env.WEB_RESEARCH_TIMEOUT_MS,
  webResearchProvider,
  visionProvider,
});
const sttProvider = createSpeechToTextProvider({
  sttProvider: env.STT_PROVIDER,
  fasterWhisperPythonBin: env.FASTER_WHISPER_PYTHON_BIN,
  fasterWhisperModel: env.FASTER_WHISPER_MODEL,
  fasterWhisperComputeType: env.FASTER_WHISPER_COMPUTE_TYPE,
  fasterWhisperBeamSize: env.FASTER_WHISPER_BEAM_SIZE,
  fasterWhisperLanguage: env.FASTER_WHISPER_LANGUAGE,
});
const ttsProvider = createTextToSpeechProvider({
  ttsProvider: env.TTS_PROVIDER,
  piperTtsPythonBin: env.PIPER_TTS_PYTHON_BIN,
  piperTtsModelPath: env.PIPER_TTS_MODEL_PATH,
  piperTtsConfigPath: env.PIPER_TTS_CONFIG_PATH,
  piperTtsSentenceSilenceMs: env.PIPER_TTS_SENTENCE_SILENCE_MS,
  systemTtsVoice: env.SYSTEM_TTS_VOICE,
  systemTtsRateWpm: env.SYSTEM_TTS_RATE_WPM,
  ...(env.PIPER_TTS_SPEAKER_ID !== undefined
    ? { piperTtsSpeakerId: env.PIPER_TTS_SPEAKER_ID }
    : {}),
});
const vadProvider = createVoiceActivityProvider({
  vadProvider: env.VAD_PROVIDER,
});
const deckRepository = new FileDeckRepository({ rootDir: storageRoot });
const sessionRepository = new FileSessionRepository({ rootDir: storageRoot });
const transcriptRepository = new FileTranscriptRepository({
  rootDir: storageRoot,
});
const deckExporter = new PptxGenJSDeckExporter();
const conversationTurnEngine = new LLMConversationTurnEngine(llmProvider);

export const appContext = {
  llmProvider,
  illustrationProvider,
  visionProvider,
  sttProvider,
  ttsProvider,
  vadProvider,
  webResearchProvider,
  deckRepository,
  sessionRepository,
  transcriptRepository,
  deckExporter,
  exportRoot,
  sessionService: new PresentationSessionService(
    llmProvider,
    deckRepository,
    sessionRepository,
    transcriptRepository,
    conversationTurnEngine,
    undefined,
    webResearchProvider,
  ),
};
