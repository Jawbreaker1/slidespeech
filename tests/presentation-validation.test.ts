import test from "node:test";
import assert from "node:assert/strict";

import { validateDeck, validateNarrations } from "@slidespeech/core";
import { DeckSchema, SlideNarrationSchema, type Slide } from "@slidespeech/types";

const baseProfile = {
  audienceLevel: "beginner" as const,
  tone: "supportive and concrete",
  pace: "balanced",
  preferredExampleStyle: "real_world" as const,
  wantsFrequentChecks: true,
  detailLevel: "standard" as const,
};

const makeSlide = (
  id: string,
  order: number,
  overrides: Partial<Slide> = {},
): Slide =>
  ({
    id,
    order,
    title: "AI drafting in project work",
    learningGoal:
      "See where AI drafting support helps project teams and where review still matters.",
    keyPoints: [
      "AI drafting can turn notes into a first project summary for review.",
      "Human review keeps decisions, names, dates, and sensitive details accurate.",
      "The useful workflow separates draft creation from final approval.",
    ],
    beginnerExplanation:
      "AI drafting is useful when it creates a reviewable first version rather than a final decision.",
    advancedExplanation:
      "The project workflow stays safer when generated drafts are checked before they become shared project material.",
    examples: [],
    likelyQuestions: [],
    visualNotes: [],
    visuals: {
      layoutTemplate: "hero-focus",
      accentColor: "1C7C7D",
      cards: [
        {
          id: `${id}_card_1`,
          title: "Draft first",
          body: "AI drafting can turn notes into a first project summary for review.",
          tone: "accent",
        },
      ],
      callouts: [],
      diagramNodes: [],
      diagramEdges: [],
      imageSlots: [],
    },
    ...overrides,
  }) as Slide;

const makeDeck = (slides: Slide[]) =>
  DeckSchema.parse({
    id: "deck_validation",
    title: "Validation test",
    topic: "AI tools in daily work",
    summary: "A compact validation deck.",
    pedagogicalProfile: baseProfile,
    source: {
      type: "topic",
      topic: "AI tools in daily work",
      sourceIds: [],
    },
    slides,
    createdAt: "2026-04-12T10:00:00.000Z",
    updatedAt: "2026-04-12T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

test("deck validation normalizes slide order and records validation metadata", () => {
  const deck = makeDeck([makeSlide("slide_1", 3)]);

  const result = validateDeck(deck);

  assert.equal(result.value.slides[0]?.order, 0);
  assert.equal(result.value.metadata.validation?.repaired, true);
  assert.ok(
    result.value.metadata.validation?.issues.some(
      (issue) => issue.code === "slide_order_normalized",
    ),
  );
});

test("deck validation reports generic visual card titles without local repair", () => {
  const deck = makeDeck([
    makeSlide("slide_generic_cards", 0, {
      visuals: {
        layoutTemplate: "two-column-callouts",
        accentColor: "1C7C7D",
        cards: [
          {
            id: "card_generic_1",
            title: "Key idea 1",
            body: "AI drafting can turn notes into a first project summary for review.",
            tone: "accent",
          },
        ],
        callouts: [],
        diagramNodes: [],
        diagramEdges: [],
        imageSlots: [],
      },
    }),
  ]);

  const result = validateDeck(deck);
  const cardTitle = result.value.slides[0]?.visuals.cards[0]?.title ?? "";

  assert.match(cardTitle, /key\s*(?:point|idea)\s*\d+/i);
  assert.equal(result.repaired, false);
  assert.ok(
    result.issues.some((issue) => issue.code === "generic_visual_card_titles"),
  );
});

test("deck validation does not manufacture visual cards for sparse single-claim slides", () => {
  const deck = makeDeck([
    makeSlide("slide_sparse_single_claim", 0, {
      title: "Help Wanted opens the series",
      learningGoal:
        "The first SpongeBob SquarePants episode is anchored by Help Wanted.",
      keyPoints: ["Help Wanted was the first episode of SpongeBob SquarePants."],
      beginnerExplanation:
        "The episode title gives the audience a clear starting point before broader context.",
      advancedExplanation:
        "The sourced detail establishes episode identity without adding unsupported impact language.",
      visuals: {
        layoutTemplate: "hero-focus",
        accentColor: "1C7C7D",
        cards: [],
        callouts: [],
        diagramNodes: [],
        diagramEdges: [],
        imageSlots: [],
      },
    }),
  ]);

  const result = validateDeck(deck);

  assert.equal(result.value.slides[0]?.visuals.cards.length, 0);
  assert.equal(
    result.issues.some((issue) => issue.code === "missing_visual_cards"),
    false,
  );
});

test("deck validation rejects a slide that repeats one claim across the whole visual surface", () => {
  const repeatedClaim =
    "It also helps explain why well-designed tangible marketing often outperforms expectations when it comes to brand recall and loyalty.";
  const deck = makeDeck([
    makeSlide("slide_repeated_surface", 0, {
      title: "Start with The brand and cars Ferrari",
      learningGoal: repeatedClaim,
      keyPoints: [repeatedClaim],
      beginnerExplanation: repeatedClaim,
      advancedExplanation: repeatedClaim,
      examples: [repeatedClaim],
      visuals: {
        layoutTemplate: "hero-focus",
        accentColor: "C96F4A",
        heroStatement: repeatedClaim,
        cards: [
          {
            id: "card_repeated",
            title: "It also helps explain",
            body: repeatedClaim,
            tone: "accent",
          },
        ],
        callouts: [
          {
            id: "callout_repeated",
            label: "Opening cue",
            text: repeatedClaim,
            tone: "warning",
          },
        ],
        diagramNodes: [],
        diagramEdges: [],
        imageSlots: [],
      },
    }),
  ]);

  const result = validateDeck(deck);

  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "repeated_slide_surface" &&
        issue.severity === "error",
    ),
  );
});

