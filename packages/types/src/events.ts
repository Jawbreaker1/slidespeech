import type { SessionState } from "./domain";

export interface SessionTransitionEvent {
  sessionId: string;
  fromState: SessionState;
  toState: SessionState;
  at: string;
  reason: string;
}

export interface DebugEvent {
  type: "state_transition" | "provider_call" | "repository_write";
  message: string;
  at: string;
  metadata?: Record<string, string | number | boolean>;
}

