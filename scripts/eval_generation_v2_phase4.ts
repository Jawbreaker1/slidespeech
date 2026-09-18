import "dotenv/config";

import { resolve } from "node:path";

import {
  createPromptClassificationStage,
  createRequestCaptureStage,
  createResearchPlanStage,
  executeGenerationStage,
  GenerationV2ResearchPipeline,
} from "@slidespeech/core";
import {
  FileGenerationTraceRecorder,
  HostedGenerationResearchProvider,
  OpenAICompatibleGenerationAgent,
} from "@slidespeech/providers";
import { GeneratePresentationRequestSchema } from "@slidespeech/types";
import type {
  GeneratePresentationRequest,
  GenerationStageResult,
  PromptClassification,
  ResearchPlan,
} from "@slidespeech/types";

type Scenario = {
  id: string;
  request: GeneratePresentationRequest;
};

const scenarios: Scenario[] = [
  {
    id: "topic_only_migration",
    request: GeneratePresentationRequestSchema.parse({
      topic:
        "Create a six-slide English teaching presentation for high-school students explaining how migratory birds navigate, what makes long-distance migration possible, and the main risks they face.",
    }),
  },
  {
    id: "explicit_source_http",
    request: GeneratePresentationRequestSchema.parse({
      topic:
        "Create an English teaching presentation explaining how HTTP enables communication between browsers and servers. Use https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview as the primary source and include requests, responses, and statelessness.",
      targetSlideCount: 5,
    }),
  },
  {
    id: "multi_source_accessibility",
    request: GeneratePresentationRequestSchema.parse({
      topic:
        "Create a five-slide English onboarding presentation about web accessibility using https://www.w3.org/WAI/fundamentals/accessibility-intro/ and https://www.w3.org/WAI/tips/designing/. Explain why accessibility matters and give practical design actions.",
      targetSlideCount: 5,
    }),
  },
  {
    id: "swedish_source_english_output",
    request: GeneratePresentationRequestSchema.parse({
      topic:
        "Create a five-slide English teaching presentation explaining the role of the Swedish Parliament and how parliamentary decisions are made. Ground it in the Swedish-language source https://www.riksdagen.se/sv/sa-fungerar-riksdagen/.",
      targetSlideCount: 5,
    }),
  },
];

const requiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be configured.`);
  }
  return value;
};

const summarizeStage = <TArtifact>(
  result: GenerationStageResult<TArtifact>,
) => ({
  status: result.status,
  durationMs: result.durationMs,
  telemetry: result.telemetry,
  warnings: result.warnings.map((warning) => warning.code),
  errors: result.errors.map((error) => ({
    code: error.code,
    message: error.message,
  })),
});

const runScenario = async (input: {
  scenario: Scenario;
  agent: OpenAICompatibleGenerationAgent;
  recorder: FileGenerationTraceRecorder;
}) => {
  const runId = `phase4_${input.scenario.id}_${Date.now().toString(36)}`;
  const request = await executeGenerationStage({
    definition: createRequestCaptureStage(),
    input: input.scenario.request,
    context: {
      runId,
      attempt: 1,
      inputArtifactIds: [],
      sourceIds: [],
    },
    recorder: input.recorder,
  });

  if (request.status !== "succeeded") {
    return {
      scenario: input.scenario.id,
      request: summarizeStage(request),
    };
  }

  const classification = await executeGenerationStage({
    definition: createPromptClassificationStage({ agent: input.agent }),
    input: request.artifact,
    context: {
      runId,
      attempt: 1,
      inputArtifactIds: [request.artifact.artifactId],
      sourceIds: [],
    },
    recorder: input.recorder,
  });

  if (classification.status !== "succeeded") {
    return {
      scenario: input.scenario.id,
      classification: summarizeStage(classification),
    };
  }

  const researchPlan = await executeGenerationStage({
    definition: createResearchPlanStage({ agent: input.agent }),
    input: {
      request: request.artifact,
      classification: classification.artifact,
    },
    context: {
      runId,
      attempt: 1,
      inputArtifactIds: [
        request.artifact.artifactId,
        classification.artifact.artifactId,
      ],
      sourceIds: classification.artifact.requestedSources.map(
        (source) => source.id,
      ),
    },
    recorder: input.recorder,
  });

  return {
    scenario: input.scenario.id,
    classification: {
      ...summarizeStage<PromptClassification>(classification),
      subject: classification.artifact.subject,
      language: classification.artifact.language,
      deckMode: classification.artifact.deckMode,
      groundingMode: classification.artifact.groundingMode,
      requestedSources: classification.artifact.requestedSources,
      requestedCoverage: classification.artifact.requestedCoverage,
    },
    researchPlan: {
      ...summarizeStage<ResearchPlan>(researchPlan),
      ...(researchPlan.status !== "failed"
        ? {
            canExecute: researchPlan.artifact?.canExecute,
            researchQuestions: researchPlan.artifact?.researchQuestions,
            evidenceRequirements:
              researchPlan.artifact?.evidenceRequirements,
            sourceTargets: researchPlan.artifact?.sourceTargets,
          }
        : {}),
    },
  };
};

const runFullScenario = async (input: {
  scenario: Scenario;
  agent: OpenAICompatibleGenerationAgent;
  recorder: FileGenerationTraceRecorder;
  researchProvider: HostedGenerationResearchProvider;
}) => {
  const startedAt = performance.now();
  const pipeline = new GenerationV2ResearchPipeline({
    agent: input.agent,
    researchProvider: input.researchProvider,
    recorder: input.recorder,
    onProgress: (event) => console.error(JSON.stringify({
      scenario: input.scenario.id,
      ...event,
    })),
  });
  const result = await pipeline.execute(input.scenario.request);
  if (result.status !== "succeeded") {
    return {
      scenario: input.scenario.id,
      status: result.status,
      runId: result.runId,
      durationMs: Math.round(performance.now() - startedAt),
      stage: result.stage,
      diagnostics: result.diagnostics,
    };
  }

  return {
    scenario: input.scenario.id,
    status: result.status,
    runId: result.runId,
    durationMs: Math.round(performance.now() - startedAt),
    classification: {
      subject: result.classification.subject,
      language: result.classification.language,
      deckMode: result.classification.deckMode,
      groundingMode: result.classification.groundingMode,
    },
    researchPlan: {
      requiresExternalResearch: result.researchPlan.requiresExternalResearch,
      researchQuestions: result.researchPlan.researchQuestions,
      evidenceRequirements: result.researchPlan.evidenceRequirements,
      sourceTargets: result.researchPlan.sourceTargets,
    },
    researchBundle: {
      sources: result.researchBundle.sources,
      fetchErrors: result.researchBundle.fetchErrors,
    },
    evidenceSet: {
      snippetIds: result.evidenceSet.snippets.map((snippet) => snippet.id),
    },
    factBank: {
      researchApproved: result.researchReview.approved,
      facts: result.factBank.facts,
      uncertainties: "uncertainties" in result.factBank ? result.factBank.uncertainties : [],
    },
    researchReview: {
      approved: result.researchReview.approved,
      score: result.researchReview.score,
      summary: result.researchReview.summary,
      issues: result.researchReview.issues,
      retryRecommended: result.researchReview.retryRecommended,
      requirementAssessments: result.researchReview.requirementAssessments,
    },
  };
};

const main = async (): Promise<void> => {
  const baseUrl = requiredEnv("LMSTUDIO_BASE_URL");
  const model = requiredEnv("LMSTUDIO_MODEL");
  const agent = new OpenAICompatibleGenerationAgent({
    providerName: "lmstudio-generation-v2",
    baseUrl,
    model,
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 90_000),
    reasoningEffort: "low",
    ...(process.env.LMSTUDIO_API_KEY
      ? { apiKey: process.env.LMSTUDIO_API_KEY }
      : {}),
  });
  const health = await agent.healthCheck();
  if (!health.ok) {
    throw new Error(health.detail);
  }

  const requestedScenario = process.argv
    .find((argument) => argument.startsWith("--scenario="))
    ?.slice("--scenario=".length);
  const selectedScenarios = requestedScenario
    ? scenarios.filter((scenario) => scenario.id === requestedScenario)
    : scenarios;
  if (selectedScenarios.length === 0) {
    throw new Error(`Unknown scenario "${requestedScenario}".`);
  }

  const recorder = new FileGenerationTraceRecorder({
    rootDir: resolve(process.env.STORAGE_ROOT ?? "data"),
  });
  const runFullPipeline = process.argv.includes("--full");
  const researchProvider = new HostedGenerationResearchProvider({
    timeoutMs: Number(process.env.WEB_RESEARCH_TIMEOUT_MS ?? 15_000),
  });
  const results = [];
  for (const scenario of selectedScenarios) {
    results.push(
      runFullPipeline
        ? await runFullScenario({
            scenario,
            agent,
            recorder,
            researchProvider,
          })
        : await runScenario({ scenario, agent, recorder }),
    );
  }

  console.log(JSON.stringify({ model, results }, null, 2));
  const failed = runFullPipeline
    ? results.some((result) => !("status" in result) || result.status !== "succeeded")
    : results.some(
        (result) =>
          !("classification" in result) ||
          !("status" in result.classification) ||
          result.classification.status !== "succeeded" ||
          !("researchPlan" in result) ||
          !("status" in result.researchPlan) ||
          result.researchPlan.status !== "succeeded",
      );
  if (failed) {
    process.exitCode = 1;
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
