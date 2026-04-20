import test from "node:test";
import assert from "node:assert/strict";

import { validateAndRepairDeck, validateAndRepairNarrations } from "@slidespeech/core";
import { DeckSchema, SlideNarrationSchema } from "@slidespeech/types";

test("deck validation normalizes slide order and records validation metadata", () => {
  const deck = DeckSchema.parse({
    id: "deck_1",
    title: "Validation test",
    topic: "State machines",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "State machines",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_1",
        order: 3,
        title: "Intro",
        learningGoal: "Learn the basics.",
        keyPoints: ["State", "Transition", "Flow"],
        beginnerExplanation: "A state machine moves between states.",
        advancedExplanation: "Transitions define control flow.",
      },
    ],
    createdAt: "2026-04-12T10:00:00.000Z",
    updatedAt: "2026-04-12T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);

  assert.equal(result.value.slides[0]?.order, 0);
  assert.equal(result.value.metadata.validation?.repaired, true);
  assert.ok((result.value.metadata.validation?.issues.length ?? 0) > 0);
});

test("narration validation reanchors narration that is not tied to the slide", () => {
  const deck = DeckSchema.parse({
    id: "deck_2",
    title: "Volvo deck",
    topic: "Volvo Cars and Safety",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "Volvo Cars and Safety",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_1",
        order: 0,
        title: "Why Volvo Safety Matters",
        learningGoal: "Understand why Volvo focuses on safety.",
        keyPoints: ["Cars protect people", "Seatbelts matter", "Safety is a core theme"],
        beginnerExplanation: "Volvo wants people in the car to stay safe.",
        advancedExplanation: "Safety engineering is central to the brand.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [
            {
              id: "card_generic_1",
              title: "Key point 1",
              body: "Essential ingredients shape the balance, texture, or overall character of making the perfect salsa dip.",
              tone: "accent",
            },
          ],
          callouts: [],
          diagramNodes: [
            {
              id: "node_generic_1",
              label: "Essential ingredients shape the balance, texture, or overall character of making the perfect salsa dip.",
              tone: "info",
            },
          ],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-12T10:00:00.000Z",
    updatedAt: "2026-04-12T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const badNarration = SlideNarrationSchema.parse({
    slideId: "slide_1",
    narration: "Let us discuss software deployment pipelines and Git branching.",
    segments: ["Let us discuss software deployment pipelines and Git branching."],
    summaryLine: "Wrong topic",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateAndRepairNarrations(deck, [badNarration]);

  assert.match(result.value[0]?.narration ?? "", /Volvo|safety|seatbelts|cars/i);
  assert.equal(result.repaired, true);
});

test("narration validation rebuilds audience-facing narration without slide-meta phrasing", () => {
  const deck = DeckSchema.parse({
    id: "deck_narration_style",
    title: "System Verification onboarding",
    topic: "System Verification",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "System Verification",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_style_1",
        order: 0,
        title: "Global Delivery and QA Operations",
        learningGoal: "Understand how global delivery and QA operations fit together.",
        keyPoints: [
          "Our distributed model leverages regional expertise while maintaining centralized governance over QA Operations and delivery pipelines.",
          "Our reach is European but our delivery is unified.",
          "Whether you are in Sweden or Poland, QA Operations ensures the workflow remains consistent.",
        ],
        beginnerExplanation:
          "The company combines regional teams with one shared way of running QA operations.",
        advancedExplanation:
          "This operating model lets the company scale delivery without losing consistency or oversight.",
        visuals: {
          layoutTemplate: "two-column-callouts",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-14T10:00:00.000Z",
    updatedAt: "2026-04-14T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const weakNarration = SlideNarrationSchema.parse({
    slideId: "slide_style_1",
    narration:
      "On this slide, the first key point is that our distributed model leverages regional expertise while maintaining centralized governance over QA Operations and delivery pipelines.",
    segments: [
      "On this slide, the first key point is that our distributed model leverages regional expertise while maintaining centralized governance over QA Operations and delivery pipelines.",
    ],
    summaryLine: "Weak narration",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateAndRepairNarrations(deck, [weakNarration]);
  const narration = result.value[0]?.narration ?? "";
  const repairedNarration = result.value[0];

  assert.equal(result.repaired, true);
  assert.ok(repairedNarration);
  assert.notEqual(narration, weakNarration.narration);
  assert.equal(repairedNarration.segments.length >= 4, true);
  assert.equal(narration.length > weakNarration.narration.length, true);
});

test("repaired narration keeps transition metadata separate from played segments", () => {
  const deck = DeckSchema.parse({
    id: "deck_narration_transition",
    title: "AI tools at VGR",
    topic: "AI tools in daily work",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "AI tools in daily work",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_transition_1",
        order: 0,
        title: "Using AI as a drafting assistant",
        learningGoal: "Understand where AI drafting support helps without replacing judgement.",
        keyPoints: [
          "AI drafting speeds up first-pass summaries and planning notes.",
          "Human review still decides what is accurate, useful, and safe to share.",
          "Sensitive information needs the same data-handling discipline as any other work.",
        ],
        beginnerExplanation:
          "AI works best here as a fast first draft, not as an automatic decision-maker.",
        advancedExplanation:
          "The value comes from reducing repetitive drafting work while keeping accountability with the team.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_transition_2",
        order: 1,
        title: "Evaluating output safely",
        learningGoal: "Check AI output against quality and policy constraints.",
        keyPoints: [
          "Teams compare generated output with approved source material.",
          "Quality checks catch hallucinations and unsafe wording before reuse.",
          "The workflow stays accountable because review happens before adoption.",
        ],
        beginnerExplanation:
          "The next step is to verify what the tool produced before anyone relies on it.",
        advancedExplanation:
          "Safe adoption depends on review discipline rather than model confidence alone.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const weakNarration = SlideNarrationSchema.parse({
    slideId: "slide_transition_1",
    narration:
      "On this slide, the first key point is that AI drafting speeds up first-pass summaries and planning notes.",
    segments: [
      "On this slide, the first key point is that AI drafting speeds up first-pass summaries and planning notes.",
    ],
    summaryLine: "Weak narration",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateAndRepairNarrations(deck, [weakNarration]);
  const repaired = result.value[0];

  assert.ok(repaired);
  assert.equal(repaired.segments.length >= 4, true);
  assert.equal(
    repaired.segments.some((segment) => /evaluating output safely/i.test(segment)),
    false,
  );
  assert.match(repaired.suggestedTransition, /Evaluating output safely/i);
});

test("well-anchored narration is not reanchored just because it shares one visible phrase", () => {
  const deck = DeckSchema.parse({
    id: "deck_narration_anchor",
    title: "AI tools at VGR",
    topic: "AI tools in daily work",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "AI tools in daily work",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_anchor_intro",
        order: 0,
        title: "Introduction",
        learningGoal: "Set up the topic.",
        keyPoints: [
          "AI support changes daily work by speeding up drafting and comparison tasks.",
          "Teams still review outputs before using them in real decisions.",
          "The useful question is where the tool saves time without creating risk.",
        ],
        beginnerExplanation:
          "This opening slide explains why AI support matters in practical work.",
        advancedExplanation:
          "The talk frames AI as a productivity aid that still depends on accountable review.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_anchor_focus",
        order: 1,
        title: "AI drafting in project work",
        learningGoal: "See where AI drafting support helps and where judgement still matters.",
        keyPoints: [
          "AI drafting speeds up first-pass summaries and planning notes.",
          "Human review still decides what is accurate, useful, and safe to share.",
          "Sensitive information needs the same data-handling discipline as any other work.",
        ],
        beginnerExplanation:
          "The slide shows AI as a drafting aid that saves time without replacing judgement.",
        advancedExplanation:
          "A strong workflow combines drafting speed with review, accountability, and data discipline.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const goodNarration = SlideNarrationSchema.parse({
    slideId: "slide_anchor_focus",
    narration:
      "AI drafting speeds up first-pass summaries and planning notes. In practice, that matters because teams can compare ideas faster before they commit to a final plan. The important boundary is that people still review what is accurate, useful, and safe to share.",
    segments: [
      "AI drafting speeds up first-pass summaries and planning notes.",
      "In practice, that matters because teams can compare ideas faster before they commit to a final plan.",
      "The important boundary is that people still review what is accurate, useful, and safe to share.",
    ],
    summaryLine: "AI drafting support",
    promptsForPauses: [],
    suggestedTransition: "Bridge clearly into the next slide.",
  });

  const isolatedResult = validateAndRepairNarrations(deck, [goodNarration], {
    generateMissing: false,
  });

  assert.equal(isolatedResult.repaired, false);
  assert.equal(isolatedResult.value[0]?.narration, goodNarration.narration);
});

test("well-anchored narration remains stable for Swedish slide content", () => {
  const deck = DeckSchema.parse({
    id: "deck_narration_sv",
    title: "AI-stöd i Västra Götalandsregionen",
    topic: "AI-stöd i dagligt arbete",
    summary: "Sammanfattning",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "AI-stöd i dagligt arbete",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_sv_intro",
        order: 0,
        title: "AI som skrivstöd i projektarbete",
        learningGoal: "Se var AI-stöd hjälper i textarbete utan att ersätta omdöme.",
        keyPoints: [
          "AI-stöd snabbar upp första utkast och planeringsanteckningar.",
          "Mänsklig granskning avgör fortfarande vad som är korrekt och säkert att dela.",
          "Känslig information kräver samma disciplin som i annat kvalitetsarbete.",
        ],
        beginnerExplanation:
          "Poängen är att använda AI som ett snabbt första steg, inte som en automatisk beslutsfattare.",
        advancedExplanation:
          "Ett hållbart arbetssätt kombinerar snabbare skrivarbete med tydligt ansvar för granskning.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_sv_next",
        order: 1,
        title: "Kontroll före användning",
        learningGoal: "Kontrollera AI-utkast innan någon använder dem i skarpa beslut.",
        keyPoints: [
          "Teamet jämför AI-utkast med godkänt källmaterial.",
          "Granskning fångar hallucinationer och osäker formulering innan återanvändning.",
          "Arbetsflödet är säkert först när någon tar ansvar för kontrollen.",
        ],
        beginnerExplanation:
          "Nästa steg är att kontrollera det verktyget producerade innan någon litar på det.",
        advancedExplanation:
          "Säker användning beror på granskningsdisciplin snarare än modellens självförtroende.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "sv",
    },
  });

  const goodNarration = SlideNarrationSchema.parse({
    slideId: "slide_sv_intro",
    narration:
      "AI-stöd snabbar upp första utkast och planeringsanteckningar. I praktiken betyder det att teamet kan jämföra idéer snabbare innan någon låser en slutlig plan. Den viktiga gränsen är att människor fortfarande granskar vad som är korrekt och säkert att dela.",
    segments: [
      "AI-stöd snabbar upp första utkast och planeringsanteckningar.",
      "I praktiken betyder det att teamet kan jämföra idéer snabbare innan någon låser en slutlig plan.",
      "Den viktiga gränsen är att människor fortfarande granskar vad som är korrekt och säkert att dela.",
      "Det gör AI till ett stöd i arbetet snarare än en ersättning för omdöme.",
    ],
    summaryLine: "AI som skrivstöd",
    promptsForPauses: [],
    suggestedTransition: "Gå vidare till nästa del.",
  });

  const result = validateAndRepairNarrations(deck, [goodNarration], {
    generateMissing: false,
  });

  assert.equal(result.repaired, false);
  assert.equal(result.value[0]?.narration, goodNarration.narration);
});

test("repaired narration prefers concrete speaker notes and examples over slide-goal phrasing", () => {
  const deck = DeckSchema.parse({
    id: "deck_narration_priority",
    title: "Salsa structure",
    topic: "Making the perfect salsa dip",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "Making the perfect salsa dip",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_salsa_intro",
        order: 0,
        title: "Opening",
        learningGoal: "See which ingredients, steps, and final adjustments define making the perfect salsa dip.",
        keyPoints: [
          "Fresh tomatoes and lime give the salsa brightness before any seasoning changes the balance.",
          "Salt and rest time control how much moisture stays in the bowl.",
          "Final tasting decides whether the dip needs more acid, heat, or herbs.",
        ],
        speakerNotes: [
          "Start with the practical picture: if the tomatoes are watery, the whole bowl feels flat before you even adjust the seasoning.",
          "Point out that resting the salsa is not decoration. It is what lets salt and acid settle into the vegetables.",
        ],
        beginnerExplanation:
          "This slide frames the ingredients, method, and final adjustment as one practical sequence.",
        advancedExplanation:
          "The quality of the final bowl depends on moisture control and staged tasting rather than one secret ingredient.",
        examples: [
          "A batch with Roma tomatoes usually holds together better than one made with very watery tomatoes.",
        ],
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_salsa_next",
        order: 1,
        title: "Rest and taste",
        learningGoal: "See why resting and tasting change the result.",
        keyPoints: [
          "Resting gives the chopped vegetables time to release and redistribute moisture.",
          "Tasting after a short rest reveals whether the lime or salt is still out of balance.",
          "A final herb adjustment should happen only after the base flavor is stable.",
        ],
        beginnerExplanation:
          "The next slide shows why waiting a little changes what the salsa tastes like.",
        advancedExplanation:
          "Rest time changes texture and flavor integration before the final correction step.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-19T10:00:00.000Z",
    updatedAt: "2026-04-19T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const weakNarration = SlideNarrationSchema.parse({
    slideId: "slide_salsa_intro",
    narration: "See which ingredients, steps, and final adjustments define making the perfect salsa dip.",
    segments: [
      "See which ingredients, steps, and final adjustments define making the perfect salsa dip.",
    ],
    summaryLine: "Weak intro",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateAndRepairNarrations(deck, [weakNarration], {
    generateMissing: false,
  });

  const repaired = result.value[0];
  assert.ok(repaired);
  assert.equal(result.repaired, true);
  assert.equal(
    repaired.segments.some((segment) =>
      /watery|resting the salsa|roma tomatoes|moisture control/i.test(segment),
    ),
    true,
  );
  assert.equal(
    repaired.segments.some((segment) =>
      /see which ingredients, steps, and final adjustments define/i.test(segment),
    ),
    false,
  );
});

test("intro narration repair can borrow concrete detail from later slides when the intro copy is generic", () => {
  const deck = DeckSchema.parse({
    id: "deck_narration_intro_deck_support",
    title: "Salsa structure",
    topic: "Making the perfect salsa dip",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "Making the perfect salsa dip",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro_generic",
        order: 0,
        title: "Making the perfect salsa dip",
        learningGoal: "See which ingredients, steps, and final adjustments define making the perfect salsa dip.",
        keyPoints: [
          "The starting ingredients and inputs shape making the perfect salsa dip before any main steps begin.",
          "The sequence of preparation steps changes texture, balance, and consistency.",
          "Final tasting and adjustment determine when making the perfect salsa dip is ready.",
        ],
        beginnerExplanation:
          "This opening slide frames the ingredients, method, and final adjustment as one practical sequence.",
        advancedExplanation:
          "The final bowl depends on moisture control and staged tasting rather than one secret ingredient.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_intro_support",
        order: 1,
        title: "Essential ingredients",
        learningGoal: "See which inputs shape the flavor, balance, and texture of making the perfect salsa dip.",
        keyPoints: [
          "Fresh lime and ripe tomatoes create the bright base flavor.",
          "Salt controls how much moisture stays in the bowl.",
          "The chili choice changes whether the salsa lands sharp or smoky.",
        ],
        speakerNotes: [
          "If the tomatoes are watery, the whole bowl feels flat before seasoning can rescue it.",
        ],
        beginnerExplanation:
          "The right ingredients create balance before any final adjustment happens.",
        advancedExplanation:
          "Moisture control and acidity determine whether the texture stays cohesive.",
        examples: [
          "Roma tomatoes usually hold together better than very watery salad tomatoes.",
        ],
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-19T10:00:00.000Z",
    updatedAt: "2026-04-19T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const weakNarration = SlideNarrationSchema.parse({
    slideId: "slide_intro_generic",
    narration: "See which ingredients, steps, and final adjustments define making the perfect salsa dip.",
    segments: [
      "See which ingredients, steps, and final adjustments define making the perfect salsa dip.",
    ],
    summaryLine: "Weak intro",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateAndRepairNarrations(deck, [weakNarration], {
    generateMissing: false,
  });

  const repaired = result.value[0];
  assert.ok(repaired);
  assert.equal(result.repaired, true);
  assert.equal(
    repaired.segments.some((segment) =>
      /watery|roma tomatoes|moisture control/i.test(segment),
    ),
    true,
  );
  assert.equal(
    repaired.segments.some((segment) =>
      /see which ingredients, steps, and final adjustments define/i.test(segment),
    ),
    false,
  );
});

test("intro narration repair avoids repeated deck boilerplate even when the deck contains one stronger later example", () => {
  const repeatedDeckLine =
    "Whether you need expert support, project-specific QA, or strategic insights, we help you optimize software quality and move forward safely.";

  const deck = DeckSchema.parse({
    id: "deck_narration_intro_repetition",
    title: "System Verification",
    topic: "System Verification",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "System Verification",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_sv_intro_generic",
        order: 0,
        title: "System Verification",
        learningGoal: "See what System Verification is and why it matters.",
        keyPoints: [
          "Core systems and focus areas is one concrete way to understand System Verification.",
          "Real-world applications is one concrete way to understand System Verification.",
          "Define System Verification and its role in ensuring software quality and safety.",
        ],
        beginnerExplanation:
          "This opening slide frames the definition, scope, and importance of System Verification.",
        advancedExplanation:
          "The opening slide establishes the concept before moving into concrete use cases.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_sv_generic_1",
        order: 1,
        title: "Core systems and focus areas",
        learningGoal: "See the key components and focus areas of System Verification.",
        keyPoints: [repeatedDeckLine],
        examples: [repeatedDeckLine],
        beginnerExplanation: repeatedDeckLine,
        advancedExplanation: repeatedDeckLine,
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_sv_generic_2",
        order: 2,
        title: "Real-world applications",
        learningGoal: "See how System Verification appears in practice.",
        keyPoints: [repeatedDeckLine],
        examples: [repeatedDeckLine],
        beginnerExplanation: repeatedDeckLine,
        advancedExplanation: repeatedDeckLine,
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_sv_unique_example",
        order: 3,
        title: "Operational examples",
        learningGoal: "See concrete verification examples.",
        keyPoints: [
          "Verification catches risky data changes before they spread into production.",
          "Automation provides repeatable evidence rather than one-off judgement calls.",
          "Teams can spot drift earlier when checks run continuously.",
        ],
        speakerNotes: [
          "Focus on the mechanism of validation: how raw data becomes trusted information.",
          "Highlight the operational consequence when verification is skipped.",
        ],
        examples: [
          "Automated scripts can verify database integrity during a migration before users are affected.",
          "A new server cluster can be validated against security policies before it goes live.",
        ],
        beginnerExplanation:
          "The slide turns the concept into concrete checks on systems and data.",
        advancedExplanation:
          "Operational verification creates evidence before incidents become user-facing failures.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-19T10:00:00.000Z",
    updatedAt: "2026-04-19T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const weakNarration = SlideNarrationSchema.parse({
    slideId: "slide_sv_intro_generic",
    narration: "See what System Verification is and why it matters.",
    segments: ["See what System Verification is and why it matters."],
    summaryLine: "Weak intro",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateAndRepairNarrations(deck, [weakNarration], {
    generateMissing: false,
  });

  const repaired = result.value[0];
  assert.ok(repaired);
  assert.equal(result.repaired, true);
  assert.equal(
    repaired.segments.some((segment) =>
      /Whether you need expert support, project-specific QA, or strategic insights/i.test(segment),
    ),
    false,
  );
  assert.equal(
    repaired.segments.some((segment) =>
      /Focus on the mechanism|Highlight the operational consequence/i.test(segment),
    ),
    false,
  );
});

test("intro narration repair keeps a company onboarding opening on-slide when the opening already covers the role", () => {
  const deck = DeckSchema.parse({
    id: "deck_narration_company_intro",
    title: "System Verification onboarding",
    topic: "System Verification",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "mixed",
      topic: "System Verification",
      sourceIds: ["https://www.systemverification.com/"],
    },
    slides: [
      {
        id: "slide_company_intro",
        order: 0,
        title: "System Verification",
        learningGoal:
          "See who System Verification is, what it offers, and how a newcomer can place it in day-to-day work.",
        keyPoints: [
          "System Verification is the organization this onboarding overview introduces.",
          "Understanding System Verification starts with what it offers, how it works, and one concrete example of the value it creates.",
          "System Verification becomes easier to place when one concrete service area or delivery example is visible.",
        ],
        beginnerExplanation:
          "System Verification is the organization this onboarding overview introduces. Understanding System Verification starts with what it offers, how it works, and one concrete example of the value it creates.",
        advancedExplanation:
          "System Verification becomes easier to place when one concrete service area or delivery example is visible.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_company_example",
        order: 1,
        title: "Concrete client example",
        learningGoal: "See one concrete outcome from client delivery.",
        keyPoints: [
          "For a financial client, we implemented a compliance-focused regression suite that reduced audit findings by 40%.",
          "The delivery model integrates QA operations with client-specific compliance goals.",
          "The outcome was a more reliable release process under stricter audit pressure.",
        ],
        beginnerExplanation:
          "The slide turns delivery into one concrete client example with a clear operational result.",
        advancedExplanation:
          "It shows how tailored QA work becomes visible through a specific delivery outcome.",
        examples: [
          "For a financial client, we implemented a compliance-focused regression suite that reduced audit findings by 40%.",
        ],
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-19T10:00:00.000Z",
    updatedAt: "2026-04-19T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const weakNarration = SlideNarrationSchema.parse({
    slideId: "slide_company_intro",
    narration: "See who System Verification is and what it offers.",
    segments: ["See who System Verification is and what it offers."],
    summaryLine: "Weak intro",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateAndRepairNarrations(deck, [weakNarration], {
    generateMissing: false,
  });

  const repaired = result.value[0];
  assert.ok(repaired);
  assert.equal(result.repaired, true);
  assert.equal(
    repaired.segments.some((segment) => /financial client|audit findings/i.test(segment)),
    false,
  );
  assert.equal(
    repaired.segments.some((segment) => /organization this onboarding overview introduces|what it offers/i.test(segment)),
    true,
  );
});

test("missing Swedish narration is rebuilt from slide content without English scaffold phrases", () => {
  const deck = DeckSchema.parse({
    id: "deck_narration_sv_missing",
    title: "AI-stöd i Västra Götalandsregionen",
    topic: "AI-stöd i dagligt arbete",
    summary: "Sammanfattning",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "AI-stöd i dagligt arbete",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_sv_missing",
        order: 0,
        title: "AI som skrivstöd i projektarbete",
        learningGoal: "Se var AI-stöd hjälper i textarbete utan att ersätta omdöme.",
        keyPoints: [
          "AI-stöd snabbar upp första utkast och planeringsanteckningar.",
          "Mänsklig granskning avgör fortfarande vad som är korrekt och säkert att dela.",
          "Känslig information kräver samma disciplin som i annat kvalitetsarbete.",
        ],
        beginnerExplanation:
          "Poängen är att använda AI som ett snabbt första steg, inte som en automatisk beslutsfattare.",
        advancedExplanation:
          "Ett hållbart arbetssätt kombinerar snabbare skrivarbete med tydligt ansvar för granskning.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_sv_missing_next",
        order: 1,
        title: "Kontroll före användning",
        learningGoal: "Kontrollera AI-utkast innan någon använder dem i skarpa beslut.",
        keyPoints: [
          "Teamet jämför AI-utkast med godkänt källmaterial.",
          "Granskning fångar hallucinationer och osäker formulering innan återanvändning.",
          "Arbetsflödet är säkert först när någon tar ansvar för kontrollen.",
        ],
        beginnerExplanation:
          "Nästa steg är att kontrollera det verktyget producerade innan någon litar på det.",
        advancedExplanation:
          "Säker användning beror på granskningsdisciplin snarare än modellens självförtroende.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "sv",
    },
  });

  const result = validateAndRepairNarrations(deck, [], {
    generateMissing: true,
  });

  const rebuiltNarration = result.value[0];
  assert.ok(rebuiltNarration);
  assert.equal(result.repaired, true);
  assert.equal((rebuiltNarration?.segments.length ?? 0) >= 4, true);
  assert.match(rebuiltNarration?.narration ?? "", /AI-stöd|granskning|kvalitetsarbete/u);
  assert.doesNotMatch(
    rebuiltNarration?.narration ?? "",
    /today i want to orient you|a practical point here is that|another thing to notice is that|this also means that/i,
  );
});

test("over-segmented narration is rebuilt into a bounded number of spoken beats", () => {
  const deck = DeckSchema.parse({
    id: "deck_narration_segment_limit",
    title: "System Verification onboarding",
    topic: "System Verification",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "System Verification",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_segment_limit",
        order: 0,
        title: "System Verification",
        learningGoal:
          "See how system Verification supports software reliability and compliance.",
        keyPoints: [
          "System verification confirms that software behaves as intended before release.",
          "The process reduces delivery risk by catching failures before they spread.",
          "Reliable verification supports compliance, trust, and operational stability.",
        ],
        beginnerExplanation:
          "The main idea is that structured verification turns quality from guesswork into evidence.",
        advancedExplanation:
          "Verification connects requirements, implementation checks, and release confidence into one disciplined flow.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const overSegmentedNarration = SlideNarrationSchema.parse({
    slideId: "slide_segment_limit",
    narration:
      "Welcome everyone. System verification matters. It reduces risk. It catches failures. It supports compliance. It builds trust. It protects releases.",
    segments: [
      "Welcome everyone.",
      "System verification matters.",
      "It reduces risk.",
      "It catches failures.",
      "It supports compliance.",
      "It builds trust.",
      "It protects releases.",
    ],
    summaryLine: "Too many beats",
    promptsForPauses: [],
    suggestedTransition: "Continue.",
  });

  const result = validateAndRepairNarrations(deck, [overSegmentedNarration], {
    generateMissing: false,
  });

  const repairedNarration = result.value[0];
  assert.ok(repairedNarration);
  assert.equal(result.repaired, true);
  assert.equal((repairedNarration?.segments.length ?? 0) <= 6, true);
});

test("deck validation rewrites meta presentation slides into topic-facing content", () => {
  const deck = DeckSchema.parse({
    id: "deck_3",
    title: "Warcraft onboarding",
    topic: "World of Warcraft onboarding",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "World of Warcraft onboarding",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_meta",
        order: 0,
        title: "Visual Storytelling Over Text",
        learningGoal:
          "Select high-quality screenshots to enhance visual storytelling instead of using dense text.",
        keyPoints: [
          "Players remember images better than paragraphs of text.",
          "Use clear, high-resolution in-game screenshots for every slide.",
          "Avoid cluttering slides with too much information at once.",
        ],
        beginnerExplanation:
          "Use screenshots and avoid cluttering slides so the audience stays interested.",
        advancedExplanation:
          "This slide should explain how to design better slides for the rest of the deck.",
        examples: [
          "Compare a text-heavy slide about lore to a single image of a dragon fight.",
        ],
        likelyQuestions: [
          "Where can I find good screenshots?",
        ],
        visualNotes: [
          "Use screenshots instead of text on slides.",
        ],
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          cards: [
            {
              id: "card_1",
              title: "Key point 1",
              body: "Players remember images better than paragraphs of text.",
              tone: "accent",
            },
          ],
          callouts: [
            {
              id: "callout_1",
              label: "Example",
              text: "Compare a text-heavy slide about lore to a single image.",
              tone: "info",
            },
          ],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-13T19:00:00.000Z",
    updatedAt: "2026-04-13T19:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];

  assert.equal(result.repaired, true);
  assert.ok(
    result.issues.some((issue) => issue.code === "meta_presentation_slide_repaired"),
  );
  assert.ok(repairedSlide);
  assert.doesNotMatch(
    repairedSlide?.keyPoints.join(" ") ?? "",
    /for every slide|avoid clutter|text-heavy slide|use screenshots/i,
  );
  assert.match(
    repairedSlide?.keyPoints.join(" ") ?? "",
    /World of Warcraft onboarding/i,
  );
});

test("deck validation does not allow generic presentation prompts to disable meta-slide repair", () => {
  const deck = DeckSchema.parse({
    id: "deck_4",
    title: "Company onboarding",
    topic: "Create an onboarding presentation about our company",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "Create an onboarding presentation about our company",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_meta_1",
        order: 0,
        title: "Welcome: Why This Matters",
        learningGoal: "Orient the audience to the importance of structured onboarding presentations.",
        keyPoints: [
          "Onboarding sets the tone for a new employee's entire journey.",
          "Clear introductions reduce early turnover and confusion.",
          "This session provides a blueprint for your first deck.",
        ],
        beginnerExplanation:
          "This slide explains why structured onboarding presentations should be used.",
        advancedExplanation:
          "Use this slide to frame the rest of the presentation process for the audience.",
        examples: ["Think of moving into a new house and getting the keys right away."],
        likelyQuestions: ["How long should this presentation be?"],
        visualNotes: ["Use a clean opening slide for the onboarding presentation."],
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_meta_2",
        order: 1,
        title: "How to structure onboarding slides",
        learningGoal: "Show how to create slides that are easy to follow.",
        keyPoints: [
          "Keep every slide visually simple.",
          "Use a short opener before each section.",
          "Avoid clutter and long text blocks.",
        ],
        beginnerExplanation:
          "Good onboarding slides are easier to understand when you avoid clutter.",
        advancedExplanation:
          "This slide gives slide-building guidance instead of company-facing content.",
        examples: ["Replace a dense company slide with one strong image and three bullets."],
        likelyQuestions: ["What should every slide contain?"],
        visualNotes: ["Use clean slide design."],
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-13T21:00:00.000Z",
    updatedAt: "2026-04-13T21:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);

  assert.equal(result.repaired, true);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "meta_presentation_slide_repaired" ||
        issue.code === "deck_wide_meta_presentation_repaired",
    ),
  );
  assert.doesNotMatch(
    result.value.slides.map((slide) => slide.keyPoints.join(" ")).join(" "),
    /blueprint for your first deck|what should every slide contain|avoid clutter/i,
  );
});

test("deck-wide meta repair preserves slide-specific facts when they exist", () => {
  const deck = DeckSchema.parse({
    id: "deck_5",
    title: "Foundations of System Verification for New Team Members",
    topic: "System Verification",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "mixed",
      topic: "System Verification",
      sourceIds: ["https://www.systemverification.com/"],
    },
    slides: [
      {
        id: "slide_meta_3",
        order: 0,
        title: "Our Global QA Operations and Delivery Teams",
        learningGoal:
          "Keep the audience focused on System Verification itself rather than on how slides should be constructed.",
        keyPoints: [
          "System Verification should be understood through one clear audience-facing example, not as slide-building advice.",
          "The audience should leave this moment with a stronger understanding of System Verification, not instructions for how to design slides.",
          "Every visible element should reinforce the main subject: System Verification.",
        ],
        speakerNotes: [
          "Our QA Operations span Sweden, Germany, Poland, Denmark, and Bosnia and Herzegovina.",
        ],
        beginnerExplanation:
          "System Verification should be explained as a concrete subject for the audience, not as guidance about presentation technique.",
        advancedExplanation:
          "This slide should frame System Verification as the actual subject of the talk and remove meta-discussion about how slides are built.",
        examples: [
          "A test case created in Germany is executed by a team member in Poland using the same tools.",
        ],
        likelyQuestions: ["How do time zones affect our workflow?"],
        visualNotes: [
          "Use visuals that clarify System Verification itself rather than explaining presentation mechanics.",
        ],
        visuals: {
          layoutTemplate: "two-column-callouts",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [
            {
              id: "callout_1",
              label: "Example",
              text: "A test case created in Germany is executed by a team member in Poland using the same tools.",
              tone: "info",
            },
          ],
          diagramNodes: [
            {
              id: "node_1",
              label: "Key locations include Sweden, Germany, Poland, Denmark, and Bosnia and Herzegovina.",
              tone: "accent",
            },
          ],
          diagramEdges: [],
          imageSlots: [
            {
              id: "image_1",
              prompt: "Create a topic-focused visual for System Verification that avoids presentation-design advice and reinforces the actual subject matter.",
            },
          ],
        },
      },
      {
        id: "slide_meta_4",
        order: 1,
        title: "Meta filler",
        learningGoal: "Use screenshots in every slide.",
        keyPoints: ["Use screenshots in every slide."],
        beginnerExplanation: "Use screenshots in every slide.",
        advancedExplanation: "Use screenshots in every slide.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-14T08:00:00.000Z",
    updatedAt: "2026-04-14T08:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];

  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "deck_wide_meta_presentation_repaired" ||
        issue.code === "meta_presentation_slide_repaired",
    ),
  );
  assert.match(repairedSlide?.keyPoints.join(" ") ?? "", /Sweden|Germany|Poland|Bosnia/i);
  assert.doesNotMatch(
    repairedSlide?.keyPoints.join(" ") ?? "",
    /slide-building advice|how to design slides|main subject/i,
  );
  assert.match(
    repairedSlide?.visuals.imagePrompt ?? "",
    /Global QA Operations|Germany|Poland|System Verification/i,
  );
});

test("deck validation ignores visual scaffolding when the audience-facing slide text is already clean", () => {
  const deck = DeckSchema.parse({
    id: "deck_visual_meta_only",
    title: "State machines",
    topic: "State machines",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "State machines",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_visual_meta_only_1",
        order: 0,
        title: "Why state machines matter",
        learningGoal: "See what a state machine is and why it matters in practical systems.",
        keyPoints: [
          "A state machine makes behavior easier to reason about when a system can only be in one mode at a time.",
          "Explicit transitions show what event or condition moves the system into a new state.",
          "The model reduces ambiguity because valid moves are visible and testable.",
        ],
        beginnerExplanation:
          "A state machine is a simple way to describe how a system changes from one clearly named mode to another.",
        advancedExplanation:
          "The structure becomes useful when reliability depends on explicit transitions instead of hidden branching logic.",
        examples: [
          "A login flow can move between signed out, waiting for verification, and signed in.",
        ],
        likelyQuestions: ["What triggers a transition from one state to another?"],
        visualNotes: ["Use a clean slide with visible arrows and avoid clutter."],
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          cards: [
            {
              id: "card_visual_meta_only_1",
              title: "Design cue",
              body: "Keep the slide visually simple so the arrows stand out.",
              tone: "neutral",
            },
          ],
          callouts: [
            {
              id: "callout_visual_meta_only_1",
              label: "Presentation note",
              text: "Use one clear diagram instead of several small screenshots.",
              tone: "info",
            },
          ],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_visual_meta_only_2",
        order: 1,
        title: "Transitions keep the logic visible",
        learningGoal: "See how transitions make system behavior easier to inspect and test.",
        keyPoints: [
          "A transition defines the exact event or condition that moves the system from one state to another.",
          "The explicit path makes it easier to test invalid moves and missing edge cases.",
          "Visible transitions also make it easier to explain the system to another engineer.",
        ],
        beginnerExplanation:
          "Transitions matter because they show exactly when the system is allowed to change behavior.",
        advancedExplanation:
          "Once transitions are explicit, the model can be inspected, tested, and reviewed without guessing hidden control flow.",
        examples: [
          "A payment flow might move from pending to authorized only after a gateway confirmation arrives.",
        ],
        likelyQuestions: ["Why not just use if-statements everywhere?"],
        visualNotes: ["Avoid text-heavy slide design and keep the diagram readable."],
        visuals: {
          layoutTemplate: "two-column-callouts",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-18T10:00:00.000Z",
    updatedAt: "2026-04-18T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 3,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);

  assert.ok(
    !(result.value.metadata.validation?.issues ?? []).some(
      (issue) =>
        issue.code === "deck_wide_meta_presentation_repaired" ||
        issue.code === "meta_presentation_slide_repaired",
    ),
  );
  assert.ok(
    (result.value.metadata.validation?.issues ?? []).every(
      (issue) => issue.code !== "slide_language_repaired",
    ),
  );
});

test("meta-slide repair removes imperative onboarding instructions and restores three topic-facing points", () => {
  const deck = DeckSchema.parse({
    id: "deck_6",
    title: "System Verification onboarding",
    topic: "System Verification",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "System Verification",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_meta_ops",
        order: 1,
        title: "Core Service Pillars and AI Acceleration",
        learningGoal: "Understand how core services work here.",
        keyPoints: [
          "These pillars function as integrated modules within our Quality Management solution, allowing scalable delivery.",
          "Walk through the two main pillars.",
          "Emphasize that this is one of our main differentiators in core messaging.",
        ],
        beginnerExplanation:
          "Use this slide to explain the two pillars before moving to the next slide.",
        advancedExplanation:
          "Direct new hires to review the internal portal for more details after the session.",
        visuals: {
          layoutTemplate: "two-column-callouts",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-14T10:00:00.000Z",
    updatedAt: "2026-04-14T10:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];

  assert.ok(repairedSlide);
  assert.equal(repairedSlide?.keyPoints.length, 3);
  assert.doesNotMatch(repairedSlide?.learningGoal ?? "", /understand the role of/i);
  assert.doesNotMatch(
    repairedSlide?.keyPoints.join(" ") ?? "",
    /walk through|direct new hires|internal portal|emphasize|core messaging|begin by|focus on|transition to|one concrete part of/i,
  );
  assert.match(repairedSlide?.keyPoints.join(" ") ?? "", /System Verification/i);
});

test("meta-slide repair fallback stays topic-neutral for non-business subjects", () => {
  const deck = DeckSchema.parse({
    id: "deck_7",
    title: "World of Warcraft science",
    topic: "World of Warcraft",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "World of Warcraft",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_meta_wow",
        order: 1,
        title: "Corrupted Blood outbreak",
        learningGoal: "Show how to present the outbreak clearly.",
        keyPoints: [
          "Walk through the outbreak using one screenshot per slide.",
          "Avoid clutter and keep the audience focused on the deck.",
          "Use this section to set up the next slide.",
        ],
        beginnerExplanation:
          "This slide should explain how to talk about the outbreak rather than the outbreak itself.",
        advancedExplanation:
          "Direct the audience to the next section instead of explaining the event.",
        visuals: {
          layoutTemplate: "hero-focus",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-14T12:00:00.000Z",
    updatedAt: "2026-04-14T12:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];
  const repairedText = [
    repairedSlide?.learningGoal ?? "",
    ...(repairedSlide?.keyPoints ?? []),
    repairedSlide?.beginnerExplanation ?? "",
  ].join(" ");

  assert.ok(repairedSlide);
  assert.match(repairedText, /World of Warcraft|Corrupted Blood/i);
  assert.doesNotMatch(
    repairedText,
    /delivery work|customer outcomes|day-to-day work/i,
  );
});

test("meta-slide repair prefers specific diagram facts over generic filler phrasing", () => {
  const deck = DeckSchema.parse({
    id: "deck_8",
    title: "World of Warcraft science",
    topic: "World of Warcraft",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "World of Warcraft",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_meta_wow_facts",
        order: 1,
        title: "Mechanics of the Corrupted Blood Incident",
        learningGoal: "Show why the incident matters.",
        keyPoints: [
          "Mechanics of the Corrupted Blood Incident helps explain how World of Warcraft works in practice.",
          "In practice, mechanics of the corrupted blood incident shapes how World of Warcraft works.",
          "A useful takeaway is that mechanics of the corrupted blood incident affects real decisions, risks, or outcomes.",
        ],
        beginnerExplanation:
          "This slide should explain how to talk about the outbreak rather than the outbreak itself.",
        advancedExplanation:
          "Direct the audience to the next section instead of explaining the event.",
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [
            {
              id: "node_1",
              label:
                "In 2005, a boss ability leaked from Zul'Gurub into the wider game population and spread rapidly.",
              tone: "info",
            },
            {
              id: "node_2",
              label:
                "Researchers later studied the incident as a model for contagion and quarantine behavior.",
              tone: "accent",
            },
          ],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-15T08:00:00.000Z",
    updatedAt: "2026-04-15T08:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];
  const repairedText = repairedSlide?.keyPoints.join(" ") ?? "";

  assert.match(repairedText, /2005|Zul'Gurub|researchers|contagion/i);
  assert.doesNotMatch(
    repairedText,
    /helps explain how World of Warcraft works in practice|affects real decisions, risks, or outcomes/i,
  );
});

test("language repair normalizes awkward learning goals and fragmentary key points", () => {
  const deck = DeckSchema.parse({
    id: "deck_language_repair",
    title: "World of Warcraft",
    topic: "World of Warcraft",
    summary: "Summary",
    pedagogicalProfile: {
      audienceLevel: "beginner",
      tone: "supportive and concrete",
      pace: "balanced",
      preferredExampleStyle: "real_world",
      wantsFrequentChecks: true,
      detailLevel: "standard",
    },
    source: {
      type: "topic",
      topic: "World of Warcraft",
      sourceIds: [],
    },
    slides: [
      {
        id: "slide_intro_anchor",
        order: 0,
        title: "World of Warcraft Overview",
        learningGoal: "Understand what World of Warcraft is and why it matters.",
        keyPoints: [
          "World of Warcraft is a long-running online role-playing game.",
          "Players share a persistent world with combat, travel, and social structures.",
          "Some in-game events later became useful research examples.",
        ],
        beginnerExplanation:
          "World of Warcraft is a long-running online role-playing game with a persistent world.",
        advancedExplanation:
          "Its systems and player behavior also made it interesting to researchers.",
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [],
          diagramEdges: [],
          imageSlots: [],
        },
      },
      {
        id: "slide_language_repair",
        order: 1,
        title: "What World of Warcraft is and why it matters",
        learningGoal: "Understand how why World of Warcraft matters contributes to World of Warcraft.",
        keyPoints: [
          "Mention that the world continues existing even when players log off.",
          "Players logging in weekly for updates like Midnight Now Live.",
          "Character classes define specific roles such as healing, damage dealing, or tanking during group activities.",
        ],
        beginnerExplanation:
          "Players navigate distinct zones that represent different environments and difficulty levels within the game world.",
        advancedExplanation:
          "Guilds organize players into persistent social groups for cooperative content completion.",
        visuals: {
          layoutTemplate: "three-step-flow",
          accentColor: "1C7C7D",
          cards: [],
          callouts: [],
          diagramNodes: [
            {
              id: "node_1",
              label:
                "Players navigate distinct zones that represent different environments and difficulty levels within the game world.",
              tone: "info",
            },
            {
              id: "node_2",
              label:
                "Character classes define specific roles such as healing, damage dealing, or tanking during group activities.",
              tone: "accent",
            },
            {
              id: "node_3",
              label:
                "Guilds organize players into persistent social groups for cooperative content completion.",
              tone: "success",
            },
          ],
          diagramEdges: [],
          imageSlots: [],
        },
      },
    ],
    createdAt: "2026-04-15T08:00:00.000Z",
    updatedAt: "2026-04-15T08:00:00.000Z",
    metadata: {
      estimatedDurationMinutes: 5,
      tags: [],
      language: "en",
    },
  });

  const result = validateAndRepairDeck(deck);
  const repairedSlide = result.value.slides[0];

  assert.equal(
    repairedSlide?.learningGoal,
    "Understand what World of Warcraft is and why it matters.",
  );
  assert.doesNotMatch(repairedSlide?.keyPoints.join(" ") ?? "", /^Mention that\b/i);
  assert.doesNotMatch(repairedSlide?.keyPoints.join(" ") ?? "", /Players logging in weekly/i);
  assert.match(
    repairedSlide?.keyPoints.join(" ") ?? "",
    /World of Warcraft|persistent world|research examples/i,
  );
});