test("deck validation rejects repeated claims across distinct visible field groups before five occurrences", () => {
  const repeatedClaim =
    "Scarcity makes Ferrari feel selective because production limits turn access into part of the brand story.";
  const deck = makeDeck([
    makeSlide("slide_repeated_groups", 0, {
      title: "Ferrari scarcity",
      learningGoal:
        "Explain how scarcity supports the Ferrari brand without repeating one claim everywhere.",
      keyPoints: [
        repeatedClaim,
        "Racing heritage gives the brand a performance anchor that is easy to recognize.",
        "Design consistency helps the cars remain identifiable across generations.",
      ],
      beginnerExplanation: repeatedClaim,
      advancedExplanation:
        "Brand scarcity works best when it is connected to product desirability and long-term identity.",
      visuals: {
        layoutTemplate: "hero-focus",
        accentColor: "C96F4A",
        heroStatement: repeatedClaim,
        cards: [
          {
            id: "card_repeated_groups",
            title: "Scarcity story",
            body: repeatedClaim,
            tone: "accent",
          },
        ],
        callouts: [],
        diagramNodes: [],
        diagramEdges: [],
        imageSlots: [],
      },
    }),
  ]);

  const result = validateDeck(deck);

  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "repeated_slide_surface" &&
        issue.severity === "error",
    ),
  );
});

test("narration validation reports ungrounded narration without rewriting it", () => {
  const deck = makeDeck([
    makeSlide("slide_before", 0),
    makeSlide("slide_focus", 1),
    makeSlide("slide_after", 2),
  ]);
  const badNarration = SlideNarrationSchema.parse({
    slideId: "slide_focus",
    narration: "Let us discuss software deployment pipelines and Git branching.",
    segments: ["Let us discuss software deployment pipelines and Git branching."],
    summaryLine: "Wrong topic",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateNarrations(deck, [badNarration], {
    generateMissing: false,
  });

  assert.equal(result.value[0]?.narration, badNarration.narration);
  assert.equal(result.repaired, false);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "narration_alignment" &&
        issue.severity === "error",
    ),
  );
});

