// Resource allowances, never semantic requirements or instructions to fill space.
const profiles = {
  "research-planning": { floor: 5000, baseline: 3, perUnit: 1000 },
  "fact-curation": { floor: 10000, baseline: 6, perUnit: 500 },
  "research-review": { floor: 8000, baseline: 8, perUnit: 500 },
  strategy: { floor: 4000, baseline: 3, perUnit: 1000 },
  allocation: { floor: 7000, baseline: 3, perUnit: 1000 },
  "outline-review": { floor: 4000, baseline: 3, perUnit: 1000 },
  "image-selection": { floor: 3000, baseline: 3, perUnit: 1000 },
  design: { floor: 4000, baseline: 3, perUnit: 1000 },
  "slide-writing": { floor: 7000, baseline: 1, perUnit: 0 },
  "slide-review": { floor: 5000, baseline: 3, perUnit: 1000 },
  narration: { floor: 8000, baseline: 3, perUnit: 1000 },
  "narration-review": { floor: 5000, baseline: 3, perUnit: 1000 },
  publication: { floor: 5000, baseline: 3, perUnit: 1000 },
  "question-classification": { floor: 1500, baseline: 1, perUnit: 0 },
  "question-answer": { floor: 2500, baseline: 1, perUnit: 0 },
  "question-review": { floor: 5000, baseline: 1, perUnit: 0 },
} as const;

export type GenerationCapacityStage = keyof typeof profiles;
export const MAX_GENERATION_COMPLETION_TOKENS = 14_000;

export function generationCompletionBudget(stage: GenerationCapacityStage, work: {
  slideCount?: number | undefined;
  requirementCount?: number | undefined;
  durationMinutes?: number | undefined;
}): number {
  const { slideCount = 0, requirementCount = 0, durationMinutes = 0 } = work;
  if (![slideCount, requirementCount].every(value => Number.isSafeInteger(value) && value >= 0)
    || !Number.isFinite(durationMinutes) || durationMinutes < 0) throw new Error("Invalid generation workload.");
  const units = stage === "fact-curation" ? Math.max(requirementCount, slideCount * 2)
    : stage === "research-review" ? requirementCount
    : stage === "narration" || stage === "narration-review" ? Math.max(slideCount, Math.ceil(durationMinutes / 2))
    : slideCount;
  const profile = profiles[stage];
  return Math.min(MAX_GENERATION_COMPLETION_TOKENS, profile.floor + profile.perUnit * Math.max(0, units - profile.baseline));
}
