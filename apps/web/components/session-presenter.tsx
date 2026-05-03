"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type {
  SessionInteractionResponse as SessionInteractionPayload,
  SlideIllustrationAsset,
  SlideNarration,
  SpeechSynthesisResponse,
  VoiceTurnResponse,
} from "@slidespeech/types";
import { resolvePresentationTheme } from "@slidespeech/types";
import { VisualSlideCanvas } from "@slidespeech/ui";

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
import {
  assessVoiceQuestionTranscript,
  getSpeechRecognitionLanguage,
  type VoiceQuestionSource,
} from "../lib/question-flow";
import { ActiveSlideStage } from "./active-slide-stage";
import { AskNaturallyPanel } from "./ask-naturally-panel";
import { GroundingPanel } from "./grounding-panel";
import { PresenterControlsPanel } from "./presenter-controls-panel";
import { PresenterHeader } from "./presenter-header";
import { QuestionFlowOverlay } from "./question-flow-overlay";
import {
  applyUpdate,
  fromSnapshot,
  getBackendVoiceRecordingSupport,
  getNarrationSegments,
  toInteractionLog,
  type AnswerReadyNotice,
  type BackendVoiceRecordingSupport,
  type InteractionEntry,
  type PresenterState,
  type QuestionFlowSource,
  type QuestionFlowStage,
  type QuestionFlowState,
  type VoiceTranscriptSummary,
} from "./session-presenter-state";
import { SlideOverview } from "./slide-overview";
import { WorkingOverlay } from "./working-overlay";

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
  const [lastSpokenText, setLastSpokenText] = useState<string | null>(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isListeningBrowserVoice, setIsListeningBrowserVoice] = useState(false);
  const [browserSpeechSupported, setBrowserSpeechSupported] = useState(false);
  const [backendVoiceRecordingSupport, setBackendVoiceRecordingSupport] =
    useState<BackendVoiceRecordingSupport>({
      available: false,
      reason: null,
    });
  const [isSubmittingVoice, setIsSubmittingVoice] = useState(false);
  const [liveVoiceMode, setLiveVoiceMode] = useState(false);
  const [lastVoiceTranscript, setLastVoiceTranscript] =
    useState<VoiceTranscriptSummary | null>(null);
  const [pendingUserTurn, setPendingUserTurn] = useState<string | null>(null);
  const [pendingPresentationStart, setPendingPresentationStart] = useState(false);
  const [showBlockingOverlay, setShowBlockingOverlay] = useState(false);
  const [latestAnswerNotice, setLatestAnswerNotice] =
    useState<AnswerReadyNotice | null>(null);
  const [questionFlow, setQuestionFlow] = useState<QuestionFlowState | null>(null);
  const [isPending, startTransition] = useTransition();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackSequenceRef = useRef(0);
  const illustrationPrefetchRef = useRef<Set<string>>(new Set());
  const narrationPrefetchRef = useRef<Set<string>>(new Set());
  const narrationRequestsRef = useRef<Map<string, Promise<SlideNarration>>>(new Map());
  const browserSpeechProviderRef = useRef<BrowserSpeechToTextProvider | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const liveVoiceModeRef = useRef(false);
  const voiceLoopRunningRef = useRef(false);
  const speechRequestVersionRef = useRef(0);
  const questionRequestVersionRef = useRef(0);
  const answerSpeechCacheRef = useRef<
    Map<string, Promise<SpeechSynthesisResponse> | SpeechSynthesisResponse>
  >(new Map());

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
    answerSpeechCacheRef.current.clear();
  }, [sessionId]);

  useEffect(() => {
    const provider = createBrowserSpeechToTextProvider();
    browserSpeechProviderRef.current = provider;
    setBrowserSpeechSupported(provider !== null);
    setBackendVoiceRecordingSupport(getBackendVoiceRecordingSupport());

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
  const deckTheme = state
    ? resolvePresentationTheme(
        state.deck.metadata.theme,
        `${state.deck.id}:${state.deck.topic}`,
      )
    : undefined;
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
    () => getNarrationSegments(narration, undefined),
    [narration],
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
    "";
  const currentNarrationDisplayText =
    narrationLoadingSlideId === activeSlide?.id
      ? "Generating narration for this slide..."
      : narration
        ? currentNarrationText
        : "Narration is being prepared for this slide.";
  const activeIllustration = activeSlide
    ? illustrationsBySlideId[activeSlide.id]
    : undefined;
  const activeSlideCanvas = useMemo(
    () =>
      activeSlide ? (
        <VisualSlideCanvas
          slide={activeSlide}
          illustrationAsset={activeIllustration}
          theme={deckTheme}
        />
      ) : null,
    [activeIllustration, activeSlide, deckTheme],
  );
  const isPresenting =
    state?.session.state === "presenting" || state?.session.state === "resuming";
  const narrationAutoPlay = true;
  const autoResumeBridge =
    "Now I will continue where I left off in the presentation.";
  const narrationReadySlideCount = slides.filter(
    (slide) => Boolean(state?.narrationsBySlideId[slide.id]),
  ).length;
  const missingNarrationCount = Math.max(slides.length - narrationReadySlideCount, 0);
  const isDeckNarrationReady = slides.length > 0 && missingNarrationCount === 0;
  const activeSlideNarrationReady = Boolean(activeSlide && narration);
  const isWaitingForNarrationDuringPlayback =
    isPresenting && isSynthesizingSpeech && !isPlayingSpeech;
  const backendVoiceRecordingAvailable = backendVoiceRecordingSupport.available;
  const recordQuestionUsesBrowserFallback =
    !backendVoiceRecordingAvailable && browserSpeechSupported;
  const recordQuestionUnavailable =
    !backendVoiceRecordingAvailable && !browserSpeechSupported;
  const isBuildingAnswer =
    Boolean(pendingUserTurn) ||
    isInteracting ||
    (isSubmittingVoice && !isRecordingVoice);
  const isGeneratingNarrationAudio =
    !isBuildingAnswer && isSynthesizingSpeech && !isPlayingSpeech;
  const rawBlockingPresenterWork =
    pendingPresentationStart || isWaitingForNarrationDuringPlayback;
  const latestAssistantMessage =
    [...interactionLog].reverse().find((entry) => entry.role === "assistant")?.text ??
    null;
  const workingOverlayTitle = isBuildingAnswer
    ? "Generating answer"
    : pendingPresentationStart
      ? "Preparing presenter mode"
      : isGeneratingNarrationAudio
        ? "Generating voice"
        : "Generating content";
  const workingOverlayMessage = isBuildingAnswer
    ? pendingUserTurn
      ? `Generating a spoken answer to “${pendingUserTurn}”.`
      : isSubmittingVoice && !isRecordingVoice
        ? "Transcribing your question and generating the answer."
        : "Generating the next spoken answer for the presentation."
    : pendingPresentationStart
      ? activeSlide
        ? activeSlideNarrationReady
          ? `The first spoken point for “${activeSlide.title}” is ready. Starting playback now.`
          : `Preparing the first spoken point for “${activeSlide.title}”. ${narrationReadySlideCount} of ${slides.length} slide narrations are already cached; the rest continues in the background.`
        : "Preparing the first spoken point before presentation starts."
      : isGeneratingNarrationAudio
        ? activeSlide
          ? `Rendering spoken audio for “${activeSlide.title}”. Playback starts automatically when the voice clip is ready.`
          : "Rendering spoken audio for the presentation. Playback starts automatically when the voice clip is ready."
        : activeSlide
          ? `Generating the next spoken segment for “${activeSlide.title}”.`
          : "Generating the next spoken segment for the presentation.";
  const presentButtonLabel = pendingPresentationStart
    ? "Preparing..."
    : isGeneratingNarrationAudio
      ? "Generating voice..."
      : isPresenting
        ? "Pause"
        : "Present";

  const createQuestionRequest = (
    input: Omit<QuestionFlowState, "requestId">,
  ): number => {
    const requestId = questionRequestVersionRef.current + 1;
    questionRequestVersionRef.current = requestId;
    setQuestionFlow({
      requestId,
      ...input,
    });
    return requestId;
  };

  const isCurrentQuestionRequest = (requestId: number): boolean =>
    questionRequestVersionRef.current === requestId;

  const updateQuestionFlow = (
    requestId: number,
    next:
      | Partial<Omit<QuestionFlowState, "requestId">>
      | ((current: QuestionFlowState) => Partial<Omit<QuestionFlowState, "requestId">>),
  ) => {
    setQuestionFlow((current) => {
      if (!current || current.requestId !== requestId) {
        return current;
      }

      const partial = typeof next === "function" ? next(current) : next;
      return {
        ...current,
        ...partial,
      };
    });
  };

  const clearQuestionFlow = (requestId?: number) => {
    setQuestionFlow((current) => {
      if (!current) {
        return current;
      }

      if (requestId !== undefined && current.requestId !== requestId) {
        return current;
      }

      return null;
    });
  };

  const mergeNarrationIntoState = (nextNarration: SlideNarration) => {
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
  };

  const loadNarration = async (
    slideId: string,
    options?: {
      foreground?: boolean;
      suppressError?: boolean;
    },
  ): Promise<SlideNarration> => {
    const existingNarration = state?.narrationsBySlideId[slideId];

    if (existingNarration) {
      return existingNarration;
    }

    const inFlightRequest = narrationRequestsRef.current.get(slideId);

    if (inFlightRequest) {
      return await inFlightRequest;
    }

    if (options?.foreground) {
      setNarrationLoadingSlideId(slideId);
    }

    const request = fetchSlideNarration(sessionId, slideId)
      .then((nextNarration) => {
        mergeNarrationIntoState(nextNarration);
        return nextNarration;
      })
      .catch((loadError) => {
        if (!options?.suppressError) {
          setError((loadError as Error).message);
        }

        throw loadError;
      })
      .finally(() => {
        narrationRequestsRef.current.delete(slideId);

        if (options?.foreground) {
          setNarrationLoadingSlideId((current) =>
            current === slideId ? null : current,
          );
        }
      });

    narrationRequestsRef.current.set(slideId, request);
    return await request;
  };

  const buildAnswerSpeechCacheKey = (text: string): string =>
    `${state?.session.pedagogicalProfile.pace ?? "balanced"}::${text.trim()}`;

  const prefetchAnswerSpeech = async (
    text: string,
  ): Promise<SpeechSynthesisResponse> => {
    const trimmedText = text.trim();
    const cacheKey = buildAnswerSpeechCacheKey(trimmedText);
    const cached = answerSpeechCacheRef.current.get(cacheKey);

    if (cached) {
      return await Promise.resolve(cached);
    }

    const request = synthesizeSpeech(sessionId, {
      text: trimmedText,
      style: "answer",
    })
      .then((result) => {
        answerSpeechCacheRef.current.set(cacheKey, result);
        return result;
      })
      .catch((error) => {
        if (answerSpeechCacheRef.current.get(cacheKey) === request) {
          answerSpeechCacheRef.current.delete(cacheKey);
        }
        throw error;
      });

    answerSpeechCacheRef.current.set(cacheKey, request);
    return await request;
  };

  useEffect(() => {
    if (!latestAssistantMessage?.trim()) {
      return;
    }

    void prefetchAnswerSpeech(latestAssistantMessage).catch(() => {
      // Best-effort prewarm only.
    });
  }, [latestAssistantMessage, sessionId, state?.session.pedagogicalProfile.pace]);

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

    void loadNarration(activeSlide.id, { foreground: true, suppressError: false }).catch(
      () => {
        if (cancelled) {
          return;
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [activeSlide, narration, narrationLoadingSlideId, sessionId, state]);

  useEffect(() => {
    if (
      !state ||
      pendingPresentationStart ||
      isPlayingSpeech ||
      isSynthesizingSpeech
    ) {
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
          await loadNarration(slide.id, { suppressError: true });
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
  }, [
    isPlayingSpeech,
    isSynthesizingSpeech,
    pendingPresentationStart,
    sessionId,
    state,
  ]);

  useEffect(() => {
    if (!pendingPresentationStart || !activeSlide || activeSlideNarrationReady) {
      return;
    }

    let cancelled = false;

    void loadNarration(activeSlide.id, {
      foreground: true,
      suppressError: true,
    }).catch((loadError) => {
      if (cancelled) {
        return;
      }

      setError((loadError as Error).message);
      setPendingPresentationStart(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeSlide?.id,
    activeSlideNarrationReady,
    pendingPresentationStart,
    sessionId,
  ]);

  useEffect(() => {
    if (!rawBlockingPresenterWork) {
      setShowBlockingOverlay(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
        setShowBlockingOverlay(true);
    }, isBuildingAnswer ? 120 : 650);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isBuildingAnswer, rawBlockingPresenterWork]);

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

  const pauseForVoiceInterruption = () => {
    stopActiveAudio();
    setLastSpokenText(null);
    setPendingPresentationStart(false);
    setState((previous) => {
      if (!previous) {
        return previous;
      }

      if (
        previous.session.state !== "presenting" &&
        previous.session.state !== "resuming"
      ) {
        return previous;
      }

      return {
        ...previous,
        session: {
          ...previous.session,
          state: "slide_paused",
        },
      };
    });
  };

  const disarmLiveVoiceMode = () => {
    liveVoiceModeRef.current = false;
    browserSpeechProviderRef.current?.stop();
    setLiveVoiceMode(false);
    setIsListeningBrowserVoice(false);
    voiceLoopRunningRef.current = false;
  };

  const stopActiveMediaStream = () => {
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
    }

    mediaStreamRef.current = null;
  };

  const cancelQuestionFlow = () => {
    questionRequestVersionRef.current += 1;
    browserSpeechProviderRef.current?.stop();
    setIsListeningBrowserVoice(false);

    if (mediaRecorderRef.current && isRecordingVoice) {
      mediaRecorderRef.current.stop();
    }

    stopActiveMediaStream();
    setIsRecordingVoice(false);
    setIsSubmittingVoice(false);
    setIsInteracting(false);
    setPendingUserTurn(null);
    setQuestionFlow(null);
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

  const isAnswerLikeResponse = (
    result: SessionInteractionPayload | VoiceTurnResponse,
  ): boolean => {
    const interruptionType = result.interruption?.type;
    const responseMode = result.turnDecision?.responseMode;

    return (
      (interruptionType !== undefined &&
        ["question", "simplify", "deepen", "example", "repeat"].includes(
          interruptionType,
        )) ||
      (responseMode !== undefined &&
        [
          "question",
          "summarize_current_slide",
          "general_contextual",
          "grounded_factual",
          "simplify",
          "deepen",
          "example",
          "repeat",
        ].includes(responseMode))
    );
  };

  const submitQuestionText = async (input: {
    requestId: number;
    userText: string;
    source: QuestionFlowSource;
    wasPresenting: boolean;
  }) => {
    const trimmedText = input.userText.trim();

    if (!trimmedText || !isCurrentQuestionRequest(input.requestId)) {
      return;
    }

    setLatestAnswerNotice(null);
    setPendingUserTurn(trimmedText);
    updateQuestionFlow(input.requestId, {
      stage: "generating_answer",
      promptText: trimmedText,
      transcriptText: trimmedText,
      interimTranscript: "",
      warning: null,
      note:
        input.source === "typed"
          ? "Generating an answer to your question."
          : "Transcript accepted. Generating an answer now.",
    });
    setInteractionLog((previous) => [
      ...previous,
      { role: "user", text: trimmedText },
    ]);
    setIsInteracting(true);

    try {
      const result = await interactWithSession(sessionId, trimmedText);

      if (!isCurrentQuestionRequest(input.requestId)) {
        return;
      }

      await applyInteractionResponse(result, {
        userText: trimmedText,
        wasPresenting: input.wasPresenting,
        questionRequestId: input.requestId,
      });
    } catch (interactionError) {
      if (!isCurrentQuestionRequest(input.requestId)) {
        return;
      }

      clearQuestionFlow(input.requestId);
      setError((interactionError as Error).message);
    } finally {
      if (!isCurrentQuestionRequest(input.requestId)) {
        return;
      }

      setPendingUserTurn(null);
      setIsInteracting(false);
    }
  };

  const applyInteractionResponse = async (
    result: SessionInteractionPayload | VoiceTurnResponse,
    options?: {
      userText?: string;
      wasPresenting?: boolean;
      questionRequestId?: number;
    },
  ) => {
    setState((previous) => (previous ? applyUpdate(previous, result) : previous));

    const assistantMessage = result.assistantMessage?.trim();
    const answerLikeResponse = isAnswerLikeResponse(result);
    setPendingUserTurn(null);

    if (assistantMessage) {
      setInteractionLog((previous) => [
        ...previous,
        { role: "assistant", text: assistantMessage },
      ]);
    }

    if (assistantMessage && answerLikeResponse) {
      setLatestAnswerNotice({
        question: options?.userText?.trim() || null,
        answer: assistantMessage,
      });
    }

    if (!assistantMessage || !answerLikeResponse) {
      if (options?.questionRequestId !== undefined) {
        clearQuestionFlow(options.questionRequestId);
      }
      return;
    }

    if (!shouldAutoResumeAfterAnswer(result, options?.wasPresenting === true)) {
      await playSpeech({
        text: assistantMessage,
        style: "answer",
        ...(options?.questionRequestId !== undefined
          ? { questionRequestId: options.questionRequestId }
          : {}),
      });
      return;
    }

    const resumeSlideId = result.session.currentSlideId;
    const resumeNarrationIndex = result.session.currentNarrationIndex;

    await playSpeech({
      text: `${assistantMessage} ${autoResumeBridge}`,
      style: "answer",
      ...(options?.questionRequestId !== undefined
        ? { questionRequestId: options.questionRequestId }
        : {}),
      onEnded: async () => {
        try {
          if (!resumeSlideId) {
            return;
          }

          await playSpeech({
            slideId: resumeSlideId,
            narrationIndex: resumeNarrationIndex,
            style: "narration",
            continueSequence: true,
            advanceSlides: narrationAutoPlay,
          });
        } catch (resumeError) {
          setError((resumeError as Error).message);
        }
      },
    });
  };

  const shouldAutoResumeAfterAnswer = (
    result: SessionInteractionPayload | VoiceTurnResponse,
    wasPresenting: boolean,
  ): boolean => {
    if (!wasPresenting) {
      return false;
    }

    const interruptionType = result.interruption?.type;
    const responseMode = result.turnDecision?.responseMode;

    return (
      interruptionType !== undefined &&
      ["question", "simplify", "deepen", "example", "repeat"].includes(
        interruptionType,
      ) &&
      (responseMode === undefined ||
        [
          "question",
          "summarize_current_slide",
          "general_contextual",
          "grounded_factual",
          "simplify",
          "deepen",
          "example",
          "repeat",
        ].includes(responseMode))
    );
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
        const wasPresenting = isPresenting;
        const requestId = createQuestionRequest({
          source: "record",
          stage: "listening",
          promptText: "",
          interimTranscript: "",
          transcriptText: "",
          answerText: "",
          warning: null,
          note: "Recording your question. Finish when you are done speaking.",
          wasPresentingAtStart: wasPresenting,
        });
        setError(null);
        disarmLiveVoiceMode();
        pauseForVoiceInterruption();
        const support = getBackendVoiceRecordingSupport();
        setBackendVoiceRecordingSupport(support);

        if (!support.available) {
          throw new Error(
            support.reason ??
              "Microphone recording is not available in this browser/context.",
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
            if (!isCurrentQuestionRequest(requestId)) {
              return;
            }

            updateQuestionFlow(requestId, {
              stage: "transcribing",
              note: "Transcribing the recorded question and checking the transcript.",
            });
            setIsSubmittingVoice(true);
            disarmLiveVoiceMode();
            const blob = new Blob(chunksRef.current, {
              type: recorder.mimeType || "audio/webm",
            });
            const dataBase64 = await blobToBase64(blob);
            const result = await submitVoiceTurn(sessionId, {
              mimeType: blob.type || "audio/webm",
              dataBase64,
            });

            if (!isCurrentQuestionRequest(requestId)) {
              return;
            }

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
              updateQuestionFlow(requestId, {
                promptText: transcriptText,
                transcriptText,
                interimTranscript: "",
              });
            }

            if (result.interactionApplied) {
              updateQuestionFlow(requestId, {
                stage: "generating_answer",
                note: "Generating an answer to the recorded question.",
              });
              if (transcriptText) {
                setPendingUserTurn(transcriptText);
                setInteractionLog((previous) => [
                  ...previous,
                  { role: "user", text: transcriptText },
                ]);
              }
              await applyInteractionResponse(result, {
                ...(transcriptText ? { userText: transcriptText } : {}),
                wasPresenting,
                questionRequestId: requestId,
              });
            } else if (transcriptText) {
              updateQuestionFlow(requestId, {
                stage: "transcript_review",
                warning:
                  "The recorded transcript may be wrong. Cancel it or send it anyway.",
                note: "Review the transcript before it is sent to Q&A.",
              });
            } else {
              setState((previous) => (previous ? applyUpdate(previous, result) : previous));
              clearQuestionFlow(requestId);
              setPendingUserTurn(null);
            }
          } catch (voiceError) {
            if (isCurrentQuestionRequest(requestId)) {
              clearQuestionFlow(requestId);
            }
            setError((voiceError as Error).message);
          } finally {
            stopActiveMediaStream();
            mediaRecorderRef.current = null;
            chunksRef.current = [];
            if (isCurrentQuestionRequest(requestId)) {
              setIsSubmittingVoice(false);
            }
            setIsRecordingVoice(false);
          }
        };

        recorder.start();
        setIsRecordingVoice(true);
      } catch (recordingError) {
        questionRequestVersionRef.current += 1;
        setQuestionFlow(null);
        setError((recordingError as Error).message);
        stopActiveMediaStream();
        mediaRecorderRef.current = null;
        setIsRecordingVoice(false);
      }
    });
  };

  const handleRecordQuestion = () => {
    if (isSubmittingVoice) {
      return;
    }

    const support = getBackendVoiceRecordingSupport();
    setBackendVoiceRecordingSupport(support);

    if (support.available || isRecordingVoice) {
      handleBackendVoiceRecording();
      return;
    }

    if (browserSpeechSupported) {
      void handleBrowserVoiceInput("record");
      return;
    }

    setError(
      support.reason ??
        "Voice input is not available in this browser/context right now.",
    );
  };

  const handleBrowserVoiceInput = async (source: VoiceQuestionSource = "live") => {
    const provider = browserSpeechProviderRef.current;

    if (!provider || isSubmittingVoice) {
      return;
    }

    try {
      const wasPresenting = isPresenting;
      let requestId: number | null = null;
      const ensureQuestionFlow = (stage: QuestionFlowStage = "listening") => {
        if (requestId !== null) {
          return requestId;
        }

        requestId = createQuestionRequest({
          source,
          stage,
          promptText: "",
          interimTranscript: "",
          transcriptText: "",
          answerText: "",
          warning: null,
          note:
            source === "record"
              ? "Listening for your spoken question."
              : "Listening for a spoken interruption.",
          wasPresentingAtStart: wasPresenting,
        });
        return requestId;
      };

      setError(null);
      const transcript = await provider.listenOnce({
        lang: getSpeechRecognitionLanguage(state?.deck.metadata.language),
        onStart: () => {
          setIsListeningBrowserVoice(true);
          if (source === "record") {
            ensureQuestionFlow("listening");
          }
        },
        onSpeechStart: () => {
          const activeRequestId = ensureQuestionFlow("listening");
          pauseForVoiceInterruption();
          updateQuestionFlow(activeRequestId, {
            note: "Speech detected. Listening to the question now.",
          });
        },
        onEnd: () => {
          setIsListeningBrowserVoice(false);
        },
        onInterimResult: (text) => {
          if (text.trim()) {
            const activeRequestId = ensureQuestionFlow("listening");
            pauseForVoiceInterruption();
            updateQuestionFlow(activeRequestId, {
              promptText: text,
              interimTranscript: text,
              note: "Transcribing your question in real time.",
            });
          }
        },
      });

      const activeRequestId = ensureQuestionFlow("transcribing");
      if (!isCurrentQuestionRequest(activeRequestId)) {
        return;
      }

      pauseForVoiceInterruption();
      disarmLiveVoiceMode();
      updateQuestionFlow(activeRequestId, {
        stage: "transcribing",
        promptText: transcript.text,
        transcriptText: transcript.text,
        interimTranscript: "",
        note: "Finalizing the transcript before sending the question.",
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

      if (!transcript.text.trim()) {
        clearQuestionFlow(activeRequestId);
        return;
      }

	      const transcriptAssessment = assessVoiceQuestionTranscript({
	        source,
	        text: transcript.text,
	        ...(typeof transcript.confidence === "number"
	          ? { confidence: transcript.confidence }
	          : {}),
	      });

	      if (transcriptAssessment.decision === "review") {
	        updateQuestionFlow(activeRequestId, {
	          stage: "transcript_review",
	          promptText: transcript.text,
	          transcriptText: transcript.text,
	          interimTranscript: "",
	          warning: transcriptAssessment.warning ?? null,
	          note: transcriptAssessment.note ?? null,
	        });
	        return;
	      }

      await submitQuestionText({
        requestId: activeRequestId,
        userText: transcript.text,
        source,
        wasPresenting,
      });
    } catch (voiceError) {
      const message = (voiceError as Error).message;
      if (
        message !== "Voice input was stopped." &&
        message !== "No speech was recognized."
      ) {
        setError(message);
      }
    } finally {
      setIsListeningBrowserVoice(false);
    }
  };

  const runVoiceListenCycle = async () => {
    if (
      voiceLoopRunningRef.current ||
      !liveVoiceModeRef.current ||
      isSynthesizingSpeech ||
      isPlayingSpeech ||
      isSubmittingVoice ||
      isInteracting ||
      questionFlow !== null
    ) {
      return;
    }

    voiceLoopRunningRef.current = true;
    try {
      await handleBrowserVoiceInput("live");
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
    questionFlow,
  ]);

  const playSpeech = async (input: {
    text?: string;
    slideId?: string;
    narrationIndex?: number;
    style?: "narration" | "answer" | "summary";
    questionRequestId?: number;
    continueSequence?: boolean;
    advanceSlides?: boolean;
    onEnded?: () => Promise<void> | void;
  }) => {
    try {
      setError(null);
      setIsSynthesizingSpeech(true);
      const speechRequestVersion = speechRequestVersionRef.current;
      const result =
        input.text && (input.style ?? "narration") === "answer"
          ? await prefetchAnswerSpeech(input.text)
          : await synthesizeSpeech(sessionId, input);

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
          input.style === "answer" &&
          input.questionRequestId !== undefined &&
          isCurrentQuestionRequest(input.questionRequestId)
        ) {
          clearQuestionFlow(input.questionRequestId);
        }

        if (
          !input.continueSequence ||
          result.source.type !== "narration_segment" ||
          playbackSequenceRef.current !== playbackSequenceId
        ) {
          if (input.onEnded) {
            await input.onEnded();
          }
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

        if (input.onEnded) {
          await input.onEnded();
        }
      };
      audio.onerror = () => {
        setIsPlayingSpeech(false);
        audioRef.current = null;
        if (
          input.style === "answer" &&
          input.questionRequestId !== undefined &&
          isCurrentQuestionRequest(input.questionRequestId)
        ) {
          clearQuestionFlow(input.questionRequestId);
        }
        setError("Audio playback failed in the browser.");
      };

      audioRef.current = audio;
      setLastSpokenText(result.text);
      if (
        input.style === "answer" &&
        input.questionRequestId !== undefined &&
        isCurrentQuestionRequest(input.questionRequestId)
      ) {
        updateQuestionFlow(input.questionRequestId, {
          stage: "speaking_answer",
          answerText: result.text,
          note: "Answer generated. Speaking now.",
        });
      }
      setIsPlayingSpeech(true);
      await audio.play();
    } catch (speechError) {
      if (
        input.style === "answer" &&
        input.questionRequestId !== undefined &&
        isCurrentQuestionRequest(input.questionRequestId)
      ) {
        clearQuestionFlow(input.questionRequestId);
      }
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

        if (narrationAutoPlay) {
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
    const wasPresenting = isPresenting;
    const requestId = createQuestionRequest({
      source: "typed",
      stage: "generating_answer",
      promptText: userText,
      interimTranscript: "",
      transcriptText: userText,
      answerText: "",
      warning: null,
      note: "Generating an answer to your typed question.",
      wasPresentingAtStart: wasPresenting,
    });

    startTransition(async () => {
      try {
        setError(null);
        disarmLiveVoiceMode();
        stopActiveAudio();
        await submitQuestionText({
          requestId,
          userText,
          source: "typed",
          wasPresenting,
        });
        if (isCurrentQuestionRequest(requestId)) {
          setCommandInput("");
        }
      } catch (interactionError) {
        setError((interactionError as Error).message);
      }
    });
  };

  const startPresentationPlayback = async () => {
    setError(null);
    stopActiveAudio();
    const result = await interactWithSession(sessionId, "continue");
    setState((previous) => (previous ? applyUpdate(previous, result) : previous));

    if (result.assistantMessage?.trim()) {
      setInteractionLog((previous) => [
        ...previous,
        { role: "assistant", text: result.assistantMessage },
      ]);
    }

    if (!result.session.currentSlideId) {
      return;
    }

    await playSpeech({
      slideId: result.session.currentSlideId,
      narrationIndex: result.session.currentNarrationIndex,
      style: "narration",
      continueSequence: true,
      advanceSlides: narrationAutoPlay,
    });
  };

  useEffect(() => {
    if (!pendingPresentationStart || !activeSlideNarrationReady || isPresenting) {
      return;
    }

    let cancelled = false;

    startTransition(async () => {
      try {
        await startPresentationPlayback();
        if (!cancelled) {
          setPendingPresentationStart(false);
        }
      } catch (interactionError) {
        if (!cancelled) {
          setError((interactionError as Error).message);
          setPendingPresentationStart(false);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeSlideNarrationReady, isPresenting, pendingPresentationStart, sessionId]);

  const togglePresenting = () => {
    startTransition(async () => {
      try {
        if (pendingPresentationStart) {
          setPendingPresentationStart(false);
          return;
        }

        if (isPresenting) {
          setError(null);
          stopActiveAudio();
          const result = await interactWithSession(sessionId, "stop");
          setState((previous) => (previous ? applyUpdate(previous, result) : previous));

          if (result.assistantMessage?.trim()) {
            setInteractionLog((previous) => [
              ...previous,
              { role: "assistant", text: result.assistantMessage },
            ]);
          }

          return;
        }

        if (!activeSlideNarrationReady) {
          setPendingPresentationStart(true);
          return;
        }

        await startPresentationPlayback();
      } catch (interactionError) {
        setError((interactionError as Error).message);
      }
    });
  };

  const restartPresentationFromBeginning = () => {
    const firstSlide = slides[0];

    if (!firstSlide) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        disarmLiveVoiceMode();
        stopActiveAudio();
        setPendingPresentationStart(false);

        if (isPresenting) {
          const stopResult = await interactWithSession(sessionId, "stop");
          setState((previous) =>
            previous ? applyUpdate(previous, stopResult) : previous,
          );
        }

        const selectionResult = await selectSlide(sessionId, firstSlide.id);
        setState((previous) =>
          previous ? applyUpdate(previous, selectionResult) : previous,
        );

        const progressResult = await updateNarrationProgress(sessionId, {
          slideId: firstSlide.id,
          narrationIndex: 0,
        });
        setState((previous) =>
          previous ? applyUpdate(previous, progressResult) : previous,
        );

        if (!state?.narrationsBySlideId[firstSlide.id]) {
          setPendingPresentationStart(true);
          return;
        }

        await startPresentationPlayback();
      } catch (restartError) {
        setError((restartError as Error).message);
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
      {showBlockingOverlay ? (
        <WorkingOverlay
          firstSlideReady={activeSlideNarrationReady}
          hasSlides={slides.length > 0}
          isGeneratingNarrationAudio={isGeneratingNarrationAudio}
          message={workingOverlayMessage}
          pendingPresentationStart={pendingPresentationStart}
          title={workingOverlayTitle}
        />
      ) : null}
      {questionFlow ? (
        <QuestionFlowOverlay
          isRecordingVoice={isRecordingVoice}
          onCancel={cancelQuestionFlow}
          onFinishRecording={() => {
            mediaRecorderRef.current?.stop();
            setIsRecordingVoice(false);
          }}
          onSendAnyway={() =>
            void submitQuestionText({
              requestId: questionFlow.requestId,
              userText: questionFlow.transcriptText,
              source: questionFlow.source,
              wasPresenting: questionFlow.wasPresentingAtStart,
            })
          }
          questionFlow={questionFlow}
        />
      ) : null}
      <div className="mx-auto max-w-7xl">
        <PresenterHeader
          pptxExportUrl={getPresentationPptxExportUrl(sessionId)}
          summary={state.deck.summary}
          title={state.deck.title}
        />

        {error ? (
          <div className="mb-5 rounded-[20px] border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {!pendingPresentationStart && !isDeckNarrationReady ? (
          <div className="mb-5 rounded-[20px] border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-paper/85">
            Preparing narration in the background. {narrationReadySlideCount} of{" "}
            {slides.length} slides are ready.
          </div>
        ) : null}

        {activeSlide ? (
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_360px]">
            <ActiveSlideStage
              activeSlide={activeSlide}
              activeSlideCanvas={activeSlideCanvas}
              currentNarrationDisplayText={currentNarrationDisplayText}
              currentNarrationIndex={currentNarrationIndex}
              currentSlideIndex={currentSlideIndex}
              isGeneratingNarrationAudio={isGeneratingNarrationAudio}
              isIllustrationLoading={illustrationLoadingSlideId === activeSlide.id}
              narrationSegments={narrationSegments}
              provider={state.provider}
              totalSlides={slides.length}
            />

            <aside className="space-y-5">
              <PresenterControlsPanel
                canGoBack={currentSlideIndex > 0}
                canGoForward={currentSlideIndex < slides.length - 1}
                currentNarrationIndex={currentNarrationIndex}
                hasSlides={slides.length > 0}
                isBusy={pendingPresentationStart}
                isGeneratingNarrationAudio={isGeneratingNarrationAudio}
                isInteracting={isInteracting}
                isListeningBrowserVoice={isListeningBrowserVoice}
                isNarrationLoadingForActiveSlide={
                  narrationLoadingSlideId === activeSlide.id
                }
                isPlayingSpeech={isPlayingSpeech}
                isPresenting={isPresenting}
                isRecordingVoice={isRecordingVoice}
                isSubmittingVoice={isSubmittingVoice}
                isSynthesizingSpeech={isSynthesizingSpeech}
                isUpdatingNarrationProgress={isUpdatingNarrationProgress}
                lastSpokenText={lastSpokenText}
                narrationSegmentsLength={narrationSegments.length}
                onBack={() => handleSelectSlide(Math.max(currentSlideIndex - 1, 0))}
                onForward={() =>
                  handleSelectSlide(Math.min(currentSlideIndex + 1, slides.length - 1))
                }
                onNextPoint={() =>
                  handleNarrationStep(
                    Math.min(currentNarrationIndex + 1, narrationSegments.length - 1),
                  )
                }
                onPlayFromCurrentPoint={() =>
                  void playSpeech({
                    slideId: activeSlide.id,
                    narrationIndex: currentNarrationIndex,
                    style: "narration",
                    continueSequence: true,
                    advanceSlides: narrationAutoPlay,
                  })
                }
                onPreviousPoint={() =>
                  handleNarrationStep(Math.max(currentNarrationIndex - 1, 0))
                }
                onRestart={restartPresentationFromBeginning}
                onStopAudio={stopActiveAudio}
                onTogglePresenting={togglePresenting}
                pendingPresentationStart={pendingPresentationStart}
                pendingUserTurn={pendingUserTurn}
                presentLabel={presentButtonLabel}
                sessionState={state.session.state}
              />

              <AskNaturallyPanel
                backendVoiceRecordingAvailable={backendVoiceRecordingAvailable}
                backendVoiceRecordingReason={backendVoiceRecordingSupport.reason}
                browserSpeechSupported={browserSpeechSupported}
                commandInput={commandInput}
                isInteracting={isInteracting}
                isListeningBrowserVoice={isListeningBrowserVoice}
                isPending={isPending}
                isRecordingVoice={isRecordingVoice}
                isSubmittingVoice={isSubmittingVoice}
                isSynthesizingSpeech={isSynthesizingSpeech}
                lastVoiceTranscript={lastVoiceTranscript}
                latestAnswerNotice={latestAnswerNotice}
                latestAssistantMessage={latestAssistantMessage}
                liveVoiceMode={liveVoiceMode}
                onCommandInputChange={setCommandInput}
                onRecordQuestion={handleRecordQuestion}
                onSendInteraction={sendInteraction}
                onSpeakAnswer={(answer) =>
                  void playSpeech({
                    text: answer,
                    style: "answer",
                  })
                }
                onToggleLiveVoice={() => setLiveVoiceMode((previous) => !previous)}
                questionFlowActive={questionFlow !== null}
                recordQuestionUnavailable={recordQuestionUnavailable}
                recordQuestionUsesBrowserFallback={recordQuestionUsesBrowserFallback}
              />

              <GroundingPanel source={state.deck.source} />
            </aside>
          </section>
        ) : null}

        <SlideOverview
          currentSlideIndex={currentSlideIndex}
          illustrationsBySlideId={illustrationsBySlideId}
          onSelectSlide={handleSelectSlide}
          slides={slides}
          theme={deckTheme}
        />
      </div>
    </main>
  );
};
