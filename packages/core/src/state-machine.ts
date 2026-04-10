import type { Session, SessionState } from "@slidespeech/types";

export type SessionEvent =
  | "prepare"
  | "presentation_ready"
  | "pause"
  | "interrupt"
  | "answer"
  | "branch"
  | "resume"
  | "finish"
  | "fail";

const transitions: Record<SessionState, Partial<Record<SessionEvent, SessionState>>> =
  {
    idle: {
      prepare: "preparing_presentation",
      fail: "error",
    },
    preparing_presentation: {
      presentation_ready: "presenting",
      fail: "error",
    },
    presenting: {
      pause: "slide_paused",
      interrupt: "interrupted",
      finish: "finished",
      fail: "error",
    },
    slide_paused: {
      resume: "resuming",
      interrupt: "interrupted",
      answer: "answering_question",
      branch: "branching_explanation",
      fail: "error",
    },
    interrupted: {
      answer: "answering_question",
      branch: "branching_explanation",
      pause: "slide_paused",
      fail: "error",
    },
    answering_question: {
      pause: "slide_paused",
      resume: "resuming",
      fail: "error",
    },
    branching_explanation: {
      pause: "slide_paused",
      resume: "resuming",
      fail: "error",
    },
    resuming: {
      presentation_ready: "presenting",
      fail: "error",
    },
    finished: {},
    error: {},
  };

export const transitionSessionState = (
  session: Session,
  event: SessionEvent,
): SessionState => {
  const next = transitions[session.state][event];

  if (!next) {
    throw new Error(
      `Invalid session transition from ${session.state} via ${event}`,
    );
  }

  return next;
};
