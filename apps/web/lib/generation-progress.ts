import type { GenerationStageName, GenerationV2Job } from "@slidespeech/types";

export const generationPhases = ["Research", "Structure", "Slides", "Spoken script", "Final review"];
export const generationSteps: { stage: GenerationStageName; label: string; detail: string; phase: number }[] = [
  { stage: "request-capture", label: "Saving your brief", detail: "Recording your topic and presentation settings.", phase: 0 },
  { stage: "prompt-classification", label: "Understanding your presentation", detail: "Identifying the audience, purpose and material you asked to include.", phase: 0 },
  { stage: "research-planning", label: "Planning the research", detail: "Deciding what information is needed and where to find it.", phase: 0 },
  { stage: "research-execution", label: "Reading the sources", detail: "Fetching source material for your presentation.", phase: 0 },
  { stage: "evidence-selection", label: "Selecting relevant material", detail: "Assessing which source passages support your topic.", phase: 0 },
  { stage: "fact-curation", label: "Building the fact bank", detail: "Organising the information the presentation will be based on.", phase: 0 },
  { stage: "research-review", label: "Reviewing the research", detail: "Checking the material against your brief before planning the slides.", phase: 0 },
  { stage: "deck-strategy", label: "Shaping the story", detail: "Planning the introduction, main ideas and conclusion.", phase: 1 },
  { stage: "slide-allocation", label: "Planning each slide", detail: "Giving every slide a purpose and the material it needs.", phase: 1 },
  { stage: "outline-review", label: "Reviewing the outline", detail: "Checking the flow and coverage of the presentation.", phase: 1 },
  { stage: "design-selection", label: "Choosing layouts and images", detail: "Selecting compositions and assessing suitable source images where available.", phase: 2 },
  { stage: "slide-generation", label: "Writing and fitting your slides", detail: "Writing the content and fitting it into the selected layouts.", phase: 2 },
  { stage: "slide-review", label: "Reviewing the slides", detail: "Checking the finished slide content against the material.", phase: 2 },
  { stage: "narration-generation", label: "Writing the spoken presentation", detail: "Connecting the slides into a complete presenter script.", phase: 3 },
  { stage: "narration-review", label: "Checking the presenter's delivery", detail: "Reviewing natural phrasing, continuity and factual consistency.", phase: 3 },
  { stage: "publication-review", label: "Reviewing the complete presentation", detail: "Checking slides and spoken script together before publication.", phase: 4 },
  { stage: "publication", label: "Saving your presentation", detail: "Preparing the approved presentation for your library.", phase: 4 },
];

export const generationStep = (stage?: GenerationStageName) => generationSteps.find((step) => step.stage === stage);

export function estimateLabel(estimate: GenerationV2Job["estimate"]) {
  if (!estimate) return "Not enough timing data yet";
  if (estimate.upperMs === 0) return "Longer than previous runs";
  if (estimate.upperMs < 60_000) return "About a minute or less";
  const low = Math.max(1, Math.floor(estimate.lowerMs / 60_000));
  const high = Math.max(low, Math.ceil(estimate.upperMs / 60_000));
  return low === high ? `About ${high} min` : `About ${low}-${high} min`;
}

export function elapsedLabel(start: string | undefined, end: number) {
  if (!start) return "--";
  const seconds = Math.max(0, Math.floor((end - Date.parse(start)) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function generationUnits(job: GenerationV2Job | null) {
  const event = job?.progress.at(-1);
  if (!event || event.completedUnits === undefined) return undefined;
  if (event.stage === "research-execution") return `${event.completedUnits} source requests completed`;
  if (event.stage === "evidence-selection" && event.totalUnits) return `${event.completedUnits} of ${event.totalUnits} source pages assessed`;
  if (event.stage === "slide-generation" && event.totalUnits) return `${event.completedUnits} of ${event.totalUnits} slides written and fitted`;
  return undefined;
}
