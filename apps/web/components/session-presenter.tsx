"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type {
  Deck,
  NarrationProgressResponse,
  SelectSlideResponse,
  Session,
  SessionInteractionResponse as SessionInteractionPayload,
  SessionSnapshotResponse,
  SlideIllustrationAsset,
  SlideNarration,
  SpeechSynthesisResponse,
  TranscriptTurn,
  VoiceTurnResponse,
} from "@slidespeech/types";
import { PresenterControls, VisualSlideCanvas } from "@slidespeech/ui";

import {
  fetchSessionSnapshot,
  fetchSlideIllustration,
  fetchSlideNarration,
  getPresentationPptxExportUrl,
  interactWithSession,
  selectSlide,
  submitVoiceTurn,
  synthesizeSpeech,
  updateNarrationProgress,
} from "../lib/api";
import {
  createBrowserSpeechToTextProvider,
  type BrowserSpeechToTextProvider,
} from "../lib/browser-speech";

type InteractionEntry = {
  role: "user" | "assistant";
  text: string;
};

type PresenterState = {
  deck: Deck;
  session: Session;
  provider: string;
  transcripts: TranscriptTurn[];
  narrationsBySlideId: Record<string, SlideNarration>;
};

type PresenterUpdate =
  | SelectSlideResponse
  | NarrationProgressResponse
  | SpeechSynthesisResponse
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

const toInteractionLog = (
  transcripts: TranscriptTurn[],
): InteractionEntry[] =>
  transcripts
    .filter(
      (turn): turn is TranscriptTurn & { role: "user" | "assistant" } =>
        turn.role === "user" || turn.role === "assistant",
    )
    .map((turn) => ({
      role: turn.role,
      text: turn.text,
    }));

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

const fromSnapshot = (snapshot: SessionSnapshotResponse): PresenterState => ({
  deck: snapshot.deck,
  session: snapshot.session,
  provider: snapshot.provider,
  transcripts: snapshot.transcripts,
  narrationsBySlideId: {
    ...snapshot.session.narrationBySlideId,
    ...(snapshot.narration ? { [snapshot.narration.slideId]: snapshot.narration } : {}),
  },
});

const applyUpdate = (
  previous: PresenterState,
  next: PresenterUpdate,
): PresenterState => {
  const updatedNarrations = {
    ...previous.narrationsBySlideId,
    ...next.session.narrationBySlideId,
    ...(next.narration ? { [next.narration.slideId]: next.narration } : {}),
  };

  return {
    ...previous,
    deck: next.deck,
    session: {
      ...next.session,
      narrationBySlideId: updatedNarrations,
    },
    provider: next.provider,
    narrationsBySlideId: updatedNarrations,
  };
};

