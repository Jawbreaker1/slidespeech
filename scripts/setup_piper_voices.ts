import { mkdir, access, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, resolve } from "node:path";

type VoiceAsset = {
  filename: string;
  modelUrl: string;
  configUrl: string;
};

const PIPER_VOICE_RELEASE = "v1.0.0";
const DEFAULT_MODEL_PATH =
  process.env.PIPER_TTS_MODEL_PATH?.trim() ||
  "models/tts/en_US-hfc_male-medium.onnx";

const PIPER_VOICE_ASSETS: Record<string, VoiceAsset> = {
  "en_US-bryce-medium.onnx": {
    filename: "en_US-bryce-medium.onnx",
    modelUrl:
      `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_RELEASE}/en/en_US/bryce/medium/en_US-bryce-medium.onnx?download=true`,
    configUrl:
      `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_RELEASE}/en/en_US/bryce/medium/en_US-bryce-medium.onnx.json?download=true`,
  },
  "en_US-lessac-medium.onnx": {
    filename: "en_US-lessac-medium.onnx",
    modelUrl:
      `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_RELEASE}/en/en_US/lessac/medium/en_US-lessac-medium.onnx?download=true`,
    configUrl:
      `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_RELEASE}/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json?download=true`,
  },
  "en_US-hfc_male-medium.onnx": {
    filename: "en_US-hfc_male-medium.onnx",
    modelUrl:
      `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_RELEASE}/en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx?download=true`,
    configUrl:
      `https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICE_RELEASE}/en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx.json?download=true`,
  },
};

const hasReadableFile = async (path: string): Promise<boolean> => {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const downloadToFile = async (url: string, targetPath: string) => {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "SlideSpeech setup_piper_voices",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(targetPath, Buffer.from(arrayBuffer));
};

const main = async () => {
  const requestedVoice = basename(DEFAULT_MODEL_PATH);
  const primaryVoice = PIPER_VOICE_ASSETS[requestedVoice];

  if (!primaryVoice) {
    const supportedVoices = Object.keys(PIPER_VOICE_ASSETS).join(", ");
    throw new Error(
      `Unsupported Piper voice "${requestedVoice}". Supported voices: ${supportedVoices}`,
    );
  }

  const installQueue = [
    primaryVoice,
    ...[
      PIPER_VOICE_ASSETS["en_US-bryce-medium.onnx"],
      PIPER_VOICE_ASSETS["en_US-lessac-medium.onnx"],
    ].filter((voice) => voice.filename !== primaryVoice.filename),
  ];

  const modelsDir = resolve("models/tts");
  await mkdir(modelsDir, { recursive: true });

  for (const voice of installQueue) {
    const modelPath = resolve(modelsDir, voice.filename);
    const configPath = `${modelPath}.json`;

    if (!(await hasReadableFile(modelPath))) {
      console.log(`[setup:tts] downloading ${voice.filename}`);
      await downloadToFile(voice.modelUrl, modelPath);
    } else {
      console.log(`[setup:tts] keeping existing ${voice.filename}`);
    }

    if (!(await hasReadableFile(configPath))) {
      console.log(`[setup:tts] downloading ${voice.filename}.json`);
      await downloadToFile(voice.configUrl, configPath);
    } else {
      console.log(`[setup:tts] keeping existing ${voice.filename}.json`);
    }
  }

  console.log(
    `[setup:tts] ready. Primary voice: ${primaryVoice.filename}. Installed in ${dirname(
      resolve(modelsDir, primaryVoice.filename),
    )}`,
  );
};

void main().catch((error) => {
  console.error(
    `[setup:tts] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
