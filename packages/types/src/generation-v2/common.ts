import { z } from "zod";

export const GenerationArtifactIdSchema = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);

export const GenerationArtifactIdentitySchema = z
  .object({
    schemaVersion: z.literal("2.0"),
    artifactId: GenerationArtifactIdSchema,
    createdAt: z.string().datetime(),
  })
  .strict();

export type GenerationArtifactIdentity = z.infer<
  typeof GenerationArtifactIdentitySchema
>;

export const GenerationStageNameSchema = z.enum([
  "prompt-classification",
  "research-planning",
  "research-execution",
  "fact-curation",
  "research-review",
  "deck-strategy",
  "slide-allocation",
  "design-selection",
  "slide-generation",
  "slide-review",
  "narration-generation",
  "narration-review",
  "publication-review",
  "publication",
  "qa-classification",
  "qa-context",
  "qa-answer",
  "qa-review",
  "qa-resume",
]);

export type GenerationStageName = z.infer<typeof GenerationStageNameSchema>;

export const GenerationDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(120),
    message: z.string().min(1).max(2_000),
    category: z.enum([
      "contract",
      "semantic",
      "source",
      "transport",
      "renderer",
      "policy",
      "internal",
    ]),
    retryable: z.boolean(),
    artifactPath: z.array(z.union([z.string(), z.number().int()])).default([]),
    sourceIds: z.array(GenerationArtifactIdSchema).default([]),
  })
  .strict();

export type GenerationDiagnostic = z.infer<typeof GenerationDiagnosticSchema>;

const GenerationStageResultBaseSchema = z
  .object({
    runId: GenerationArtifactIdSchema,
    stage: GenerationStageNameSchema,
    attempt: z.number().int().positive(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
    inputArtifactIds: z.array(GenerationArtifactIdSchema),
    sourceIds: z.array(GenerationArtifactIdSchema),
  })
  .strict();

const GenerationStageSuccessRecordSchema = GenerationStageResultBaseSchema.extend({
  status: z.literal("succeeded"),
  warnings: z.array(GenerationDiagnosticSchema),
  errors: z.array(GenerationDiagnosticSchema).max(0),
  artifact: z.unknown(),
}).strict();

const GenerationStageRejectedRecordSchema = GenerationStageResultBaseSchema.extend({
  status: z.literal("rejected"),
  warnings: z.array(GenerationDiagnosticSchema),
  errors: z.array(GenerationDiagnosticSchema).min(1),
  artifact: z.unknown().optional(),
}).strict();

const GenerationStageFailedRecordSchema = GenerationStageResultBaseSchema.extend({
  status: z.literal("failed"),
  warnings: z.array(GenerationDiagnosticSchema),
  errors: z.array(GenerationDiagnosticSchema).min(1),
}).strict();

export const GenerationStageResultRecordSchema = z.discriminatedUnion("status", [
  GenerationStageSuccessRecordSchema,
  GenerationStageRejectedRecordSchema,
  GenerationStageFailedRecordSchema,
]);

export type GenerationStageResultRecord = z.infer<
  typeof GenerationStageResultRecordSchema
>;

export interface GenerationTraceRecorder {
  record(result: GenerationStageResultRecord): Promise<void>;
}

type GenerationStageResultBase = z.infer<typeof GenerationStageResultBaseSchema>;

export type GenerationStageResult<TArtifact> =
  | (GenerationStageResultBase & {
      status: "succeeded";
      warnings: GenerationDiagnostic[];
      errors: [];
      artifact: TArtifact;
    })
  | (GenerationStageResultBase & {
      status: "rejected";
      warnings: GenerationDiagnostic[];
      errors: GenerationDiagnostic[];
      artifact?: TArtifact;
    })
  | (GenerationStageResultBase & {
      status: "failed";
      warnings: GenerationDiagnostic[];
      errors: GenerationDiagnostic[];
    });

export const DeckModeSchema = z.enum([
  "teaching",
  "onboarding",
  "sales",
  "strategy",
  "report",
  "workshop",
  "how-to",
  "comparison",
  "story",
]);

export type DeckMode = z.infer<typeof DeckModeSchema>;
