import { z } from "zod";
import { SpeechToTextResultSchema } from "../domain";

export const QuestionAudioSchema = z.object({
  mimeType: z.string().min(1).max(150),
  dataBase64: z.string().min(1).max(7_000_000),
}).strict();
export const QuestionTranscriptSchema = SpeechToTextResultSchema.extend({ text: z.string().max(5_000), isFinal: z.literal(true) });
