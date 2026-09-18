import { composeSlideScene, SLIDE_LAYOUTS, type SlideDraft, type SlideDraftContent, type SlideDesignSpec } from "@slidespeech/types";

// Deliberately authored layout fixtures, never generated or publishable decks.
const copy: { title: string; content: SlideDraftContent }[] = [
  { title: "Make room for the story.", content: { kind: "statement", statement: "A clear idea deserves a little breathing room.", supportingText: "Design study 01\nEditorial opening\n\nNot an AI-generated presentation." } },
  { title: "Less on the slide. More in the story.", content: { kind: "statement", statement: "Let the screen carry the idea. Let the presenter give it meaning.", supportingText: "A quiet composition, a readable hierarchy, and space for the audience to think." } },
  { title: "Two perspectives. One clear comparison.", content: { kind: "comparison", left: { heading: "The slide", items: ["A concise point of view", "Evidence worth seeing", "Space to focus"] }, right: { heading: "The voice", items: ["Context and explanation", "A concrete example", "A bridge to the next idea"] } } },
  { title: "A story, built with intention.", content: { kind: "process", steps: [{ label: "Understand", description: "Start with the audience and what they need to learn." }, { label: "Shape", description: "Give each slide a distinct job in the story." }, { label: "Connect", description: "Carry the audience from one idea to the next." }] } },
  { title: "A moment to pause.", content: { kind: "quote", quote: "Design the presentation as a conversation, not a wall of text.", attribution: "SlideSpeech design study / Proposed design principle" } },
  { title: "Keep the conversation going.", content: { kind: "question", question: "What would you like to explore together?", guidance: "Design study 01 / Closing composition" } },
];

export const slideDesignProof = SLIDE_LAYOUTS.slice(0, copy.length).map((layout, index) => {
  const item = copy[index]!;
  const draft: SlideDraft = { slideId: `design_proof_${index}`, ...item, usedFactIds: [], speakerNotes: ["Manually authored layout fixture. This is not pipeline-generated material."], sourceAttributions: [], likelyQuestions: [] };
  const design: SlideDesignSpec = { slideId: draft.slideId, layoutId: layout.id, layoutFamily: layout.family, contentDensity: "sparse", visualRole: "hero", imageStrategy: "none", variationSeed: 0 };
  return { draft, design, scene: composeSlideScene(draft, design) };
});