test("narration validation reports weak presenter script issues without rebuilding copy", () => {
  const deck = makeDeck([makeSlide("slide_intro_claim_first", 0)]);
  const claimFirstNarration = SlideNarrationSchema.parse({
    slideId: "slide_intro_claim_first",
    narration:
      "AI can turn meeting audio or notes into an initial protocol structure with decisions and action items. Human review keeps the protocol accurate before it is shared with others. The workflow is useful only when sensitive details and policy boundaries are handled correctly. That makes the first example concrete enough to anchor the rest of the talk.",
    segments: [
      "AI can turn meeting audio or notes into an initial protocol structure with decisions and action items.",
      "Human review keeps the protocol accurate before it is shared with others.",
      "The workflow is useful only when sensitive details and policy boundaries are handled correctly.",
      "That makes the first example concrete enough to anchor the rest of the talk.",
    ],
    summaryLine: "Claim-first intro",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateNarrations(deck, [claimFirstNarration], {
    generateMissing: false,
  });

  assert.equal(result.value[0]?.narration, claimFirstNarration.narration);
  assert.equal(result.repaired, false);
  assert.ok(
    result.issues.some((issue) => issue.code === "narration_intro_missing"),
  );
});

test("well-anchored narration is not rejected just because it shares one visible phrase", () => {
  const deck = makeDeck([
    makeSlide("slide_before", 0),
    makeSlide("slide_focus", 1),
    makeSlide("slide_after", 2),
  ]);
  const narration = SlideNarrationSchema.parse({
    slideId: "slide_focus",
    narration:
      "The practical point here is that AI drafting gives a project team a first version of notes or a summary. That first version is useful because reviewers can check decisions, dates, names, and sensitive details before anything is shared. The workflow therefore separates drafting from approval, which keeps the tool useful without treating it as the final authority.",
    segments: [
      "The practical point here is that AI drafting gives a project team a first version of notes or a summary.",
      "That first version is useful because reviewers can check decisions, dates, names, and sensitive details before anything is shared.",
      "The workflow therefore separates drafting from approval, which keeps the tool useful without treating it as the final authority.",
    ],
    summaryLine: "Anchored narration",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateNarrations(deck, [narration], {
    generateMissing: false,
  });

  assert.equal(result.repaired, false);
  assert.equal(
    result.issues.some((issue) => issue.code === "narration_alignment"),
    false,
  );
});

test("well-anchored narration remains stable for Swedish slide content", () => {
  const deck = makeDeck([
    makeSlide("slide_before", 0),
    makeSlide("slide_swedish", 1, {
      title: "AI-stöd i dagligt projektarbete",
      learningGoal:
        "Se hur AI kan skapa ett första utkast samtidigt som mänsklig granskning behåller ansvar.",
      keyPoints: [
        "AI kan sammanfatta anteckningar till ett första projektutkast.",
        "Mänsklig granskning kontrollerar beslut, datum och känsliga detaljer.",
        "Arbetsflödet skiljer utkast från slutligt godkännande.",
      ],
      beginnerExplanation:
        "AI-stöd är mest användbart när det skapar ett granskningsbart utkast.",
      advancedExplanation:
        "Säkrare projektarbete kräver att genererat material granskas innan det delas.",
    }),
    makeSlide("slide_after", 2),
  ]);
  const narration = SlideNarrationSchema.parse({
    slideId: "slide_swedish",
    narration:
      "AI kan hjälpa ett projektteam genom att sammanfatta anteckningar till ett första utkast. Därefter behöver människor granska beslut, datum och känsliga detaljer innan materialet delas. Poängen är att arbetsflödet skiljer snabb utkastshjälp från slutligt godkännande.",
    segments: [
      "AI kan hjälpa ett projektteam genom att sammanfatta anteckningar till ett första utkast.",
      "Därefter behöver människor granska beslut, datum och känsliga detaljer innan materialet delas.",
      "Poängen är att arbetsflödet skiljer snabb utkastshjälp från slutligt godkännande.",
    ],
    summaryLine: "Förankrad narration",
    promptsForPauses: [],
    suggestedTransition: "Fortsätt.",
  });

  const result = validateNarrations(deck, [narration], {
    generateMissing: false,
  });

  assert.equal(
    result.issues.some((issue) => issue.code === "narration_alignment"),
    false,
  );
});

test("missing narration is reported instead of generated from slide anchors", () => {
  const deck = makeDeck([makeSlide("slide_missing", 0)]);

  const result = validateNarrations(deck, []);

  assert.deepEqual(result.value, []);
  assert.equal(result.repaired, false);
  assert.ok(result.issues.some((issue) => issue.code === "narration_missing"));
});

test("over-segmented narration is reported without being shortened locally", () => {
  const deck = makeDeck([
    makeSlide("slide_before", 0),
    makeSlide("slide_many_segments", 1),
    makeSlide("slide_after", 2),
  ]);
  const segments = [
    "First, AI drafting can turn project notes into a first summary for review.",
    "Second, the reviewer checks decisions and dates before the summary is shared.",
    "Third, sensitive details are removed or corrected during that review step.",
    "Next, the team separates generated drafts from approved project material.",
    "Then, approval stays with the accountable human owner.",
    "Finally, the workflow keeps speed and responsibility connected.",
  ];
  const narration = SlideNarrationSchema.parse({
    slideId: "slide_many_segments",
    narration: segments.join(" "),
    segments,
    summaryLine: "Too many segments",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateNarrations(deck, [narration], {
    generateMissing: false,
  });

  assert.equal(result.value[0]?.segments.length, segments.length);
  assert.equal(result.repaired, false);
  assert.ok(
    result.issues.some((issue) => issue.code === "narration_segment_count"),
  );
});
