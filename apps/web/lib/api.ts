import type {
  DeletePresentationResponse,
  GeneratePresentationResponse,
  GeneratePresentationRequest,
  PresentationTheme,
  ListSavedPresentationsResponse,
  NarrationProgressResponse,
  PresentationGenerationJobStatusResponse,
  SpeechSynthesisResponse,
  SelectSlideResponse,
  SessionSnapshotResponse,
  SessionInteractionResponse,
  SlideIllustrationResponse,
  SlideNarration,
  VoiceTurnResponse,
  WebFetchResponse,
  WebResearchQueryResponse,
} from "@slidespeech/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export const getPresentationPptxExportUrl = (sessionId: string): string =>
  `${API_BASE_URL}/api/presentations/${sessionId}/export/pptx`;

export const fetchExamplePresentation =
  async (): Promise<GeneratePresentationResponse> => {
    const response = await fetch(`${API_BASE_URL}/api/presentations/example`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Failed to load example presentation.");
    }

    return (await response.json()) as GeneratePresentationResponse;
  };

export const generatePresentation = async (
  topic: string,
  options?: {
    useWebResearch?: boolean;
    targetDurationMinutes?: number;
    targetSlideCount?: number;
    theme?: PresentationTheme;
  },
): Promise<GeneratePresentationResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/presentations/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildGeneratePresentationPayload(topic, options)),
  });

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to generate presentation.";
    throw new Error(message);
  }

  return (await response.json()) as GeneratePresentationResponse;
};

const buildGeneratePresentationPayload = (
  topic: string,
  options?: {
    useWebResearch?: boolean;
    targetDurationMinutes?: number;
    targetSlideCount?: number;
    theme?: PresentationTheme;
  },
): GeneratePresentationRequest => ({
  topic,
  ...(options?.useWebResearch !== undefined
    ? { useWebResearch: options.useWebResearch }
    : {}),
  ...(options?.targetDurationMinutes !== undefined
    ? { targetDurationMinutes: options.targetDurationMinutes }
    : {}),
  ...(options?.targetSlideCount !== undefined
    ? { targetSlideCount: options.targetSlideCount }
    : {}),
  ...(options?.theme !== undefined ? { theme: options.theme } : {}),
});

export const enqueuePresentationGeneration = async (
  topic: string,
  options?: {
    useWebResearch?: boolean;
    targetDurationMinutes?: number;
    targetSlideCount?: number;
    theme?: PresentationTheme;
  },
): Promise<PresentationGenerationJobStatusResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/presentations/generate-jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildGeneratePresentationPayload(topic, options)),
  });

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to queue presentation generation.";
    throw new Error(message);
  }

  return (await response.json()) as PresentationGenerationJobStatusResponse;
};

export const fetchPresentationGenerationJobStatus = async (
  jobId: string,
): Promise<PresentationGenerationJobStatusResponse> => {
  const response = await fetch(
    `${API_BASE_URL}/api/presentations/generate-jobs/${jobId}`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to load generation status.";
    throw new Error(message);
  }

  return (await response.json()) as PresentationGenerationJobStatusResponse;
};

export const listSavedPresentations = async (input?: {
  limit?: number;
  offset?: number;
  readyOnly?: boolean;
}): Promise<ListSavedPresentationsResponse> => {
  const searchParams = new URLSearchParams();

  if (input?.limit !== undefined) {
    searchParams.set("limit", String(input.limit));
  }

  if (input?.offset !== undefined) {
    searchParams.set("offset", String(input.offset));
  }

  if (input?.readyOnly !== undefined) {
    searchParams.set("readyOnly", String(input.readyOnly));
  }

  const response = await fetch(
    `${API_BASE_URL}/api/presentations${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to list presentations.";
    throw new Error(message);
  }

  return (await response.json()) as ListSavedPresentationsResponse;
};

export const deleteSavedPresentation = async (
  sessionId: string,
): Promise<DeletePresentationResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/presentations/${sessionId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to delete presentation.";
    throw new Error(message);
  }

  return (await response.json()) as DeletePresentationResponse;
};

export const fetchSlideNarration = async (
  sessionId: string,
  slideId: string,
): Promise<SlideNarration> => {
  const response = await fetch(
    `${API_BASE_URL}/api/presentations/${sessionId}/slides/${slideId}/narration`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to load slide narration.";
    throw new Error(message);
  }

  return (await response.json()) as SlideNarration;
};

export const fetchSlideIllustration = async (
  sessionId: string,
  slideId: string,
): Promise<SlideIllustrationResponse> => {
  const response = await fetch(
    `${API_BASE_URL}/api/presentations/${sessionId}/slides/${slideId}/illustration`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to load slide illustration.";
    throw new Error(message);
  }

  return (await response.json()) as SlideIllustrationResponse;
};

export const interactWithSession = async (
  sessionId: string,
  text: string,
): Promise<SessionInteractionResponse> => {
  const response = await fetch(
    `${API_BASE_URL}/api/presentations/${sessionId}/interact`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    },
  );

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to interact with the session.";
    throw new Error(message);
  }

  return (await response.json()) as SessionInteractionResponse;
};

export const selectSlide = async (
  sessionId: string,
  slideId: string,
): Promise<SelectSlideResponse> => {
  const response = await fetch(
    `${API_BASE_URL}/api/presentations/${sessionId}/slides/select`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slideId }),
    },
  );

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to select slide.";
    throw new Error(message);
  }

  return (await response.json()) as SelectSlideResponse;
};

export const fetchSessionSnapshot = async (
  sessionId: string,
): Promise<SessionSnapshotResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/presentations/${sessionId}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to load session snapshot.";
    throw new Error(message);
  }

  return (await response.json()) as SessionSnapshotResponse;
};

export const queryExternalResearch = async (
  query: string,
  maxResults = 3,
): Promise<WebResearchQueryResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/research/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, maxResults }),
  });

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to run external research.";
    throw new Error(message);
  }

  return (await response.json()) as WebResearchQueryResponse;
};

export const fetchExternalPage = async (url: string): Promise<WebFetchResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/research/fetch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to fetch external page.";
    throw new Error(message);
  }

  return (await response.json()) as WebFetchResponse;
};

export const submitVoiceTurn = async (
  sessionId: string,
  input: { mimeType: string; dataBase64: string },
): Promise<VoiceTurnResponse> => {
  const response = await fetch(
    `${API_BASE_URL}/api/presentations/${sessionId}/voice-turn`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        audio: input,
      }),
    },
  );

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to process voice turn.";
    throw new Error(message);
  }

  return (await response.json()) as VoiceTurnResponse;
};

export const synthesizeSpeech = async (
  sessionId: string,
  input: {
    text?: string;
    slideId?: string;
    narrationIndex?: number;
    style?: "narration" | "answer" | "summary";
  },
): Promise<SpeechSynthesisResponse> => {
  const response = await fetch(
    `${API_BASE_URL}/api/presentations/${sessionId}/speech`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to synthesize speech.";
    throw new Error(message);
  }

  return (await response.json()) as SpeechSynthesisResponse;
};

export const updateNarrationProgress = async (
  sessionId: string,
  input: { slideId?: string; narrationIndex: number },
): Promise<NarrationProgressResponse> => {
  const response = await fetch(
    `${API_BASE_URL}/api/presentations/${sessionId}/narration/progress`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to update narration progress.";
    throw new Error(message);
  }

  return (await response.json()) as NarrationProgressResponse;
};
