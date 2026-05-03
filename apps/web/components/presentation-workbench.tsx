"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type {
  GeneratePresentationResponse,
  NarrationProgressResponse,
  SpeechSynthesisResponse,
  SelectSlideResponse,
  SessionSnapshotResponse,
  SessionInteractionResponse as SessionInteractionPayload,
  SlideIllustrationAsset,
  TranscriptTurn,
  SlideNarration,
  PresentationTheme,
  VoiceTurnResponse,
  WebResearchQueryResponse,
} from "@slidespeech/types";
import {
  PRESENTATION_THEME_OPTIONS,
  resolvePresentationTheme,
} from "@slidespeech/types";
import {
  DebugPanel,
  PresenterControls,
  SlidePreviewCard,
  VisualSlideCanvas,
} from "@slidespeech/ui";

import {
  fetchExamplePresentation,
  fetchSessionSnapshot,
  fetchSlideIllustration,
  fetchSlideNarration,
  getPresentationPptxExportUrl,
  queryExternalResearch,
  generatePresentation,
  interactWithSession,
  selectSlide,
  synthesizeSpeech,
  submitVoiceTurn,
  updateNarrationProgress,
} from "../lib/api";
import {
  createBrowserSpeechToTextProvider,
  type BrowserSpeechToTextProvider,
} from "../lib/browser-speech";

const sampleTopics = [
  "How retrieval augmented generation works",
  "What a state machine is and why it helps AI runtimes",
  "Vector database fundamentals",
];

const lengthPresets = [
  { id: "short", label: "Short", durationMinutes: 3, slideCount: 4 },
  { id: "medium", label: "Medium", durationMinutes: 5, slideCount: 7 },
  { id: "long", label: "Long", durationMinutes: 8, slideCount: 10 },
] as const;

const getNarration = (
  response: GeneratePresentationResponse | null,
  slideId?: string,
): SlideNarration | undefined =>
  slideId
    ? response?.narrations.find((narration) => narration.slideId === slideId)
    : undefined;

const getNarrationSegments = (
  narration: SlideNarration | undefined,
  fallbackText: string | undefined,
): string[] => {
  const explicitSegments = narration?.segments ?? [];

  if (explicitSegments.length > 0) {
    return explicitSegments;
  }

  const baseText = narration?.narration ?? fallbackText ?? "";
  const normalized = baseText.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const sentenceLikeSegments = normalized
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return sentenceLikeSegments.length > 0 ? sentenceLikeSegments : [normalized];
};

type MergeablePresentationResponse =
  | GeneratePresentationResponse
  | NarrationProgressResponse
  | SpeechSynthesisResponse
  | SelectSlideResponse
  | SessionSnapshotResponse
  | SessionInteractionPayload
  | VoiceTurnResponse;

type VoiceTranscriptSummary = {
  source: "browser" | "backend";
  provider: string;
  text: string;
  confidence?: number;
  hadSpeech: boolean;
  transcriptAvailable: boolean;
};

const mergeResponse = (
  previous: GeneratePresentationResponse | null,
  next: MergeablePresentationResponse,
): GeneratePresentationResponse => {
  const previousNarrations = previous?.narrations ?? [];
  const nextNarrations =
    "narrations" in next
      ? next.narrations
      : next.narration
        ? [next.narration]
        : [];

  const narrationMap = new Map<string, SlideNarration>();

  for (const narration of previousNarrations) {
    narrationMap.set(narration.slideId, narration);
  }

  for (const narration of nextNarrations) {
    narrationMap.set(narration.slideId, narration);
  }

  const nextNarrationBySlideId = {
    ...(previous?.session.narrationBySlideId ?? {}),
    ...next.session.narrationBySlideId,
  };

  for (const narration of nextNarrations) {
    nextNarrationBySlideId[narration.slideId] = narration;
  }

  return {
    deck: next.deck,
    session: {
      ...next.session,
      narrationBySlideId: nextNarrationBySlideId,
    },
    narrations: [...narrationMap.values()],
    provider: next.provider,
  };
};

const toInteractionLog = (
  transcripts: TranscriptTurn[],
): Array<{ role: "user" | "assistant"; text: string }> =>
  transcripts
    .filter(
      (turn): turn is TranscriptTurn & { role: "user" | "assistant" } =>
        turn.role === "user" || turn.role === "assistant",
    )
    .map((turn) => ({
      role: turn.role,
      text: turn.text,
    }));

