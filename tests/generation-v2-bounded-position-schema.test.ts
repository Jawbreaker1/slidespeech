import assert from "node:assert/strict";
import test from "node:test";

import {
  createEvidenceSelectionDecisionSchema,
  createFactBankDecisionSchema,
  createResearchSourceSelectionDecisionSchema,
  toGenerationJsonSchema,
} from "@slidespeech/types";

test("source-selection schemas allow honest rejection with no candidates but no invented choice", () => {
  const schema = createResearchSourceSelectionDecisionSchema({ candidateCount: 0, maximumSelections: 1 });
  const decision = { canUseCandidates: false, blockingReason: "No candidates supplied.", selectedCandidates: [] };
  assert.equal(schema.safeParse(decision).success, true);
  assert.equal(schema.safeParse({ ...decision, canUseCandidates: true, blockingReason: null }).success, false);
  assert.equal(schema.safeParse({ ...decision, selectedCandidates: [{ candidateIndex: 0, rationale: "Invented.", priority: 0 }] }).success, false);
  assert.throws(() => createResearchSourceSelectionDecisionSchema({ candidateCount: -1, maximumSelections: 1 }));
});

const findPropertySchemas = (
  value: unknown,
  propertyName: string,
): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => findPropertySchemas(item, propertyName));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const object = value as Record<string, unknown>;
  const properties =
    typeof object.properties === "object" && object.properties !== null
      ? object.properties as Record<string, unknown>
      : {};
  const direct = properties[propertyName];
  return [
    ...(typeof direct === "object" && direct !== null
      ? [direct as Record<string, unknown>]
      : []),
    ...Object.values(object).flatMap((item) =>
      findPropertySchemas(item, propertyName),
    ),
  ];
};

test("evidence decision schema requires exact segment keys and leaves requirement mapping to facts", () => {
  const schema = createEvidenceSelectionDecisionSchema({
    segmentKeys: ["segment_1", "segment_2", "segment_3"],
  });
  const valid = {
    segmentAssessments: {
      segment_1: {
        status: "discarded",
        rationale: "The segment is not relevant.",
      },
      segment_2: {
        status: "discarded",
        rationale: "The segment is not relevant.",
      },
      segment_3: {
        status: "selected",
        rationale: "The segment directly supports the requirement.",
      },
    },
    observations: [],
  };

  assert.equal(schema.safeParse(valid).success, true);
  assert.equal(
    schema.safeParse({
      ...valid,
      segmentAssessments: {
        segment_1: valid.segmentAssessments.segment_1,
        segment_2: valid.segmentAssessments.segment_2,
      },
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      ...valid,
      segmentAssessments: {
        ...valid.segmentAssessments,
        segment_3: {
          status: "selected",
          evidenceRequirementSelection: { requirement_1: true },
          rationale: "The selection agent must not author coverage decisions.",
        },
      },
    }).success,
    false,
  );
  const grammarSchema = toGenerationJsonSchema(schema);
  assert.match(JSON.stringify(grammarSchema), /"segment_3"/);
  assert.doesNotMatch(JSON.stringify(grammarSchema), /evidenceRequirementSelection/);
});

