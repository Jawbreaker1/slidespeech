import type { SlideReviewAgentInput } from "@slidespeech/types";
import { slideDesignProof } from "./slide-design-proof";

// Small authored semantic controls, not research results or application content.
export const fidelityCases = [
  { id: "pressure", language: "en", subject: "Water and pressure",
    claim: "Pure water boils at about 100 degrees Celsius at standard atmospheric pressure. Its boiling temperature changes with pressure.",
    concise: "At standard atmospheric pressure, pure water boils at about 100 C.",
    misleading: "Water always boils at 100 C, regardless of pressure." },
  { id: "observation", language: "en", subject: "Interpreting a fictional checklist pilot",
    claim: "In a fictional observational pilot, teams using a checklist recorded 25 percent fewer errors than the comparison group. The pilot did not establish causation or predict results for every team.",
    concise: "In this observational pilot, checklist use was associated with 25% fewer errors; causation was not established.",
    misleading: "Checklists cause 25% fewer errors for every team." },
  { id: "sample", language: "sv", subject: "Tolka ett fiktivt groningsförsök",
    claim: "I ett fiktivt försök grodde 80 procent av en viss frösats vid 22 grader. Resultatet gäller den provade satsen och förhållandena, inte alla frön eller temperaturer.",
    concise: "Vid 22 grader grodde 80 procent av den provade frösatsen.",
    misleading: "Alla frön gror till 80 procent oavsett temperatur." },
] as const;

const identity = (artifactId: string) => ({ schemaVersion: "2.0" as const, artifactId, createdAt: "2026-09-15T15:00:00.000Z" });

export function fidelityInput(item: typeof fidelityCases[number], defect?: "visible" | "notes" | "plan"): SlideReviewAgentInput {
  const prompt = item.language === "sv"
    ? `Skapa två korta slides om ${item.subject}: en introduktion och en sammanfattning med frågor. Använd bara den givna uppgiften och bevara dess begränsningar.`
    : `Create two short slides about ${item.subject}: an introduction and a recap with questions. Use only the supplied fact, preserving its limitations.`;
  const factId = `fact_${item.id}`;
  const request = { ...identity("request"), request: { topic: prompt }, explicitUrls: [] };
  const classification = { ...identity("classification"), requestArtifactId: "request", originalPrompt: prompt, subject: item.subject,
    language: item.language, audience: "Beginners", presentationGoal: "Interpret the supplied fact accurately.", deckMode: "teaching" as const,
    groundingMode: "model-knowledge" as const, requestedSources: [], presentationDirections: [], requestedCoverage: [], openQuestions: [],
    requiresUserClarification: false, clarificationReason: null };
  const factBank = { ...identity("facts"), classificationArtifactId: "classification", evidenceSetArtifactId: "evidence",
    facts: [{ id: factId, claim: item.claim, role: "example" as const, language: item.language, allowedUse: "visible-slide" as const,
      origin: "model-knowledge" as const, knowledgeBasis: "Explicitly supplied evaluation premise; fictional observations are not real-world evidence.", evidenceRequirementIds: [] }],
    sourceSummaries: [], sourceQuality: [], missingFacts: [], contradictions: [], modelKnowledgeAllowed: true, sufficientForDeck: true, blockingReasons: [] };
  const strategy = { ...identity("strategy"), classificationArtifactId: "classification", factBankArtifactId: "facts", slideCount: 2, durationMinutes: 2,
    deckMode: "teaching" as const, requiredIntro: true as const, requiredConclusion: true as const, language: item.language, audience: "Beginners",
    tone: "Welcoming and precise", storyArc: [{ order: 0, role: "intro" as const, audienceQuestion: defect === "plan" ? `Is it true that ${item.misleading}` : "What does the supplied observation establish?" },
      { order: 1, role: "conclusion" as const, audienceQuestion: "What can we conclude, and what questions remain?" }],
    layoutVarietyPolicy: { minimumUniqueLayouts: 2, maximumConsecutiveSameFamily: 1, allowIntentionalRepetition: false }, narrationStyle: "Explain the material conversationally." };
  const slidePlans = { ...identity("plans"), deckStrategyArtifactId: "strategy", factBankArtifactId: "facts", slides: strategy.storyArc.map((beat, index) => ({
    slideId: `slide_${index}`, order: index, role: beat.role,
    allowedFactIds: [factId], requiredFactIds: [factId], modelKnowledgeScope: { allowed: false },
    overlapPolicy: { mode: index === 0 ? "preview" as const : "recap" as const, factIds: [factId], rationale: "Introduce then synthesize." },
  })) };
  const designs = { ...identity("designs"), deckStrategyArtifactId: "strategy", slidePlanSetArtifactId: "plans",
    designs: [slideDesignProof[0]!, slideDesignProof[5]!].map((proof, index) => ({ ...proof.design, slideId: `slide_${index}` })) };
  const slides = { ...identity("slides"), deckStrategyArtifactId: "strategy", slidePlanSetArtifactId: "plans", slideDesignSpecSetArtifactId: "designs", slides: [
    { slideId: "slide_0", title: item.subject, content: { kind: "statement" as const, statement: defect === "visible" ? item.misleading : item.concise },
      usedFactIds: [factId], speakerNotes: [item.language === "sv" ? "Välkomna. Låt oss undersöka vad uppgiften faktiskt visar." : "Welcome. Let us look at what this fact actually establishes.", defect === "notes" ? item.misleading : item.claim], sourceAttributions: [], likelyQuestions: [] },
    { slideId: "slide_1", title: item.language === "sv" ? "Sammanfattning och frågor" : "Recap and questions",
      content: { kind: "question" as const, question: item.language === "sv" ? "Vilka frågor har ni?" : "What questions do you have?", guidance: item.concise },
      usedFactIds: [factId], speakerNotes: [item.claim], sourceAttributions: [], likelyQuestions: [] },
  ] };
  return { request, classification, factBank, strategy, slidePlans, designs, slides };
}
