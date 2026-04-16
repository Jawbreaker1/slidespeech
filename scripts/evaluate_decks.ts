import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { evaluateDeckQuality } from "@slidespeech/core";

import { appContext } from "../apps/api/src/lib/context";
import { createPresentation } from "../apps/api/src/services/presentation-service";

type CoverageExpectation = {
  label: string;
  anyOf: string[];
};

type EvalScenario = {
  id?: string;
  prompt: string;
  coverageExpectations?: CoverageExpectation[];
};

const DEFAULT_SCENARIOS: EvalScenario[] = [
  {
    id: "systemverification-onboarding",
    prompt:
      "Create an onboarding presentation about our company. More information is available at https://www.systemverification.com/",
  },
  {
    id: "ai-teacher",
    prompt: "Explain how an interruption-aware AI teacher works",
  },
  {
    id: "volvo",
    prompt: "Create a short presentation about Volvo Cars",
  },
  {
    id: "spongebob",
    prompt: "Create a short presentation about SpongeBob SquarePants",
  },
  {
    id: "warcraft-corrupted-blood",
    prompt:
      "Create a short presentation about World of Warcraft. Include at least one slide about the Corrupted Blood plague event and explain why researchers were interested in it as a model of disease spread.",
    coverageExpectations: [
      {
        label: "plague event",
        anyOf: ["corrupted blood", "plague", "outbreak"],
      },
      {
        label: "research interest",
        anyOf: [
          "research",
          "researchers",
          "epidemiology",
          "epidemiological",
          "disease spread",
          "infection spread",
        ],
      },
    ],
  },
  {
    id: "vgr-ai-workshop",
    prompt:
      "Create a workshop presentation for project managers, product owners, and test leads at VGR, Västra Götalandsregionen. Use https://www.vgregion.se/ for grounding. The presentation should explain how they can use AI tools in their daily work, and it must include at least one practical exercise for the audience to complete during the workshop.",
    coverageExpectations: [
      {
        label: "target audience",
        anyOf: [
          "project manager",
          "product owner",
          "test lead",
          "projektledare",
          "produktägare",
          "testledare",
        ],
      },
      {
        label: "ai tools in daily work",
        anyOf: [
          "ai",
          "ai tools",
          "daily work",
          "planning",
          "prioritization",
          "requirements",
          "testing",
          "analysis",
        ],
      },
      {
        label: "workshop exercise",
        anyOf: [
          "exercise",
          "workshop task",
          "assignment",
          "participants",
          "audience task",
          "övning",
          "uppgift",
        ],
      },
    ],
  },
];

type ReportEntry = {
  prompt: string;
  sessionId?: string;
  deckId?: string;
  title?: string;
  overallScore?: number;
  summary?: string;
  warnings: string[];
  failures: string[];
  coverageWarnings: string[];
  error?: string;
};

const parseScenariosFromArgs = (): EvalScenario[] => {
  const cliTopics = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
  return cliTopics.length > 0
    ? cliTopics.map((value) => {
        const matchingScenario = DEFAULT_SCENARIOS.find(
          (scenario) => scenario.id === value || scenario.prompt === value,
        );

        return matchingScenario ?? { prompt: value };
      })
    : DEFAULT_SCENARIOS;
};

const deckSearchText = (deck: NonNullable<Awaited<ReturnType<typeof appContext.deckRepository.getById>>>): string =>
  [
    deck.title,
    deck.topic,
    deck.summary,
    ...deck.slides.flatMap((slide) => [
      slide.title,
      slide.learningGoal,
      slide.beginnerExplanation,
      slide.advancedExplanation,
      ...slide.keyPoints,
      ...slide.examples,
      ...slide.likelyQuestions,
      ...slide.visualNotes,
    ]),
  ]
    .join(" ")
    .toLowerCase();

const main = async () => {
  const scenarios = parseScenariosFromArgs();
  const report: ReportEntry[] = [];

  for (const scenario of scenarios) {
    console.log(`\n[eval] generating: ${scenario.prompt}`);

    try {
      const result = await createPresentation({
        topic: scenario.prompt,
        useWebResearch: true,
        targetDurationMinutes: 3,
        targetSlideCount: 4,
      });
      await appContext.sessionService.waitForBackgroundEnrichment(result.session.id);

      const finalizedDeck =
        (await appContext.deckRepository.getById(result.deck.id)) ?? result.deck;
      const finalizedSession =
        (await appContext.sessionRepository.getById(result.session.id)) ??
        result.session;
      const finalizedNarrations = finalizedDeck.slides
        .map((slide) => finalizedSession.narrationBySlideId[slide.id])
        .filter((narration): narration is NonNullable<typeof narration> => Boolean(narration));

      const evaluation =
        finalizedDeck.metadata.evaluation ??
        evaluateDeckQuality(finalizedDeck, finalizedNarrations);
      const searchText = deckSearchText(finalizedDeck);
      const warnings = evaluation.checks
        .filter((check) => check.status === "warning")
        .map((check) => `${check.code}: ${check.message}`);
      const failures = evaluation.checks
        .filter((check) => check.status === "fail")
        .map((check) => `${check.code}: ${check.message}`);
      const coverageWarnings = (scenario.coverageExpectations ?? [])
        .filter(
          (expectation) =>
            !expectation.anyOf.some((needle) => searchText.includes(needle.toLowerCase())),
        )
        .map(
          (expectation) =>
            `missing_coverage: expected deck coverage for ${expectation.label} via one of [${expectation.anyOf.join(", ")}]`,
        );

      console.log(
        `[eval] score=${evaluation.overallScore.toFixed(2)} warnings=${warnings.length} failures=${failures.length} coverageWarnings=${coverageWarnings.length} deck="${finalizedDeck.title}"`,
      );

      report.push({
        prompt: scenario.prompt,
        sessionId: result.session.id,
        deckId: finalizedDeck.id,
        title: finalizedDeck.title,
        overallScore: evaluation.overallScore,
        summary: evaluation.summary,
        warnings,
        failures,
        coverageWarnings,
      });
    } catch (error) {
      const message = (error as Error).message;
      console.error(`[eval] failed: ${message}`);
      report.push({
        prompt: scenario.prompt,
        warnings: [],
        failures: [],
        coverageWarnings: [],
        error: message,
      });
    }
  }

  const outputDir = resolve(process.cwd(), "data/evaluations");
  await mkdir(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, "latest.json");
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        report,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`\n[eval] wrote report to ${outputPath}`);

  const hasFailures = report.some(
    (entry) => entry.error || entry.failures.length > 0 || entry.coverageWarnings.length > 0,
  );
  if (hasFailures) {
    process.exitCode = 1;
  }
};

void main();