export const PresentationWorkbench = () => {
  const [topic, setTopic] = useState<string>(
    sampleTopics[1] ?? sampleTopics[0] ?? "How an AI tutor works",
  );
  const [response, setResponse] = useState<GeneratePresentationResponse | null>(
    null,
  );
  const [forceWebResearch, setForceWebResearch] = useState(false);
  const [selectedLengthId, setSelectedLengthId] = useState<
    (typeof lengthPresets)[number]["id"]
  >("medium");
  const [selectedThemeId, setSelectedThemeId] =
    useState<PresentationTheme>("paper");
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [commandInput, setCommandInput] = useState("");
  const [interactionLog, setInteractionLog] = useState<
    Array<{ role: "user" | "assistant"; text: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingDeck, setIsGeneratingDeck] = useState(false);
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(
    null,
  );
  const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
  const [narrationLoadingSlideId, setNarrationLoadingSlideId] = useState<
    string | null
  >(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [selectingSlideId, setSelectingSlideId] = useState<string | null>(null);
  const [isRefreshingSession, setIsRefreshingSession] = useState(false);
  const [illustrationLoadingSlideId, setIllustrationLoadingSlideId] = useState<
    string | null
  >(null);
  const [lastTurnDecision, setLastTurnDecision] = useState<
    SessionInteractionPayload["turnDecision"] | null
  >(null);
  const [researchQuery, setResearchQuery] = useState("");
  const [researchResult, setResearchResult] =
    useState<WebResearchQueryResponse | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isListeningBrowserVoice, setIsListeningBrowserVoice] = useState(false);
  const [isSubmittingVoice, setIsSubmittingVoice] = useState(false);
  const [isUpdatingNarrationProgress, setIsUpdatingNarrationProgress] =
    useState(false);
  const [isSynthesizingSpeech, setIsSynthesizingSpeech] = useState(false);
  const [isPlayingSpeech, setIsPlayingSpeech] = useState(false);
  const [autoPlaySpeech, setAutoPlaySpeech] = useState(false);
  const [lastSpokenText, setLastSpokenText] = useState<string | null>(null);
  const [browserInterimTranscript, setBrowserInterimTranscript] = useState("");
  const [browserSpeechSupported, setBrowserSpeechSupported] = useState(false);
  const [lastVoiceTranscript, setLastVoiceTranscript] =
    useState<VoiceTranscriptSummary | null>(null);
  const [illustrationsBySlideId, setIllustrationsBySlideId] = useState<
    Record<string, SlideIllustrationAsset>
  >({});
  const [isPending, startTransition] = useTransition();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const browserSpeechProviderRef = useRef<BrowserSpeechToTextProvider | null>(
    null,
  );
  const illustrationPrefetchRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    startTransition(async () => {
      try {
        setError(null);
        setIsGeneratingDeck(true);
        const example = await fetchExamplePresentation();
        setResponse(example);
      } catch (loadError) {
        setError((loadError as Error).message);
      } finally {
        setIsGeneratingDeck(false);
      }
    });
  }, []);

  useEffect(() => {
    const provider = createBrowserSpeechToTextProvider();
    browserSpeechProviderRef.current = provider;
    setBrowserSpeechSupported(provider !== null);

    return () => {
      provider?.stop();
      browserSpeechProviderRef.current = null;
    };
  }, []);

  useEffect(() => () => {
    stopActiveAudio();
    stopActiveMediaStream();
    browserSpeechProviderRef.current?.stop();
  }, []);

  useEffect(() => {
    if (!isGeneratingDeck || generationStartedAt === null) {
      setGenerationElapsedSeconds(0);
      return;
    }

    setGenerationElapsedSeconds(
      Math.max(0, Math.floor((Date.now() - generationStartedAt) / 1000)),
    );

    const timer = window.setInterval(() => {
      setGenerationElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - generationStartedAt) / 1000)),
      );
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [generationStartedAt, isGeneratingDeck]);

  const slides = response?.deck.slides ?? [];
  const deckTheme = response
    ? resolvePresentationTheme(
        response.deck.metadata.theme,
        `${response.deck.id}:${response.deck.topic}`,
      )
    : undefined;
  const activeSlide = slides[currentSlideIndex];
  const narration = getNarration(response, activeSlide?.id);
  const narrationSegments = useMemo(
    () => getNarrationSegments(narration, activeSlide?.beginnerExplanation),
    [activeSlide?.beginnerExplanation, narration],
  );
  const currentNarrationIndex = Math.max(
    0,
    Math.min(
      response?.session.currentNarrationIndex ?? 0,
      Math.max(narrationSegments.length - 1, 0),
    ),
  );
  const currentNarrationText =
    narrationSegments[currentNarrationIndex] ??
    narration?.narration ??
    activeSlide?.beginnerExplanation ??
    "";
  const sessionState = response?.session.state ?? "idle";
  const isPresenting = sessionState === "presenting" || sessionState === "resuming";
  const activeIllustration = activeSlide
    ? illustrationsBySlideId[activeSlide.id]
    : undefined;
  const generationStatusMessage =
    generationElapsedSeconds < 10
      ? "Sending the prompt and waiting for the local model to start responding."
      : generationElapsedSeconds < 40
        ? "Building the deck structure and validating slide content."
        : "Still generating. Local 27B models can take a while on full deck output.";

  useEffect(() => {
    if (response) {
      setCurrentSlideIndex(response.session.currentSlideIndex);
    }
  }, [response?.session.currentSlideIndex]);

  useEffect(() => {
    const sessionId = response?.session.id;

    if (!sessionId) {
      return;
    }

    let cancelled = false;
    setIsRefreshingSession(true);

    fetchSessionSnapshot(sessionId)
      .then((snapshot: SessionSnapshotResponse) => {
        if (cancelled) {
          return;
        }

        setResponse((previous) => mergeResponse(previous, snapshot));
        setInteractionLog(toInteractionLog(snapshot.transcripts));
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError((loadError as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRefreshingSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [response?.session.id, response?.session.transcriptTurnIds.length]);

  useEffect(() => {
    if (
      !response ||
      !activeSlide ||
      narration ||
      narrationLoadingSlideId === activeSlide.id
    ) {
      return;
    }

    let cancelled = false;

    setNarrationLoadingSlideId(activeSlide.id);

    fetchSlideNarration(response.session.id, activeSlide.id)
      .then((nextNarration) => {
        if (cancelled) {
          return;
        }

        setResponse((previous) => {
          if (!previous) {
            return previous;
          }

          const alreadyPresent = previous.narrations.some(
            (candidate) => candidate.slideId === nextNarration.slideId,
          );

          return {
            ...previous,
            narrations: alreadyPresent
              ? previous.narrations.map((candidate) =>
                  candidate.slideId === nextNarration.slideId
                    ? nextNarration
                    : candidate,
                )
              : [...previous.narrations, nextNarration],
            session: {
              ...previous.session,
              narrationBySlideId: {
                ...previous.session.narrationBySlideId,
                [nextNarration.slideId]: nextNarration,
              },
            },
          };
        });
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError((loadError as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setNarrationLoadingSlideId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSlide, narration, narrationLoadingSlideId, response]);

  useEffect(() => {
    if (
      !response ||
      !activeSlide ||
      illustrationsBySlideId[activeSlide.id] ||
      illustrationLoadingSlideId === activeSlide.id ||
      activeSlide.visuals.imageSlots.length === 0
    ) {
      return;
    }

    let cancelled = false;
    setIllustrationLoadingSlideId(activeSlide.id);

    fetchSlideIllustration(response.session.id, activeSlide.id)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setIllustrationsBySlideId((previous) => ({
          ...previous,
          [result.asset.slideId]: result.asset,
        }));
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError((loadError as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIllustrationLoadingSlideId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeSlide,
    illustrationLoadingSlideId,
    illustrationsBySlideId,
    response,
  ]);

  useEffect(() => {
    if (!response) {
      return;
    }

    const slidesNeedingIllustrations = response.deck.slides.filter(
      (slide) =>
        slide.visuals.imageSlots.length > 0 &&
        !illustrationsBySlideId[slide.id] &&
        !illustrationPrefetchRef.current.has(slide.id),
    );

    if (slidesNeedingIllustrations.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      for (const slide of slidesNeedingIllustrations.slice(0, 6)) {
        if (cancelled) {
          return;
        }

        illustrationPrefetchRef.current.add(slide.id);

        try {
          const result = await fetchSlideIllustration(response.session.id, slide.id);

          if (cancelled) {
            return;
          }

          setIllustrationsBySlideId((previous) =>
            previous[result.asset.slideId]
              ? previous
              : {
                  ...previous,
                  [result.asset.slideId]: result.asset,
                },
          );
        } catch {
          // Background slide illustration loading should not interrupt the main flow.
        } finally {
          illustrationPrefetchRef.current.delete(slide.id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [illustrationsBySlideId, response]);

  const transcriptItems = useMemo(
    () =>
      activeSlide
        ? [
            {
              label: "Current teaching goal",
              value: activeSlide.learningGoal,
            },
            {
              label: "Speaker note",
              value:
                activeSlide.speakerNotes[0] ??
                "No speaker note stored for this slide yet.",
            },
            {
              label: "Suggested pause prompt",
              value:
                narrationLoadingSlideId === activeSlide.id
                  ? "Generating narration for this slide..."
                  : narration?.promptsForPauses[0] ??
                    "No pause prompt generated yet.",
            },
          ]
        : [],
    [activeSlide, narration, narrationLoadingSlideId],
  );
  const latestAssistantUtterance = useMemo(
    () =>
      [...interactionLog]
        .reverse()
        .find((entry) => entry.role === "assistant")?.text ?? null,
    [interactionLog],
  );
  const selectedLength =
    lengthPresets.find((preset) => preset.id === selectedLengthId) ??
    lengthPresets[1];

  const submitTopic = () => {
    startTransition(async () => {
      try {
        setError(null);
        setCurrentSlideIndex(0);
        setNarrationLoadingSlideId(null);
        setIllustrationsBySlideId({});
        illustrationPrefetchRef.current.clear();
        setIsGeneratingDeck(true);
        setGenerationStartedAt(Date.now());
        const nextResponse = await generatePresentation(topic, {
          useWebResearch: forceWebResearch,
          targetDurationMinutes: selectedLength.durationMinutes,
          targetSlideCount: selectedLength.slideCount,
          theme: selectedThemeId,
        });
        setResponse(nextResponse);
        if (autoPlaySpeech && nextResponse.session.currentSlideId) {
          await playSpeech({
            sessionIdOverride: nextResponse.session.id,
            slideId: nextResponse.session.currentSlideId,
            narrationIndex: nextResponse.session.currentNarrationIndex,
            style: "narration",
          });
        }
      } catch (submitError) {
        setError((submitError as Error).message);
      } finally {
        setIsGeneratingDeck(false);
        setGenerationStartedAt(null);
      }
    });
  };

  const handleSelectSlide = (slideIndex: number) => {
    const targetSlide = slides[slideIndex];
    const sessionId = response?.session.id;

    if (!targetSlide || !sessionId) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        setSelectingSlideId(targetSlide.id);
        const result = await selectSlide(sessionId, targetSlide.id);
        setResponse((previous) => mergeResponse(previous, result));
        setCurrentSlideIndex(result.session.currentSlideIndex);
      } catch (selectionError) {
        setError((selectionError as Error).message);
      } finally {
        setSelectingSlideId(null);
      }
    });
  };

  const handleNarrationStep = (nextNarrationIndex: number) => {
    const sessionId = response?.session.id;

    if (!sessionId || !activeSlide || narrationSegments.length === 0) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        setIsUpdatingNarrationProgress(true);
        const result = await updateNarrationProgress(sessionId, {
          slideId: activeSlide.id,
          narrationIndex: nextNarrationIndex,
        });
        setResponse((previous) => mergeResponse(previous, result));
        if (autoPlaySpeech) {
          await playSpeech({
            sessionIdOverride: result.session.id,
            slideId: activeSlide.id,
            narrationIndex: nextNarrationIndex,
            style: "narration",
          });
        }
      } catch (progressError) {
        setError((progressError as Error).message);
      } finally {
        setIsUpdatingNarrationProgress(false);
      }
    });
  };

  const applyInteractionResponse = async (
    result: SessionInteractionPayload | VoiceTurnResponse,
  ) => {
    setResponse((previous) => mergeResponse(previous, result));
    setCurrentSlideIndex(result.session.currentSlideIndex);

    if ("turnDecision" in result && result.turnDecision) {
      setLastTurnDecision(result.turnDecision);
    }

    if ("assistantMessage" in result && result.assistantMessage?.trim() && autoPlaySpeech) {
      await playSpeech({
        sessionIdOverride: result.session.id,
        text: result.assistantMessage,
        style: "answer",
      });
    }
  };

  const sendInteraction = (text: string) => {
    const sessionId = response?.session.id;

    if (!sessionId || !text.trim()) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        setIsInteracting(true);
        const result = await interactWithSession(sessionId, text.trim());
        await applyInteractionResponse(result);
        setCommandInput("");
      } catch (interactionError) {
        setError((interactionError as Error).message);
      } finally {
        setIsInteracting(false);
      }
    });
  };

  const runResearch = () => {
    if (!researchQuery.trim()) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        setIsResearching(true);
        const result = await queryExternalResearch(researchQuery.trim());
        setResearchResult(result);
      } catch (researchError) {
        setError((researchError as Error).message);
      } finally {
        setIsResearching(false);
      }
    });
  };

  const stopActiveMediaStream = () => {
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
    }
  };

  const stopActiveAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    setIsPlayingSpeech(false);
  };

  const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
    }

    return window.btoa(binary);
  };

  const playSpeech = async (input: {
    sessionIdOverride?: string;
    text?: string;
    slideId?: string;
    narrationIndex?: number;
    style?: "narration" | "answer" | "summary";
  }) => {
    const sessionId = input.sessionIdOverride ?? response?.session.id;

    if (!sessionId) {
      return;
    }

    try {
      setError(null);
      setIsSynthesizingSpeech(true);
      const { sessionIdOverride: _sessionIdOverride, ...request } = input;
      const result = await synthesizeSpeech(sessionId, request);
      setResponse((previous) => mergeResponse(previous, result));
      stopActiveAudio();

      const audio = new Audio(
        `data:${result.audio.mimeType};base64,${result.audio.audioBase64}`,
      );

      audio.onended = () => {
        setIsPlayingSpeech(false);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setIsPlayingSpeech(false);
        audioRef.current = null;
        setError("Audio playback failed in the browser.");
      };

      audioRef.current = audio;
      setLastSpokenText(result.text);
      setIsPlayingSpeech(true);
      await audio.play();
    } catch (speechError) {
      setError((speechError as Error).message);
      setIsPlayingSpeech(false);
    } finally {
      setIsSynthesizingSpeech(false);
    }
  };

  const handleBackendVoiceRecording = () => {
    const sessionId = response?.session.id;

    if (!sessionId || isSubmittingVoice) {
      return;
    }

    if (isRecordingVoice) {
      mediaRecorderRef.current?.stop();
      setIsRecordingVoice(false);
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        mediaStreamRef.current = stream;
        chunksRef.current = [];

        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };

        recorder.onstop = async () => {
          try {
            setIsSubmittingVoice(true);
            const blob = new Blob(chunksRef.current, {
              type: recorder.mimeType || "audio/webm",
            });
            const dataBase64 = await blobToBase64(blob);
            const result = await submitVoiceTurn(sessionId, {
              mimeType: blob.type || "audio/webm",
              dataBase64,
            });

            setLastVoiceTranscript({
              source: "backend",
              provider: result.sttProvider,
              text: result.transcript?.text ?? "",
              ...(typeof result.transcript?.confidence === "number"
                ? { confidence: result.transcript.confidence }
                : {}),
              hadSpeech: result.speechEvent.hasSpeech,
              transcriptAvailable: Boolean(result.transcript?.text.trim()),
            });

            if (result.interactionApplied) {
              await applyInteractionResponse(result);
            } else {
              setResponse((previous) => mergeResponse(previous, result));
            }
          } catch (voiceError) {
            setError((voiceError as Error).message);
          } finally {
            stopActiveMediaStream();
            mediaRecorderRef.current = null;
            mediaStreamRef.current = null;
            chunksRef.current = [];
            setIsSubmittingVoice(false);
          }
        };

        recorder.start();
        setIsRecordingVoice(true);
      } catch (recordingError) {
        setError((recordingError as Error).message);
        stopActiveMediaStream();
        mediaRecorderRef.current = null;
        mediaStreamRef.current = null;
        setIsRecordingVoice(false);
      }
    });
  };

  const handleBrowserVoiceInput = () => {
    const sessionId = response?.session.id;
    const provider = browserSpeechProviderRef.current;

    if (!sessionId || !provider || isSubmittingVoice) {
      return;
    }

    if (isListeningBrowserVoice) {
      provider.stop();
      setIsListeningBrowserVoice(false);
      setBrowserInterimTranscript("");
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        setIsSubmittingVoice(true);
        const transcript = await provider.listenOnce({
          lang: "en-US",
          onStart: () => {
            setIsListeningBrowserVoice(true);
            setBrowserInterimTranscript("");
          },
          onEnd: () => {
            setIsListeningBrowserVoice(false);
          },
          onInterimResult: (text) => {
            setBrowserInterimTranscript(text);
          },
        });

        setLastVoiceTranscript({
          source: "browser",
          provider: provider.name,
          text: transcript.text,
          ...(typeof transcript.confidence === "number"
            ? { confidence: transcript.confidence }
            : {}),
          hadSpeech: Boolean(transcript.text.trim()),
          transcriptAvailable: Boolean(transcript.text.trim()),
        });

        const result = await interactWithSession(sessionId, transcript.text);
        await applyInteractionResponse(result);
      } catch (voiceError) {
        const message = (voiceError as Error).message;
        if (message !== "Voice input was stopped.") {
          setError(message);
        }
      } finally {
        setIsListeningBrowserVoice(false);
        setBrowserInterimTranscript("");
        setIsSubmittingVoice(false);
      }
    });
  };

  const handleVoiceRecording = () => {
    if (browserSpeechSupported) {
      handleBrowserVoiceInput();
      return;
    }

    handleBackendVoiceRecording();
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-6 md:px-8 md:py-8">
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_380px]">
        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white/85 p-6 shadow-panel backdrop-blur md:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-teal">
                SlideSpeech MVP / Phase 3
              </p>
              <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight text-ink md:text-4xl">
                Interactive AI presenter with a modular orchestration layer
              </h1>
              <p className="mt-4 max-w-2xl font-body text-base leading-7 text-slate-700">
                Conversation-first presenter runtime with web-grounded deck
                generation, browser voice input, segmented narration, and a
                replaceable provider layer for LLM, STT, TTS, and research.
              </p>
            </div>
            <div className="rounded-[24px] bg-ink px-4 py-3 text-paper lg:min-w-52">
              <p className="text-xs uppercase tracking-[0.22em] text-paper/60">
                Active provider
              </p>
              <p className="mt-1 break-all text-base font-semibold md:text-lg">
                {response?.provider ?? "loading"}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="rounded-[22px] border border-slate-200 bg-paper px-4 py-4 md:px-5">
              <label
                className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500"
                htmlFor="topic"
              >
                Topic or teaching prompt
              </label>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                You can include one or more source URLs here. Explicit URLs are fetched and used as grounding instead of being treated as plain text.
              </p>
              <textarea
                id="topic"
                className="mt-3 min-h-24 w-full resize-none bg-transparent text-base leading-7 text-ink outline-none"
                onChange={(event) => setTopic(event.target.value)}
                value={topic}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                {sampleTopics.map((sampleTopic) => (
                  <button
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:border-ink hover:text-ink"
                    key={sampleTopic}
                    onClick={() => setTopic(sampleTopic)}
                    type="button"
                  >
                    {sampleTopic}
                  </button>
                ))}
              </div>
              <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
                <input
                  checked={forceWebResearch}
                  className="h-4 w-4 accent-coral"
                  onChange={(event) => setForceWebResearch(event.target.checked)}
                  type="checkbox"
                />
                Force web research even when the topic is not time-sensitive
              </label>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Current topics such as latest news, recent releases, and dated
                subjects are automatically web-grounded when hosted research is enabled.
              </p>
              <div className="mt-4 rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">
                  Presentation length
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {lengthPresets.map((preset) => {
                    const selected = preset.id === selectedLengthId;

                    return (
                      <button
                        className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                          selected
                            ? "border-coral bg-coral text-white"
                            : "border-slate-300 text-slate-700 hover:border-ink hover:text-ink"
                        }`}
                        key={preset.id}
                        onClick={() => setSelectedLengthId(preset.id)}
                        type="button"
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Target about {selectedLength.durationMinutes} minutes and roughly{" "}
                  {selectedLength.slideCount} slides.
                </p>
              </div>
              <div className="mt-4 rounded-[18px] border border-slate-200 bg-white px-4 py-3">
                <p className="text-sm font-semibold text-slate-800">
                  Theme
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {PRESENTATION_THEME_OPTIONS.map((themeOption) => {
                    const selected = themeOption.id === selectedThemeId;

                    return (
                      <button
                        className={`rounded-[16px] border p-3 text-left transition ${
                          selected
                            ? "border-coral bg-coral/10 shadow-[0_12px_30px_rgba(255,91,78,0.12)]"
                            : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                        }`}
                        key={themeOption.id}
                        onClick={() => setSelectedThemeId(themeOption.id)}
                        type="button"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className="inline-flex h-7 w-7 rounded-full border border-white shadow-sm"
                            style={{
                              background: `linear-gradient(135deg, ${themeOption.preview.background} 0%, ${themeOption.preview.background} 55%, ${themeOption.preview.accent} 56%, ${themeOption.preview.accent} 100%)`,
                            }}
                          />
                          <span className="text-sm font-semibold text-slate-900">
                            {themeOption.label}
                          </span>
                        </span>
                        <span className="mt-2 block text-xs leading-5 text-slate-500">
                          {themeOption.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              className="rounded-[22px] bg-coral px-5 py-3 text-base font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isPending || isGeneratingDeck}
              onClick={submitTopic}
              type="button"
            >
              {isGeneratingDeck
                ? `Generating deck... ${generationElapsedSeconds}s`
                : "Generate deck"}
            </button>
          </div>

          {isGeneratingDeck ? (
            <div className="mt-5 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
                    Deck generation in progress
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    Local model is working on your presentation.
                  </p>
                  <p className="mt-1 text-sm leading-6 text-amber-900/80">
                    {generationStatusMessage}
                  </p>
                </div>
                <div className="rounded-full border border-amber-300 bg-white/70 px-4 py-2 text-sm font-semibold text-amber-900">
                  {generationElapsedSeconds}s elapsed
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-amber-100">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-amber-400" />
              </div>
              <p className="mt-3 text-xs leading-5 text-amber-800/80">
                With a local model this can take 1 to 3 minutes. The previous deck
                stays visible until the new one is ready.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-5 rounded-[18px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {response?.session.id ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
                href={`/present/${response.session.id}`}
              >
                Open presenter mode
              </Link>
              <a
                className="rounded-full border border-ink px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink hover:text-white"
                href={getPresentationPptxExportUrl(response.session.id)}
              >
                Download PPTX
              </a>
            </div>
          ) : null}

          {activeSlide ? (
            <section className="relative mt-6 rounded-[30px] bg-ink p-5 text-paper md:p-6">
              {isGeneratingDeck ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[30px] bg-ink/72 backdrop-blur-sm">
                  <div className="mx-6 max-w-md rounded-[24px] border border-white/10 bg-white/10 px-5 py-5 text-center shadow-2xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/60">
                      Working on new deck
                    </p>
                    <p className="mt-3 text-xl font-semibold text-paper">
                      The local model is generating your next presentation.
                    </p>
                    <p className="mt-3 text-sm leading-6 text-paper/75">
                      {generationStatusMessage}
                    </p>
                    <div className="mt-4 inline-flex rounded-full border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-paper">
                      {generationElapsedSeconds}s elapsed
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="max-w-3xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-paper/60">
                    Presenter View
                  </p>
                  <h2 className="mt-3 text-2xl font-semibold md:text-3xl">
                    {activeSlide.title}
                  </h2>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-[0.22em] text-paper/60">
                    Narration point {currentNarrationIndex + 1} of{" "}
                    {Math.max(narrationSegments.length, 1)}
                  </p>
                  <p className="mt-4 max-w-3xl font-body text-base leading-7 text-paper/90 md:text-lg">
                    {narrationLoadingSlideId === activeSlide.id
                      ? "Generating narration for this slide..."
                      : currentNarrationText}
                  </p>
                  {narrationSegments.length > 1 ? (
                    <div className="mt-4 grid gap-2">
                      {narrationSegments.map((segment, index) => (
                        <div
                          className={`rounded-[16px] border px-3 py-2 text-sm leading-6 ${
                            index === currentNarrationIndex
                              ? "border-coral bg-coral/15 text-paper"
                              : "border-paper/15 bg-white/5 text-paper/70"
                          }`}
                          key={`${activeSlide.id}-segment-${index}`}
                        >
                          <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper/55">
                            {index + 1}
                          </span>
                          {segment}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {activeSlide.keyPoints.map((point) => (
                      <span
                        className="rounded-full border border-paper/20 px-3 py-1.5 text-xs text-paper/80 md:text-sm"
                        key={point}
                      >
                        {point}
                      </span>
                    ))}
                  </div>
                  <div className="mt-6">
                    <VisualSlideCanvas
                      slide={activeSlide}
                      dark
                      illustrationAsset={activeIllustration}
                      theme={deckTheme}
                    />
                    {illustrationLoadingSlideId === activeSlide.id ? (
                      <p className="mt-3 text-xs text-paper/60">
                        Resolving slide illustration...
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="w-full rounded-[22px] bg-white/10 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/60">
                    Runtime status
                  </p>
                  <div className="mt-4 space-y-3 text-sm text-paper/85">
                    <div className="flex items-center justify-between">
                      <span>Session state</span>
                      <span className="font-semibold">
                        {sessionState}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Current slide</span>
                      <span className="font-semibold">
                        {currentSlideIndex + 1} / {slides.length}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Narration point</span>
                      <span className="font-semibold">
                        {currentNarrationIndex + 1} /{" "}
                        {Math.max(narrationSegments.length, 1)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Mode</span>
                      <span className="font-semibold">
                        {isPresenting ? "Presenting" : "Paused"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Generation</span>
                      <span className="font-semibold">
                        {isGeneratingDeck
                          ? "Deck generation"
                          : isRefreshingSession
                            ? "Session sync"
                            : isUpdatingNarrationProgress
                              ? "Narration progress"
                          : narrationLoadingSlideId === activeSlide?.id
                            ? "Narration loading"
                            : "Idle"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Speech</span>
                      <span className="font-semibold">
                        {isSynthesizingSpeech
                          ? "Synthesizing"
                          : isPlayingSpeech
                            ? "Playing"
                            : "Ready"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-full border border-paper/25 px-3 py-1.5 text-sm text-paper transition hover:border-paper/50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={
                      !response ||
                      !activeSlide ||
                      isSynthesizingSpeech ||
                      narrationLoadingSlideId === activeSlide.id
                    }
                    onClick={() =>
                      void playSpeech({
                        slideId: activeSlide.id,
                        narrationIndex: currentNarrationIndex,
                        style: "narration",
                      })
                    }
                    type="button"
                  >
                    {isSynthesizingSpeech ? "Synthesizing..." : "Speak current point"}
                  </button>
                  <button
                    className="rounded-full border border-paper/25 px-3 py-1.5 text-sm text-paper transition hover:border-paper/50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!isPlayingSpeech}
                    onClick={stopActiveAudio}
                    type="button"
                  >
                    Stop audio
                  </button>
                  <button
                    className={`rounded-full px-3 py-1.5 text-sm transition ${
                      autoPlaySpeech
                        ? "bg-coral text-white"
                        : "border border-paper/25 text-paper hover:border-paper/50"
                    }`}
                    onClick={() => setAutoPlaySpeech((previous) => !previous)}
                    type="button"
                  >
                    {autoPlaySpeech ? "Auto-play on" : "Auto-play off"}
                  </button>
                </div>
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    className="rounded-full border border-paper/25 px-3 py-1.5 text-sm text-paper transition hover:border-paper/50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={
                      narrationSegments.length <= 1 ||
                      currentNarrationIndex === 0 ||
                      isUpdatingNarrationProgress
                    }
                    onClick={() =>
                      handleNarrationStep(Math.max(currentNarrationIndex - 1, 0))
                    }
                    type="button"
                  >
                    Previous point
                  </button>
                  <button
                    className="rounded-full border border-paper/25 px-3 py-1.5 text-sm text-paper transition hover:border-paper/50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={
                      narrationSegments.length <= 1 ||
                      currentNarrationIndex >= narrationSegments.length - 1 ||
                      isUpdatingNarrationProgress
                    }
                    onClick={() =>
                      handleNarrationStep(
                        Math.min(
                          currentNarrationIndex + 1,
                          narrationSegments.length - 1,
                        ),
                      )
                    }
                    type="button"
                  >
                    {isUpdatingNarrationProgress ? "Updating..." : "Next point"}
                  </button>
                </div>
                {lastSpokenText ? (
                  <p className="mb-4 text-sm leading-6 text-paper/70">
                    Last spoken: {lastSpokenText}
                  </p>
                ) : null}
                <PresenterControls
                  canGoBack={currentSlideIndex > 0}
                  canGoForward={currentSlideIndex < slides.length - 1}
                  isPresenting={isPresenting}
                  onBack={() => handleSelectSlide(Math.max(currentSlideIndex - 1, 0))}
                  onForward={() =>
                    handleSelectSlide(
                      Math.min(currentSlideIndex + 1, slides.length - 1),
                    )
                  }
                  onTogglePresenting={() =>
                    sendInteraction(isPresenting ? "stop" : "continue")
                  }
                />
              </div>
            </section>
          ) : null}
        </div>

        <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <DebugPanel title="Conversation">
            <div className="space-y-4">
              <div className="rounded-[18px] border border-slate-200 bg-paper px-4 py-4">
                <label
                  className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"
                  htmlFor="session-command"
                >
                  Talk naturally about this presentation
                </label>
                <textarea
                  id="session-command"
                  className="mt-3 min-h-24 w-full resize-none bg-transparent text-sm leading-6 text-ink outline-none"
                  onChange={(event) => setCommandInput(event.target.value)}
                  placeholder="Ask a question, say what is unclear, request an example, or just continue the conversation."
                  value={commandInput}
                />
                <button
                  className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!response || !commandInput.trim() || isInteracting}
                  onClick={() => sendInteraction(commandInput)}
                  type="button"
                >
                  {isInteracting ? "Sending..." : "Send"}
                </button>
                <button
                  className="mt-3 ml-2 rounded-full border border-ink px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={
                    !response ||
                    isInteracting ||
                    (isSubmittingVoice && !isListeningBrowserVoice) ||
                    typeof navigator === "undefined" ||
                    (!browserSpeechSupported &&
                      !navigator.mediaDevices?.getUserMedia)
                  }
                  onClick={handleVoiceRecording}
                  type="button"
                >
                  {isSubmittingVoice
                    ? "Processing voice..."
                    : isListeningBrowserVoice
                      ? "Stop listening"
                      : isRecordingVoice
                        ? "Stop recording"
                        : browserSpeechSupported
                          ? "Voice input (browser STT)"
                          : "Voice input (audio fallback)"}
                </button>
                {browserSpeechSupported ? (
                  <button
                    className="mt-3 ml-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={
                      !response ||
                      isInteracting ||
                      isSubmittingVoice ||
                      typeof navigator === "undefined" ||
                      !navigator.mediaDevices?.getUserMedia
                    }
                    onClick={handleBackendVoiceRecording}
                    type="button"
                  >
                    Audio fallback
                  </button>
                ) : null}
                <p className="mt-3 font-body text-xs leading-6 text-slate-500">
                  {browserSpeechSupported
                    ? "Browser-native speech recognition is active when supported. Audio upload through backend STT remains as the fallback path."
                    : "Browser speech recognition is unavailable here, so voice input uses recorded audio plus the backend STT provider."}
                </p>
                {browserInterimTranscript ? (
                  <p className="mt-2 font-body text-xs leading-6 text-slate-600">
                    Listening:
                    {" "}
                    {browserInterimTranscript}
                  </p>
                ) : null}
                {lastVoiceTranscript ? (
                  <p className="mt-3 font-body text-xs leading-6 text-slate-600">
                    Voice turn:
                    {" "}
                    {lastVoiceTranscript.transcriptAvailable
                      ? `${lastVoiceTranscript.text} (${lastVoiceTranscript.provider})`
                      : lastVoiceTranscript.hadSpeech
                        ? `Speech was detected but no transcript was produced (${lastVoiceTranscript.provider}).`
                        : `No speech detected (${lastVoiceTranscript.provider}).`}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!latestAssistantUtterance || isSynthesizingSpeech}
                    onClick={() => {
                      if (!latestAssistantUtterance) {
                        return;
                      }

                      void playSpeech({
                        text: latestAssistantUtterance,
                        style: "answer",
                      });
                    }}
                    type="button"
                  >
                    Speak last answer
                  </button>
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Shortcut actions
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    "stop",
                    "continue",
                    "back",
                    "explain simpler",
                    "give example",
                    "go deeper",
                    "repeat",
                  ].map((command) => (
                    <button
                      className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!response || isInteracting}
                      key={command}
                      onClick={() =>
                        sendInteraction(
                          command === "go deeper" ? "deepen" : command,
                        )
                      }
                      type="button"
                    >
                      {command}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </DebugPanel>

          <DebugPanel title="Session Runtime">
            <div className="space-y-4">
              {transcriptItems.map((item) => (
                <div
                  className="rounded-[22px] bg-paper px-4 py-3"
                  key={item.label}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {item.label}
                  </p>
                  <p className="mt-2 font-body text-sm leading-6 text-slate-700">
                    {item.value}
                  </p>
                </div>
              ))}
              {lastTurnDecision ? (
                <div className="rounded-[22px] bg-paper px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Last turn interpretation
                  </p>
                  <div className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                    <p>
                      <span className="font-semibold text-ink">Mode:</span>{" "}
                      {lastTurnDecision.responseMode}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Needs:</span>{" "}
                      {lastTurnDecision.inferredNeeds.join(", ") || "none"}
                    </p>
                    <p>
                      <span className="font-semibold text-ink">Effects:</span>{" "}
                      {Object.entries(lastTurnDecision.runtimeEffects).length > 0
                        ? Object.entries(lastTurnDecision.runtimeEffects)
                            .map(([key, value]) => `${key}=${String(value)}`)
                            .join(", ")
                        : "none"}
                    </p>
                  </div>
                </div>
              ) : null}
              {response?.deck.source.sourceIds.length ? (
                <div className="rounded-[22px] bg-paper px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Grounding sources
                  </p>
                  <div className="mt-2 space-y-2">
                    {response.deck.source.sourceIds.map((sourceUrl) => (
                      <a
                        className="block break-all text-sm leading-6 text-teal underline-offset-2 hover:underline"
                        href={sourceUrl}
                        key={sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {sourceUrl}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </DebugPanel>

          <DebugPanel title="Interaction Log">
            <div className="max-h-[280px] space-y-3 overflow-auto">
              {interactionLog.length === 0 ? (
                <p className="font-body text-sm leading-6 text-slate-700">
                  No interaction yet.
                </p>
              ) : (
                interactionLog.map((entry, index) => (
                  <div
                    className={`rounded-[18px] px-4 py-3 text-sm leading-6 ${
                      entry.role === "assistant"
                        ? "bg-paper text-slate-700"
                        : "bg-slate-100 text-ink"
                    }`}
                    key={`${entry.role}-${index}`}
                  >
                    <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      {entry.role}
                    </p>
                    <p className="font-body">{entry.text}</p>
                  </div>
                ))
              )}
            </div>
          </DebugPanel>

          <DebugPanel title="External Research">
            <div className="space-y-4">
              <div className="rounded-[18px] border border-slate-200 bg-paper px-4 py-4">
                <label
                  className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500"
                  htmlFor="research-query"
                >
                  Search the web explicitly
                </label>
                <textarea
                  id="research-query"
                  className="mt-3 min-h-20 w-full resize-none bg-transparent text-sm leading-6 text-ink outline-none"
                  onChange={(event) => setResearchQuery(event.target.value)}
                  placeholder="Use this when the deck is not enough and you want external sources."
                  value={researchQuery}
                />
                <button
                  className="mt-3 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isResearching || !researchQuery.trim()}
                  onClick={runResearch}
                  type="button"
                >
                  {isResearching ? "Researching..." : "Run web research"}
                </button>
              </div>

              {researchResult ? (
                <div className="space-y-3">
                  <div className="rounded-[18px] bg-paper px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Summary
                    </p>
                    <p className="mt-2 font-body text-sm leading-6 text-slate-700">
                      {researchResult.summary}
                    </p>
                  </div>
                  <div className="max-h-[260px] space-y-3 overflow-auto">
                    {researchResult.results.map((result) => (
                      <div
                        className="rounded-[18px] bg-paper px-4 py-3"
                        key={result.url}
                      >
                        <p className="text-sm font-semibold text-ink">
                          {result.title}
                        </p>
                        <p className="mt-1 break-all text-xs text-slate-500">
                          {result.url}
                        </p>
                        <p className="mt-2 font-body text-sm leading-6 text-slate-700">
                          {result.snippet}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="font-body text-sm leading-6 text-slate-700">
                  External research is separate from deck-grounded teaching. Use
                  it explicitly when you want outside sources.
                </p>
              )}
            </div>
          </DebugPanel>

          <DebugPanel title="Deck JSON">
            <pre className="max-h-[360px] overflow-auto rounded-[18px] bg-slate-950 p-4 text-xs leading-5 text-emerald-300">
              {JSON.stringify(response?.deck ?? {}, null, 2)}
            </pre>
          </DebugPanel>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 className="text-2xl font-semibold text-ink">Generated slides</h2>
          <p className="text-sm text-slate-600">
            Internal deck JSON is the source of truth.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {slides.map((slide, index) => (
            <button
              className="min-w-0 text-left disabled:opacity-70"
              disabled={selectingSlideId === slide.id}
              key={slide.id}
              onClick={() => handleSelectSlide(index)}
              type="button"
            >
              <SlidePreviewCard
                isActive={index === currentSlideIndex}
                illustrationAsset={illustrationsBySlideId[slide.id]}
                slide={slide}
                slideNumber={index + 1}
                theme={deckTheme}
              />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
};
