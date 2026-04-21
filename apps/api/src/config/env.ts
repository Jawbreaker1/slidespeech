import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv({ path: ".env" });

const EnvSchema = z.object({
  API_PORT: z.coerce.number().default(4000),
  LLM_PROVIDER: z
    .enum(["mock", "lmstudio", "openai-compatible", "hosted"])
    .default("mock"),
  ILLUSTRATION_PROVIDER: z.enum(["mock", "hosted"]).default("mock"),
  VISION_PROVIDER: z.enum(["mock", "lmstudio", "hosted"]).default("mock"),
  STT_PROVIDER: z.enum(["mock", "faster-whisper", "hosted"]).default("mock"),
  TTS_PROVIDER: z.enum(["mock", "piper", "system", "hosted"]).default("mock"),
  VAD_PROVIDER: z.enum(["mock", "silero"]).default("mock"),
  WEB_RESEARCH_PROVIDER: z.enum(["mock", "hosted"]).default("mock"),
  STORAGE_PROVIDER: z.enum(["file", "sqlite"]).default("file"),
  LMSTUDIO_BASE_URL: z.string().default("http://127.0.0.1:1234/v1"),
  LMSTUDIO_MODEL: z.string().default("local-model"),
  LMSTUDIO_VISION_MODEL: z.string().default("local-vision-model"),
  LMSTUDIO_API_KEY: z.string().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().default(45000),
  LLM_FALLBACK_TO_MOCK_ON_ERROR: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  WEB_RESEARCH_TIMEOUT_MS: z.coerce.number().default(15000),
  VOICE_MAX_AUDIO_BYTES: z.coerce.number().default(5_000_000),
  FASTER_WHISPER_PYTHON_BIN: z.string().default(".venv-stt/bin/python"),
  FASTER_WHISPER_MODEL: z.string().default("base.en"),
  FASTER_WHISPER_COMPUTE_TYPE: z.string().default("int8"),
  FASTER_WHISPER_BEAM_SIZE: z.coerce.number().default(3),
  FASTER_WHISPER_LANGUAGE: z.string().default("en"),
  PIPER_TTS_PYTHON_BIN: z.string().default(".venv-tts/bin/python"),
  PIPER_TTS_MODEL_PATH: z
    .string()
    .default("models/tts/en_US-hfc_male-medium.onnx"),
  PIPER_TTS_CONFIG_PATH: z
    .string()
    .default("models/tts/en_US-hfc_male-medium.onnx.json"),
  PIPER_TTS_SPEAKER_ID: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === ""
        ? undefined
        : Number.parseInt(value, 10),
    ),
  PIPER_TTS_SENTENCE_SILENCE_MS: z.coerce.number().default(80),
  SYSTEM_TTS_VOICE: z.string().default("Daniel"),
  SYSTEM_TTS_RATE_WPM: z.coerce.number().default(180),
  STORAGE_ROOT: z.string().default("data"),
});

export const env = EnvSchema.parse(process.env);
