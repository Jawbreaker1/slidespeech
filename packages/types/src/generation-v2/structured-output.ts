import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  FactBankDecisionSchema,
  PromptClassificationDecisionSchema,
  ResearchPlanDecisionSchema,
} from "./research";
import { EvidenceSelectionDecisionSchema } from "./evidence-selection";
import { ReviewDecisionSchema } from "./review";

export type GenerationJsonSchema = Record<string, unknown>;

const convertZodSchema = zodToJsonSchema as unknown as (
  schema: ZodTypeAny,
  options: Record<string, unknown>,
) => GenerationJsonSchema;

// LM Studio's grammar sampler rejects maxLength in otherwise valid schemas.
// Keep other constraints visible in the prompt and check them again at runtime;
// grammar sampling alone does not enforce every JSON Schema constraint.
const UNSUPPORTED_GRAMMAR_KEYWORDS = new Set(["maxLength"]);

const normalizeForGrammarSampler = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeForGrammarSampler);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !UNSUPPORTED_GRAMMAR_KEYWORDS.has(key))
      .map(([key, nestedValue]) => [
        key,
        normalizeForGrammarSampler(nestedValue),
      ]),
  );
};

export const toGenerationJsonSchema = (
  schema: ZodTypeAny,
): GenerationJsonSchema => {
  const converted = convertZodSchema(schema, {
    $refStrategy: "none",
    effectStrategy: "input",
    strictUnions: true,
    target: "jsonSchema7",
  });

  const { $schema: _schemaDeclaration, ...jsonSchema } = converted;
  return normalizeForGrammarSampler(jsonSchema) as GenerationJsonSchema;
};

export const PromptClassificationDecisionJsonSchema = toGenerationJsonSchema(
  PromptClassificationDecisionSchema,
);

export const ResearchPlanDecisionJsonSchema = toGenerationJsonSchema(
  ResearchPlanDecisionSchema,
);

export const FactBankDecisionJsonSchema = toGenerationJsonSchema(
  FactBankDecisionSchema,
);

export const EvidenceSelectionDecisionJsonSchema = toGenerationJsonSchema(
  EvidenceSelectionDecisionSchema,
);

export const ReviewDecisionJsonSchema = toGenerationJsonSchema(
  ReviewDecisionSchema,
);
