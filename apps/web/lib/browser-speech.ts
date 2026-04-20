export interface BrowserSpeechToTextResult {
  text: string;
  confidence: number;
  isFinal: boolean;
}

export interface BrowserSpeechToTextProvider {
  readonly name: string;
  isSupported(): boolean;
  listenOnce(options?: {
    lang?: string;
    onStart?: () => void;
    onSpeechStart?: () => void;
    onEnd?: () => void;
    onInterimResult?: (text: string) => void;
  }): Promise<BrowserSpeechToTextResult>;
  stop(): void;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const normalizeTranscript = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();

const clampConfidence = (value?: number) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0.85;
  }

  return Math.max(0, Math.min(1, value));
};

const mapRecognitionError = (errorCode: string, message?: string) => {
  switch (errorCode) {
    case "audio-capture":
      return "Browser speech recognition could not access audio capture.";
    case "network":
      return "Browser speech recognition failed due to a network error.";
    case "not-allowed":
    case "service-not-allowed":
      return "Browser speech recognition permission was denied.";
    case "no-speech":
      return "No speech was detected by the browser recognizer.";
    case "aborted":
      return "Voice input was stopped.";
    default:
      return message?.trim() || "Browser speech recognition failed.";
  }
};

const getRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
};

class BrowserNativeSpeechToTextProvider implements BrowserSpeechToTextProvider {
  readonly name = "browser-speech-recognition";

  private activeRecognition: SpeechRecognitionLike | null = null;

  private activeReject: ((reason?: unknown) => void) | null = null;

  isSupported() {
    return getRecognitionConstructor() !== null;
  }

  stop() {
    this.activeRecognition?.stop();
    this.activeRecognition = null;
    this.activeReject?.(new Error("Voice input was stopped."));
    this.activeReject = null;
  }

  listenOnce(options?: {
    lang?: string;
    onStart?: () => void;
    onSpeechStart?: () => void;
    onEnd?: () => void;
    onInterimResult?: (text: string) => void;
  }) {
    const Recognition = getRecognitionConstructor();

    if (!Recognition) {
      return Promise.reject(
        new Error("Browser speech recognition is not supported here."),
      );
    }

    if (this.activeRecognition) {
      this.stop();
    }

    return new Promise<BrowserSpeechToTextResult>((resolve, reject) => {
      const recognition = new Recognition();
      let settled = false;
      let finalText = "";
      let finalConfidence = 0.85;
      let signaledSpeechStart = false;

      const signalSpeechStart = () => {
        if (signaledSpeechStart) {
          return;
        }

        signaledSpeechStart = true;
        options?.onSpeechStart?.();
      };

      const cleanup = () => {
        recognition.onstart = null;
        recognition.onend = null;
        recognition.onspeechstart = null;
        recognition.onsoundstart = null;
        recognition.onerror = null;
        recognition.onresult = null;
        this.activeRecognition = null;
        this.activeReject = null;
      };

      const finish = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        callback();
      };

      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = options?.lang ?? "en-US";

      recognition.onstart = () => {
        options?.onStart?.();
      };

      recognition.onspeechstart = () => {
        signalSpeechStart();
      };

      recognition.onsoundstart = () => {
        signalSpeechStart();
      };

      recognition.onresult = (event) => {
        let interimText = "";

        for (
          let index = event.resultIndex;
          index < event.results.length;
          index += 1
        ) {
          const result = event.results[index];
          if (!result) {
            continue;
          }

          const bestAlternative = result?.[0];
          const transcript = normalizeTranscript(
            bestAlternative?.transcript ?? "",
          );

          if (!transcript) {
            continue;
          }

          signalSpeechStart();

          if (result.isFinal) {
            finalText = normalizeTranscript(`${finalText} ${transcript}`);
            finalConfidence = Math.max(
              finalConfidence,
              clampConfidence(bestAlternative?.confidence),
            );
          } else {
            interimText = normalizeTranscript(`${interimText} ${transcript}`);
          }
        }

        if (interimText) {
          options?.onInterimResult?.(interimText);
        }

        if (finalText) {
          finish(() =>
            resolve({
              text: finalText,
              confidence: finalConfidence,
              isFinal: true,
            }),
          );
        }
      };

      recognition.onerror = (event) => {
        finish(() =>
          reject(
            new Error(mapRecognitionError(event.error, event.message)),
          ),
        );
      };

      recognition.onend = () => {
        options?.onEnd?.();

        if (settled) {
          return;
        }

        const normalized = normalizeTranscript(finalText);
        if (!normalized) {
          finish(() => reject(new Error("No speech was recognized.")));
          return;
        }

        finish(() =>
          resolve({
            text: normalized,
            confidence: finalConfidence,
            isFinal: true,
          }),
        );
      };

      this.activeRecognition = recognition;
      this.activeReject = reject;
      recognition.start();
    });
  }
}

export const createBrowserSpeechToTextProvider =
  (): BrowserSpeechToTextProvider | null => {
    const provider = new BrowserNativeSpeechToTextProvider();
    return provider.isSupported() ? provider : null;
  };
