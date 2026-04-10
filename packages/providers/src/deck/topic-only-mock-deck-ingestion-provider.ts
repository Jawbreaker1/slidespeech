import type {
  DeckIngestionInput,
  DeckIngestionProvider,
  StructuredDeckData,
} from "@slidespeech/types";

export class TopicOnlyMockDeckIngestionProvider implements DeckIngestionProvider {
  readonly name = "topic-only-mock-ingestion";

  async ingestTopic(input: DeckIngestionInput) {
    return {
      title: `${input.topic}: introduktion`,
      summary: `Strukturerat ämnesunderlag för ${input.topic}.`,
      bulletClusters: [
        [`Vad är ${input.topic}?`, `Varför spelar ${input.topic} roll?`],
        [`Hur fungerar ${input.topic}?`, "Vilka moduler ingår?"],
        [`Vilka exempel förklarar ${input.topic} bäst?`],
      ],
    };
  }

  async ingestDocument(_filePath: string): Promise<StructuredDeckData> {
    throw new Error("Document ingestion is planned for a later phase.");
  }

  async ingestPptx(_filePath: string): Promise<StructuredDeckData> {
    throw new Error("PPTX ingestion is planned for a later phase.");
  }

  async extractStructuredDeckData(
    _filePath: string,
  ): Promise<StructuredDeckData> {
    throw new Error("Structured deck extraction is planned for a later phase.");
  }
}