export const SessionPresenter = ({ sessionId }: { sessionId: string }) => {
  const [state, setState] = useState<PresenterState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commandInput, setCommandInput] = useState("");
  const [interactionLog, setInteractionLog] = useState<InteractionEntry[]>([]);
  const [narrationLoadingSlideId, setNarrationLoadingSlideId] = useState<string | null>(
    null,
  );
  const [illustrationLoadingSlideId, setIllustrationLoadingSlideId] = useState<
    string | null
  >(null);
  const [illustrationsBySlideId, setIllustrationsBySlideId] = useState<
    Record<string, SlideIllustrationAsset>
  >({});
  const [isUpdatingNarrationProgress, setIsUpdatingNarrationProgress] =
    useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [isSynthesizingSpeech, setIsSynthesizingSpeech] = useState(false);
  const [isPlayingSpeech, setIsPlayingSpeech] = useState(false);
  const [autoPlaySpeech, setAutoPlaySpeech] = useState(false);
  const [lastSpokenText, setLastSpokenText] = useState<string | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isListeningBrowserVoice, setIsListeningBrowserVoice] = useState(false);
  const [browserInterimTranscript, setBrowserInterimTranscript] = useState("");
  const [browserSpeechSupported, setBrowserSpeechSupported] = useState(false);
  const [isSubmittingVoice, setIsSubmittingVoice] = useState(false);
  const [liveVoiceMode, setLiveVoiceMode] = useState(false);
  const [lastVoiceTranscript, setLastVoiceTranscript] =
    useState<VoiceTranscriptSummary | null>(null);
  const [pendingUserTurn, setPendingUserTurn] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackSequenceRef = useRef(0);
  const illustrationPrefetchRef = useRef<Set<string>>(new Set());
  const narrationPrefetchRef = useRef<Set<string>>(new Set());
  const browserSpeechProviderRef = useRef<BrowserSpeechToTextProvider | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const liveVoiceModeRef = useRef(false);
  const voiceLoopRunningRef = useRef(false);
  const speechRequestVersionRef = useRef(0);

  useEffect(() => () => {
    playbackSequenceRef.current += 1;
    browserSpeechProviderRef.current?.stop();
    liveVoiceModeRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
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

  useEffect(() => {
    liveVoiceModeRef.current = liveVoiceMode;

    if (!liveVoiceMode) {
      browserSpeechProviderRef.current?.stop();
      setIsListeningBrowserVoice(false);
      setBrowserInterimTranscript("");
      voiceLoopRunningRef.current = false;
    }
  }, [liveVoiceMode]);

  useEffect(() => {
    let cancelled = false;

    startTransition(async () => {
      try {
        setError(null);
        const snapshot = await fetchSessionSnapshot(sessionId);
        if (cancelled) {
          return;
        }

        setIllustrationsBySlideId({});
        illustrationPrefetchRef.current.clear();
        narrationPrefetchRef.current.clear();
        setState(fromSnapshot(snapshot));
        setInteractionLog(toInteractionLog(snapshot.transcripts));
      } catch (loadError) {
        if (!cancelled) {
          setError((loadError as Error).message);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const slides = state?.deck.slides ?? [];
  const currentSlideIndex =
    slides.length === 0
      ? 0
      : Math.max(
          0,
          Math.min(state?.session.currentSlideIndex ?? 0, slides.length - 1),
        );
  const activeSlide = slides[currentSlideIndex];
  const narration = activeSlide ? state?.narrationsBySlideId[activeSlide.id] : undefined;
  const narrationSegments = useMemo(
    () => getNarrationSegments(narration, activeSlide?.beginnerExplanation),
    [activeSlide?.beginnerExplanation, narration],
  );
  const currentNarrationIndex = Math.max(
    0,
    Math.min(
      state?.session.currentNarrationIndex ?? 0,
      Math.max(narrationSegments.length - 1, 0),
    ),
  );
  const currentNarrationText =
    narrationSegments[currentNarrationIndex] ??
    narration?.narration ??
    activeSlide?.beginnerExplanation ??
    "";
  const activeIllustration = activeSlide
    ? illustrationsBySlideId[activeSlide.id]
    : undefined;
  const isPresenting =
    state?.session.state === "presenting" || state?.session.state === "resuming";
  const latestAssistantMessage =
    [...interactionLog].reverse().find((entry) => entry.role === "assistant")?.text ??
    null;

  useEffect(() => {
    if (
      !state ||
      !activeSlide ||
      narration ||
      narrationLoadingSlideId === activeSlide.id
    ) {
      return;
    }

    let cancelled = false;
    setNarrationLoadingSlideId(activeSlide.id);

    fetchSlideNarration(sessionId, activeSlide.id)
      .then((nextNarration) => {
        if (cancelled) {
          return;
        }

        setState((previous) =>
          previous
            ? {
                ...previous,
                session: {
                  ...previous.session,
                  narrationBySlideId: {
                    ...previous.session.narrationBySlideId,
                    [nextNarration.slideId]: nextNarration,
                  },
                },
                narrationsBySlideId: {
                  ...previous.narrationsBySlideId,
                  [nextNarration.slideId]: nextNarration,
                },
              }
            : previous,
        );
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
  }, [activeSlide, narration, narrationLoadingSlideId, sessionId, state]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const slidesNeedingNarration = state.deck.slides.filter(
      (slide) =>
        !state.narrationsBySlideId[slide.id] &&
        !narrationPrefetchRef.current.has(slide.id),
    );

    if (slidesNeedingNarration.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      for (const slide of slidesNeedingNarration.slice(0, 6)) {
        if (cancelled) {
          return;
        }

        narrationPrefetchRef.current.add(slide.id);

        try {
          const nextNarration = await fetchSlideNarration(sessionId, slide.id);

          if (cancelled) {
            return;
          }

          setState((previous) =>
            previous
              ? {
                  ...previous,
                  session: {
                    ...previous.session,
                    narrationBySlideId: {
                      ...previous.session.narrationBySlideId,
                      [nextNarration.slideId]: nextNarration,
                    },
                  },
                  narrationsBySlideId: {
                    ...previous.narrationsBySlideId,
                    [nextNarration.slideId]: nextNarration,
                  },
                }
              : previous,
          );
        } catch {
          // Keep narration preloading non-blocking for presenter mode.
        } finally {
          narrationPrefetchRef.current.delete(slide.id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, state]);

  useEffect(() => {
    if (
      !state ||
      !activeSlide ||
      illustrationsBySlideId[activeSlide.id] ||
      illustrationLoadingSlideId === activeSlide.id ||
      activeSlide.visuals.imageSlots.length === 0
    ) {
      return;
    }

    let cancelled = false;
    setIllustrationLoadingSlideId(activeSlide.id);

    fetchSlideIllustration(sessionId, activeSlide.id)
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
  }, [activeSlide, illustrationLoadingSlideId, illustrationsBySlideId, sessionId, state]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const slidesNeedingIllustrations = state.deck.slides.filter(
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
          const result = await fetchSlideIllustration(sessionId, slide.id);

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
          // Keep preview illustration loading non-blocking.
        } finally {
          illustrationPrefetchRef.current.delete(slide.id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [illustrationsBySlideId, sessionId, state]);

  const stopActiveAudio = () => {
    speechRequestVersionRef.current += 1;
    playbackSequenceRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    setIsPlayingSpeech(false);
  };

  const stopActiveMediaStream = () => {
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
    }

    mediaStreamRef.current = null;
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

  const applyInteractionResponse = async (
    result: SessionInteractionPayload | VoiceTurnResponse,
  ) => {
    setState((previous) => (previous ? applyUpdate(previous, result) : previous));

    const assistantMessage = result.assistantMessage?.trim();
    setPendingUserTurn(null);

    if (assistantMessage) {
      setInteractionLog((previous) => [
        ...previous,
        { role: "assistant", text: assistantMessage },
      ]);
    }

    if (assistantMessage && autoPlaySpeech) {
      await playSpeech({
        text: assistantMessage,
        style: "answer",
      });
    }
  };

  const handleBackendVoiceRecording = () => {
    if (isSubmittingVoice || !state) {
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

        if (
          typeof navigator === "undefined" ||
          !navigator.mediaDevices ||
          typeof navigator.mediaDevices.getUserMedia !== "function"
        ) {
          throw new Error(
            "Microphone recording is not available in this browser/context. Try Chrome or Edge, or check that microphone access is allowed.",
          );
        }

        if (typeof MediaRecorder === "undefined") {
          throw new Error(
            "This browser does not support in-browser audio recording for backend STT.",
          );
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
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

            const transcriptText = result.transcript?.text.trim();
            if (transcriptText) {
              setPendingUserTurn(transcriptText);
              setInteractionLog((previous) => [
                ...previous,
                { role: "user", text: transcriptText },
              ]);
            }

            if (result.interactionApplied) {
              await applyInteractionResponse(result);
            } else {
              setState((previous) => (previous ? applyUpdate(previous, result) : previous));
              setPendingUserTurn(null);
            }
          } catch (voiceError) {
            setError((voiceError as Error).message);
          } finally {
            stopActiveMediaStream();
            mediaRecorderRef.current = null;
            chunksRef.current = [];
            setIsSubmittingVoice(false);
            setIsRecordingVoice(false);
          }
        };

        recorder.start();
        setIsRecordingVoice(true);
      } catch (recordingError) {
        setError((recordingError as Error).message);
        stopActiveMediaStream();
        mediaRecorderRef.current = null;
        setIsRecordingVoice(false);
      }
    });
  };

  const handleBrowserVoiceInput = async () => {
    const provider = browserSpeechProviderRef.current;

    if (!provider || isSubmittingVoice) {
      return;
    }

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
          if (text.trim()) {
            stopActiveAudio();
          }
          setBrowserInterimTranscript(text);
        },
      });

      stopActiveAudio();

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

      if (!transcript.text.trim()) {
        return;
      }

      setPendingUserTurn(transcript.text);
      setInteractionLog((previous) => [
        ...previous,
        { role: "user", text: transcript.text },
      ]);
      setIsInteracting(true);
      const result = await interactWithSession(sessionId, transcript.text);
      await applyInteractionResponse(result);
    } catch (voiceError) {
      const message = (voiceError as Error).message;
      if (
        message !== "Voice input was stopped." &&
        message !== "No speech was recognized."
      ) {
        setError(message);
      }
    } finally {
      setIsInteracting(false);
      setIsListeningBrowserVoice(false);
      setBrowserInterimTranscript("");
      setIsSubmittingVoice(false);
    }
  };

  const runVoiceListenCycle = async () => {
    if (
      voiceLoopRunningRef.current ||
      !liveVoiceModeRef.current ||
      isSynthesizingSpeech ||
      isPlayingSpeech ||
      isSubmittingVoice ||
      isInteracting
    ) {
      return;
    }

    voiceLoopRunningRef.current = true;
    try {
      await handleBrowserVoiceInput();
    } finally {
      voiceLoopRunningRef.current = false;

      if (liveVoiceModeRef.current) {
        window.setTimeout(() => {
          void runVoiceListenCycle();
        }, 350);
      }
    }
  };

  useEffect(() => {
    if (!liveVoiceMode || !browserSpeechSupported) {
      return;
    }

    void runVoiceListenCycle();
  }, [
    browserSpeechSupported,
    isInteracting,
    isPlayingSpeech,
    isSubmittingVoice,
    isSynthesizingSpeech,
    liveVoiceMode,
  ]);

  const playSpeech = async (input: {
    text?: string;
    slideId?: string;
    narrationIndex?: number;
    style?: "narration" | "answer" | "summary";
    continueSequence?: boolean;
    advanceSlides?: boolean;
  }) => {
    try {
      setError(null);
      setIsSynthesizingSpeech(true);
      const speechRequestVersion = speechRequestVersionRef.current;
      const result = await synthesizeSpeech(sessionId, input);

      if (speechRequestVersion !== speechRequestVersionRef.current) {
        return;
      }

      setState((previous) => (previous ? applyUpdate(previous, result) : previous));
      stopActiveAudio();
      const playbackSequenceId = playbackSequenceRef.current + 1;
      playbackSequenceRef.current = playbackSequenceId;

      const audio = new Audio(
        `data:${result.audio.mimeType};base64,${result.audio.audioBase64}`,
      );

      audio.onended = async () => {
        setIsPlayingSpeech(false);
        audioRef.current = null;

        if (
          !input.continueSequence ||
          result.source.type !== "narration_segment" ||
          playbackSequenceRef.current !== playbackSequenceId
        ) {
          return;
        }

        const narrationSegments = result.narration?.segments ?? [];
        const currentIndex = result.source.narrationIndex ?? 0;
        const sourceSlideId = result.source.slideId;

        if (!sourceSlideId) {
          return;
        }

        if (currentIndex < Math.max(narrationSegments.length - 1, 0)) {
          const nextIndex = currentIndex + 1;

          try {
            const progressResult = await updateNarrationProgress(sessionId, {
              slideId: sourceSlideId,
              narrationIndex: nextIndex,
            });
            setState((previous) =>
              previous ? applyUpdate(previous, progressResult) : previous,
            );

            await playSpeech({
              slideId: sourceSlideId,
              narrationIndex: nextIndex,
              style: "narration",
              continueSequence: true,
              ...(input.advanceSlides !== undefined
                ? { advanceSlides: input.advanceSlides }
                : {}),
            });
          } catch (playbackError) {
            setError((playbackError as Error).message);
          }

          return;
        }

        if (!input.advanceSlides) {
          return;
        }

        const currentSlidePosition = result.deck.slides.findIndex(
          (slide) => slide.id === sourceSlideId,
        );
        const nextSlide =
          currentSlidePosition >= 0
            ? result.deck.slides[currentSlidePosition + 1]
            : undefined;

        if (!nextSlide) {
          playbackSequenceRef.current += 1;
          setIsPlayingSpeech(false);
          return;
        }

        try {
          const selectionResult = await selectSlide(sessionId, nextSlide.id);
          setState((previous) =>
            previous ? applyUpdate(previous, selectionResult) : previous,
          );

          await playSpeech({
            slideId: nextSlide.id,
            narrationIndex: 0,
            style: "narration",
            continueSequence: true,
            advanceSlides: true,
          });
        } catch (playbackError) {
          setError((playbackError as Error).message);
        }
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

  const handleSelectSlide = (slideIndex: number) => {
    const targetSlide = slides[slideIndex];

    if (!targetSlide) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        const result = await selectSlide(sessionId, targetSlide.id);
        setState((previous) => (previous ? applyUpdate(previous, result) : previous));
      } catch (selectionError) {
        setError((selectionError as Error).message);
      }
    });
  };

  const handleNarrationStep = (nextNarrationIndex: number) => {
    if (!activeSlide || narrationSegments.length === 0) {
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
        setState((previous) => (previous ? applyUpdate(previous, result) : previous));

        if (autoPlaySpeech) {
          await playSpeech({
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

  const sendInteraction = () => {
    if (!commandInput.trim()) {
      return;
    }

    const userText = commandInput.trim();

    startTransition(async () => {
      try {
        setError(null);
        setIsInteracting(true);
        stopActiveAudio();
        setPendingUserTurn(userText);
        setInteractionLog((previous) => [
          ...previous,
          { role: "user", text: userText },
        ]);
        const result = await interactWithSession(sessionId, userText);
        setState((previous) => (previous ? applyUpdate(previous, result) : previous));
        const assistantMessage = result.assistantMessage?.trim();
        if (assistantMessage) {
          setInteractionLog((previous) => [
            ...previous,
            { role: "assistant", text: assistantMessage },
          ]);
        }
        setPendingUserTurn(null);
        setCommandInput("");

        if (assistantMessage && autoPlaySpeech) {
          await playSpeech({
            text: assistantMessage,
            style: "answer",
          });
        }
      } catch (interactionError) {
        setError((interactionError as Error).message);
      } finally {
        setPendingUserTurn(null);
        setIsInteracting(false);
      }
    });
  };

  const togglePresenting = () => {
    startTransition(async () => {
      try {
        setError(null);
        stopActiveAudio();
        const result = await interactWithSession(
          sessionId,
          isPresenting ? "stop" : "continue",
        );
        setState((previous) => (previous ? applyUpdate(previous, result) : previous));
        if (result.assistantMessage?.trim()) {
          setInteractionLog((previous) => [
            ...previous,
            { role: "assistant", text: result.assistantMessage },
          ]);
        }
      } catch (interactionError) {
        setError((interactionError as Error).message);
      }
    });
  };

  if (!state && !error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink px-6 py-10 text-paper">
        <div className="rounded-[28px] border border-white/10 bg-white/5 px-6 py-5 text-center shadow-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/60">
            Presenter mode
          </p>
          <p className="mt-3 text-lg font-semibold">Loading session...</p>
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink px-6 py-10 text-paper">
        <div className="max-w-xl rounded-[28px] border border-red-400/20 bg-red-500/10 px-6 py-5">
          <p className="text-lg font-semibold">Presenter mode failed to load.</p>
          <p className="mt-3 text-sm leading-6 text-paper/80">{error}</p>
          <Link
            className="mt-4 inline-flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink"
            href="/workbench"
          >
            Back to workbench
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-ink px-4 py-5 text-paper md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 rounded-[30px] border border-white/10 bg-white/5 p-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-paper/55">
              Presenter mode
            </p>
            <h1 className="mt-2 text-2xl font-semibold md:text-3xl">{state.deck.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-paper/70">
              {state.deck.summary}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-paper transition hover:border-white/40"
              href="/workbench"
            >
              Open workbench
            </Link>
            <a
              className="rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95"
              href={getPresentationPptxExportUrl(sessionId)}
            >
              Download PPTX
            </a>
          </div>
        </div>

        {error ? (
          <div className="mb-5 rounded-[20px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {activeSlide ? (
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_360px]">
            <div className="rounded-[32px] bg-white p-4 text-ink shadow-2xl md:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Slide {currentSlideIndex + 1} of {slides.length}
                  </p>
                  <h2 className="mt-2 text-3xl font-semibold md:text-4xl">
                    {activeSlide.title}
                  </h2>
                  <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
                    {activeSlide.learningGoal}
                  </p>
                </div>
                <div className="rounded-[22px] bg-slate-100 px-4 py-3 text-sm text-slate-700">
                  <p>
                    Narration point {currentNarrationIndex + 1} /{" "}
                    {Math.max(narrationSegments.length, 1)}
                  </p>
                  <p className="mt-1">Provider: {state.provider}</p>
                </div>
              </div>

              <div className="mt-5 rounded-[28px] border border-slate-200 bg-slate-50 p-3 md:p-5">
                <VisualSlideCanvas
                  slide={activeSlide}
                  illustrationAsset={activeIllustration}
                />
                {illustrationLoadingSlideId === activeSlide.id ? (
                  <p className="mt-3 text-sm text-slate-500">Resolving slide illustration...</p>
                ) : null}
              </div>

              <div className="mt-6 rounded-[26px] bg-ink px-5 py-5 text-paper">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/55">
                  Current narration
                </p>
                <p className="mt-3 text-lg leading-8">
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
                            : "border-white/10 bg-white/5 text-paper/70"
                        }`}
                        key={`${activeSlide.id}-${index}`}
                      >
                        <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-paper/50">
                          {index + 1}
                        </span>
                        {segment}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <aside className="space-y-5">
              <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/55">
                  Controls
                </p>
                <div className="mt-4 rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-paper/75">
                  <p>
                    Session:{" "}
                    <span className="font-semibold text-paper">{state.session.state}</span>
                  </p>
                  <p className="mt-1">
                    Speech:{" "}
                    <span className="font-semibold text-paper">
                      {isPlayingSpeech
                        ? "playing"
                        : isSynthesizingSpeech
                          ? "synthesizing"
                          : "idle"}
                    </span>
                  </p>
                  <p className="mt-1">
                    Response:{" "}
                    <span className="font-semibold text-paper">
                      {isListeningBrowserVoice || isRecordingVoice
                        ? "listening"
                        : isSubmittingVoice && !pendingUserTurn
                          ? "processing voice"
                          : isInteracting
                            ? "generating answer"
                            : isSynthesizingSpeech
                              ? "generating speech"
                              : isPlayingSpeech
                                ? "speaking"
                                : "idle"}
                    </span>
                  </p>
                </div>
                <div className="mt-4">
                  <PresenterControls
                    canGoBack={currentSlideIndex > 0}
                    canGoForward={currentSlideIndex < slides.length - 1}
                    isPresenting={isPresenting}
                    onBack={() => handleSelectSlide(Math.max(currentSlideIndex - 1, 0))}
                    onForward={() =>
                      handleSelectSlide(Math.min(currentSlideIndex + 1, slides.length - 1))
                    }
                    onTogglePresenting={togglePresenting}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="rounded-full border border-white/20 px-3 py-1.5 text-sm transition hover:border-white/40 disabled:opacity-50"
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
                    className="rounded-full border border-white/20 px-3 py-1.5 text-sm transition hover:border-white/40 disabled:opacity-50"
                    disabled={
                      narrationSegments.length <= 1 ||
                      currentNarrationIndex >= narrationSegments.length - 1 ||
                      isUpdatingNarrationProgress
                    }
                    onClick={() =>
                      handleNarrationStep(
                        Math.min(currentNarrationIndex + 1, narrationSegments.length - 1),
                      )
                    }
                    type="button"
                  >
                    {isUpdatingNarrationProgress ? "Updating..." : "Next point"}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
                    disabled={
                      !activeSlide ||
                      narrationLoadingSlideId === activeSlide.id ||
                      isSynthesizingSpeech
                    }
                    onClick={() =>
                      void playSpeech({
                        slideId: activeSlide.id,
                        narrationIndex: currentNarrationIndex,
                        style: "narration",
                        continueSequence: true,
                        advanceSlides: autoPlaySpeech,
                      })
                    }
                    type="button"
                  >
                    {isSynthesizingSpeech ? "Synthesizing..." : "Play from current point"}
                  </button>
                  <button
                    className="rounded-full border border-white/20 px-4 py-2 text-sm transition hover:border-white/40 disabled:opacity-50"
                    disabled={!isPlayingSpeech}
                    onClick={stopActiveAudio}
                    type="button"
                  >
                    Stop audio
                  </button>
                  <button
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      autoPlaySpeech
                        ? "bg-white text-ink"
                        : "border border-white/20 text-paper hover:border-white/40"
                    }`}
                    onClick={() => setAutoPlaySpeech((previous) => !previous)}
                    type="button"
                  >
                    {autoPlaySpeech ? "Auto-play on" : "Auto-play off"}
                  </button>
                </div>
                {lastSpokenText ? (
                  <p className="mt-3 text-sm leading-6 text-paper/65">
                    Last spoken: {lastSpokenText}
                  </p>
                ) : null}
              </section>

              <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/55">
                  Ask naturally
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      liveVoiceMode
                        ? "bg-coral text-white"
                        : "border border-white/20 text-paper hover:border-white/40"
                    }`}
                    disabled={!browserSpeechSupported}
                    onClick={() => setLiveVoiceMode((previous) => !previous)}
                    type="button"
                  >
                    {liveVoiceMode ? "Live voice on" : "Live voice off"}
                  </button>
                  <button
                    className="rounded-full border border-white/20 px-4 py-2 text-sm transition hover:border-white/40 disabled:opacity-50"
                    disabled={isSubmittingVoice}
                    onClick={() => {
                      handleBackendVoiceRecording();
                    }}
                    type="button"
                  >
                    {isRecordingVoice
                      ? "Stop recording"
                      : isSubmittingVoice
                        ? "Processing..."
                        : "Record question"}
                  </button>
                </div>
                <p className="mt-3 text-sm leading-6 text-paper/60">
                  {browserSpeechSupported
                    ? liveVoiceMode
                      ? "Browser speech recognition is armed for live interruption testing. One-shot questions use backend STT."
                      : "Record question uses backend STT. Live voice remains available for interruption-style browser testing."
                    : "Browser speech recognition is not available here. Record question uses backend server-side STT."}
                </p>
                <div className="mt-3 rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm text-paper/75">
                  <p>
                    Voice state:{" "}
                    <span className="font-semibold text-paper">
                      {isSubmittingVoice
                        ? "processing"
                        : isRecordingVoice
                          ? "recording"
                        : isListeningBrowserVoice
                          ? "listening"
                          : liveVoiceMode
                            ? "armed"
                            : "idle"}
                    </span>
                  </p>
                </div>
                {pendingUserTurn ? (
                  <div className="mt-3 rounded-[18px] border border-sky-300/20 bg-sky-400/10 px-4 py-3 text-sm leading-6 text-paper">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/60">
                      Generating answer for
                    </p>
                    <p className="mt-2">{pendingUserTurn}</p>
                  </div>
                ) : null}
                {browserInterimTranscript ? (
                  <div className="mt-3 rounded-[18px] border border-coral/30 bg-coral/10 px-4 py-3 text-sm leading-6 text-paper">
                    Hearing: {browserInterimTranscript}
                  </div>
                ) : null}
                {lastVoiceTranscript ? (
                  <div className="mt-3 rounded-[18px] border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-paper/80">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/50">
                      Last voice input
                    </p>
                    <p className="mt-2">
                      {lastVoiceTranscript.transcriptAvailable
                        ? lastVoiceTranscript.text
                        : lastVoiceTranscript.hadSpeech
                          ? "Speech was detected, but no transcript was produced."
                          : "No speech detected."}
                    </p>
                    <p className="mt-2 text-xs text-paper/50">
                      Source: {lastVoiceTranscript.source} / {lastVoiceTranscript.provider}
                    </p>
                  </div>
                ) : null}
                {isInteracting ? (
                  <div className="mt-3 rounded-[18px] border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-paper">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-paper/20 border-t-paper" />
                      <span>Generating answer...</span>
                    </div>
                  </div>
                ) : null}
                <textarea
                  className="mt-4 min-h-28 w-full rounded-[22px] border border-white/10 bg-white/5 px-4 py-3 text-sm leading-6 text-paper outline-none placeholder:text-paper/35"
                  onChange={(event) => setCommandInput(event.target.value)}
                  placeholder="Ask a question, ask for a simpler explanation, ask for an example, or continue the conversation."
                  value={commandInput}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:opacity-90 disabled:opacity-50"
                    disabled={!commandInput.trim() || isInteracting || isPending}
                    onClick={sendInteraction}
                    type="button"
                  >
                    {isInteracting ? "Sending..." : "Send"}
                  </button>
                </div>
                {latestAssistantMessage ? (
                  <div className="mt-4 rounded-[22px] bg-white/5 px-4 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/55">
                      Latest assistant answer
                    </p>
                    <p className="mt-2 text-sm leading-6 text-paper/85">
                      {latestAssistantMessage}
                    </p>
                    <button
                      className="mt-3 rounded-full border border-white/20 px-3 py-1.5 text-sm transition hover:border-white/40 disabled:opacity-50"
                      disabled={isSynthesizingSpeech}
                      onClick={() =>
                        void playSpeech({
                          text: latestAssistantMessage,
                          style: "answer",
                        })
                      }
                      type="button"
                    >
                      Speak last answer
                    </button>
                  </div>
                ) : null}
              </section>

              <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/55">
                  Grounding
                </p>
                <p className="mt-3 text-sm leading-6 text-paper/70">
                  Source type: {state.deck.source.type}
                </p>
                <div className="mt-3 space-y-2">
                  {state.deck.source.sourceIds.length > 0 ? (
                    state.deck.source.sourceIds.map((sourceUrl) => (
                      <a
                        className="block break-all text-sm text-coral underline-offset-2 hover:underline"
                        href={sourceUrl}
                        key={sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {sourceUrl}
                      </a>
                    ))
                  ) : (
                    <p className="text-sm leading-6 text-paper/60">
                      No external sources were attached to this session.
                    </p>
                  )}
                </div>
              </section>
            </aside>
          </section>
        ) : null}

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Slides</h3>
            <p className="text-sm text-paper/55">Choose any slide in the current deck.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {slides.map((slide, index) => (
              <button
                className="text-left"
                key={slide.id}
                onClick={() => handleSelectSlide(index)}
                type="button"
              >
                <div
                  className={`overflow-hidden rounded-[24px] border p-2 transition ${
                    index === currentSlideIndex
                      ? "border-coral bg-white/10"
                      : "border-white/10 bg-white/5 hover:border-white/25"
                  }`}
                >
                  <VisualSlideCanvas
                    slide={slide}
                    dark
                    illustrationAsset={illustrationsBySlideId[slide.id]}
                  />
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
};
