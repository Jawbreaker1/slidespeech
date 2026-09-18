import { SLIDE_LAYOUTS, type PresentationThemeId, type SlideDraft, type SlideDesignSpec, type SlideDraftContent } from "@slidespeech/types";

// Compact authored fixtures for renderer acceptance, never product generation.
export function varietyProof(layout: typeof SLIDE_LAYOUTS[number], themeId: PresentationThemeId) {
  const count = layout.maximumItems;
  const content: SlideDraftContent = layout.contentKind === "statement"
    ? { kind: "statement", statement: "Give one idea room to be understood.", supportingText: "The voice adds context. The screen gives the audience a point of focus." }
    : layout.contentKind === "comparison" ? { kind: "comparison", left: { heading: "On screen", items: ["The central idea", "Visible evidence", "A clear distinction", "A useful example"].slice(0, count) }, right: { heading: "In the voice", items: ["Context and meaning", "An explanation", "A connection", "Room for questions"].slice(0, count) } }
    : layout.contentKind === "process" ? { kind: "process", steps: ["Research", "Shape", "Present", "Discuss"].slice(0, count).map(label => ({ label, description: "Give this step a clear purpose." })) }
    : layout.contentKind === "quote" ? { kind: "quote", quote: "A presentation is a conversation, not a page read aloud.", attribution: "Authored design fixture" }
    : { kind: "question", question: "What would you like to explore?", guidance: "Leave space for the audience to ask and reflect." };
  const draft: SlideDraft = { slideId: `proof_${layout.id}_${themeId}`, title: "Room for the story", subtitle: "A visual design study", content,
    speakerNotes: ["Manually authored renderer fixture, not a generated presentation."], usedFactIds: [], sourceAttributions: [{ sourceId: "fixture", label: "Design fixture" }], likelyQuestions: [] };
  const design: SlideDesignSpec = { slideId: draft.slideId, layoutId: layout.id, layoutFamily: layout.family, themeId, contentDensity: "sparse", visualRole: "hero",
    imageStrategy: layout.image ? "source-image" : "none", ...(layout.image ? { imageAssetId: "fixture_image" } : {}), variationSeed: 0 };
  return { draft, design };
}
