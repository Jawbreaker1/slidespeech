import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv({ path: ".env" });

const EnvSchema = z.object({
  API_PORT: z.coerce.number().default(4000),
  LLM_PROVIDER: z
    .enum(["mock", "lmstudio", "openai-compatible", "hosted"])
    .default("mock"),
  VISION_PROVIDER: z.enum(["mock", "lmstudio", "hosted"]).default("mock"),
  STT_PROVIDER: z.enum(["mock", "faster-whisper", "hosted"]).default("mock"),
  TTS_PROVIDER: z.enum(["mock", "piper", "hosted"]).default("mock"),
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
  STORAGE_ROOT: z.string().default("data"),
});

export const env = EnvSchema.parse(process.env);
