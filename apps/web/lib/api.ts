import type {
  GeneratePresentationResponse,
  SelectSlideResponse,
  SessionSnapshotResponse,
  SessionInteractionResponse,
  SlideNarration,
  WebFetchResponse,
  WebResearchQueryResponse,
} from "@slidespeech/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

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
): Promise<GeneratePresentationResponse> => {
  const response = await fetch(`${API_BASE_URL}/api/presentations/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ topic }),
  });

  if (!response.ok) {
    const message =
      ((await response.json()) as { error?: string }).error ??
      "Failed to generate presentation.";
    throw new Error(message);
  }

  return (await response.json()) as GeneratePresentationResponse;
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