test("fact decision schema accepts sparse references constrained to supplied ids", () => {
  const schema = createFactBankDecisionSchema({
    evidenceSnippetIds: ["snippet_1", "snippet_2", "snippet_3", "snippet_4"],
    evidenceRequirementIds: ["requirement_1", "requirement_2", "requirement_3"],
  });
  const valid = {
    facts: [
      {
        claim: "A directly supported fact.",
        role: "identity",
        language: "en",
        origin: "source",
        evidenceSnippetIds: ["snippet_4"],
        evidenceRequirementIds: ["requirement_1", "requirement_3"],
      },
    ],
    uncertainties: [],
  };

  assert.equal(schema.safeParse(valid).success, true);
  assert.deepEqual(findPropertySchemas(toGenerationJsonSchema(schema), "allowedUse"), []);
  assert.equal(schema.safeParse({ ...valid, facts: [{ ...valid.facts[0], allowedUse: "narration-only" }] }).success, false);
  assert.equal(
    schema.safeParse({
      ...valid,
      facts: [
        {
          ...valid.facts[0],
          evidenceSnippetIds: ["snippet_unknown"],
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      ...valid,
      facts: [
        {
          ...valid.facts[0],
          evidenceRequirementIds: ["requirement_unknown"],
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      ...valid,
      sourceSummaries: [{ summary: "Only one source." }],
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      ...valid,
      requirementAssessments: [{ status: "fulfilled" }],
    }).success,
    false,
  );
  const grammarSchema = toGenerationJsonSchema(schema);
  assert.deepEqual(findPropertySchemas(grammarSchema, "evidenceSnippetIds")[0]?.items, {
    type: "string",
    enum: ["snippet_1", "snippet_2", "snippet_3", "snippet_4"],
  });
  assert.deepEqual(findPropertySchemas(grammarSchema, "evidenceRequirementIds")[0]?.items, {
    type: "string",
    enum: ["requirement_1", "requirement_2", "requirement_3"],
  });
  for (const references of [
    { evidenceSnippetIds: [] },
    { evidenceSnippetIds: ["snippet_4", "snippet_4"] },
    { evidenceRequirementIds: ["requirement_1", "requirement_1"] },
  ]) {
    assert.equal(schema.safeParse({
      ...valid,
      facts: [{ ...valid.facts[0], ...references }],
    }).success, false);
  }
  assert.equal(schema.safeParse({
    ...valid,
    facts: [{ ...valid.facts[0], evidenceRequirementIds: [] }],
  }).success, true);
  const requirementSchemas = findPropertySchemas(
    grammarSchema,
    "requirementAssessments",
  );
  assert.deepEqual(requirementSchemas, []);
  const summarySchemas = findPropertySchemas(grammarSchema, "sourceSummaries");
  assert.deepEqual(summarySchemas, []);
  for (const references of [
    { evidenceSnippetIds: ["unknown"], evidenceRequirementIds: [] },
    { evidenceSnippetIds: [], evidenceRequirementIds: ["unknown"] },
    { evidenceSnippetIds: ["snippet_1", "snippet_1"], evidenceRequirementIds: [] },
  ]) assert.equal(schema.safeParse({ ...valid, uncertainties: [{ description: "A gap.", ...references }] }).success, false);
});

test("fact decision schema supports model knowledge without source references", () => {
  const schema = createFactBankDecisionSchema({
    evidenceSnippetIds: [],
    evidenceRequirementIds: [],
  });
  const fact = {
    claim: "A stable foundational claim.",
    role: "background",
    language: "en",
    origin: "model-knowledge",
    knowledgeBasis: "Foundational domain knowledge.",
    evidenceRequirementIds: [],
  };
  const decision = {
    facts: [fact],
    uncertainties: [],
  };
  assert.equal(schema.safeParse(decision).success, true);
  assert.equal(schema.safeParse({
    ...decision,
    facts: [{ ...fact, evidenceRequirementIds: ["invented"] }],
  }).success, false);
  assert.equal(schema.safeParse({
    ...decision,
    facts: [{ ...fact, evidenceSnippetIds: ["invented"] }],
  }).success, false);
  const { knowledgeBasis: _basis, ...sourceFact } = fact;
  assert.equal(schema.safeParse({
    ...decision,
    facts: [{ ...sourceFact, origin: "source", evidenceSnippetIds: ["invented"] }],
  }).success, false);
  const snippetSchemas = findPropertySchemas(toGenerationJsonSchema(schema), "evidenceSnippetIds");
  assert.equal(snippetSchemas.length, 1, "Only uncertainty references remain when there are no source facts.");
  assert.equal(snippetSchemas[0]?.maxItems, 0);
});
