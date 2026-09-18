import { Router } from "express";
import { z } from "zod";
import { generationV2Jobs, publishedPresentations, createPresentationQuestions } from "../services/generation-v2/context";
import { GenerationV2JobBusyError } from "../services/generation-v2/jobs";
import { GenerationArtifactIdSchema, PublishedPresentationViewSchema, PresentationQuestionSchema, PublishedLibraryQuerySchema, PublishedLibraryPageSchema } from "@slidespeech/types";
import { PublishedPresentationSpeech } from "../services/generation-v2/presentation-speech";
import { appContext } from "../lib/context";
import { env } from "../config/env";
import { QuestionTranscription } from "../services/generation-v2/question-transcription";
import { SerialWorkQueue, WorkQueueBusyError } from "../services/generation-v2/work-queue";
import type { QuestionStreamEvent } from "@slidespeech/types";

export const generationV2Router = Router();
const speech = new PublishedPresentationSpeech(appContext.ttsProvider);
// One serial generation lane plus one serial question lane uses at most two
// model calls in the current V2 pipelines. Admission precedes question deadlines.
const questions = new SerialWorkQueue("Presenter questions");
const transcription = new QuestionTranscription(appContext.sttProvider);

generationV2Router.get("/presentations", async (request, response, next) => {
  const query = PublishedLibraryQuerySchema.safeParse(request.query);
  if (!query.success) { response.status(400).json({ error: "Invalid library search or page." }); return; }
  try {
    response.setHeader("Cache-Control", "no-store");
    response.json(PublishedLibraryPageSchema.parse(await publishedPresentations.list(query.data)));
  } catch (error) { next(error); }
});

generationV2Router.post("/presentations/:id/archive", async (request, response, next) => {
  const id = GenerationArtifactIdSchema.safeParse(request.params.id);
  if (!id.success) { response.status(400).json({ error: "Invalid presentation." }); return; }
  try {
    if (!await publishedPresentations.archive(id.data)) { response.status(404).json({ error: "Presentation is no longer in the library." }); return; }
    response.status(204).end();
  } catch (error) { next(error); }
});

generationV2Router.post("/presentations/:id/transcriptions", async (request, response, next) => {
  const controller = new AbortController();
  const disconnect = () => { if (!response.writableEnded) controller.abort(); };
  response.on("close", disconnect);
  try {
    const id = GenerationArtifactIdSchema.safeParse(request.params.id);
    if (!id.success) { response.status(400).json({ error: "Invalid presentation." }); return; }
    if (!await publishedPresentations.get(id.data)) { response.status(404).json({ error: "Published presentation not found." }); return; }
    if (env.STT_PROVIDER !== "faster-whisper") { response.status(503).json({ error: "Microphone questions require the real Faster Whisper backend." }); return; }
    const result = await transcription.transcribe(request.body, controller.signal);
    if (!controller.signal.aborted) { response.setHeader("Cache-Control", "no-store"); response.json(result); }
  } catch (error) {
    if (!controller.signal.aborted) {
      if (error instanceof WorkQueueBusyError) response.status(429).json({ error: error.message });
      else if (error instanceof z.ZodError) response.status(400).json({ error: "Invalid recording." });
      else next(error);
    }
  } finally { response.off("close", disconnect); }
});

generationV2Router.post("/presentations/:id/questions", async (request, response, next) => {
  const id = GenerationArtifactIdSchema.safeParse(request.params.id);
  const question = PresentationQuestionSchema.safeParse(request.body);
  if (!id.success || !question.success) { response.status(400).json({ error: "Enter a question for a valid presentation and slide." }); return; }
  const controller = new AbortController();
  const streaming = request.get("accept")?.includes("application/x-ndjson") === true;
  const send = (event: QuestionStreamEvent) => {
    if (!streaming || controller.signal.aborted || response.writableEnded) return;
    response.write(`${JSON.stringify(event)}\n`);
  };
  const disconnect = () => { if (!response.writableEnded) controller.abort(); };
  response.on("close", disconnect);
  try {
    if (streaming) {
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.setHeader("Cache-Control", "no-store, no-transform");
      response.setHeader("X-Accel-Buffering", "no");
      response.flushHeaders();
      send({ type: "progress", progress: { stage: "waiting", status: "started", occurredAt: new Date().toISOString() } });
    }
    const result = await questions.run(async () => {
      const record = await publishedPresentations.get(id.data);
      if (!record || question.data.slideIndex >= record.scenes.length) return undefined;
      return createPresentationQuestions().answer(record.presentation, question.data, { signal: controller.signal, onProgress: (event) => {
        if ((event.stage === "qa-classification" || event.stage === "qa-answer" || event.stage === "qa-review") && (event.status === "started" || event.status === "succeeded")) {
          send({ type: "progress", progress: { stage: event.stage, status: event.status, occurredAt: event.occurredAt } });
        }
      } });
    }, controller.signal);
    if (!result) {
      if (streaming) { send({ type: "error", error: "Published slide not found." }); response.end(); }
      else response.status(404).json({ error: "Published slide not found." });
      return;
    }
    if (!controller.signal.aborted) {
      speech.registerAnswer(result);
      if (streaming) { send({ type: "result", result }); response.end(); }
      else { response.setHeader("Cache-Control", "no-store"); response.json(result); }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      if (streaming) { send({ type: "error", error: error instanceof Error ? error.message : "The question could not be completed." }); response.end(); }
      else if (error instanceof WorkQueueBusyError) response.status(429).json({ error: error.message });
      else next(error);
    }
  } finally { response.off("close", disconnect); }
});

generationV2Router.get("/presentations/:id/answers/:answerId/audio", async (request, response, next) => {
  try {
    const params = z.object({ id: GenerationArtifactIdSchema, answerId: GenerationArtifactIdSchema }).safeParse(request.params);
    if (!params.success) { response.status(400).json({ error: "Invalid presentation or answer." }); return; }
    if (env.TTS_PROVIDER !== "piper") { response.status(503).json({ error: "Answer playback requires the configured Piper backend." }); return; }
    const bridge = z.enum(["true", "false"]).optional().safeParse(request.query.bridge);
    if (!bridge.success) { response.status(400).json({ error: "Invalid answer playback option." }); return; }
    const audio = speech.answerAudio(params.data.id, params.data.answerId, bridge.data !== "false");
    if (!audio) { response.status(404).json({ error: "This answer's audio is no longer available. Please ask again." }); return; }
    response.setHeader("Content-Type", "audio/wav"); response.setHeader("Cache-Control", "no-store");
    response.send(Buffer.from(await audio));
  } catch (error) { next(error); }
});

generationV2Router.get("/presentations/:id", async (request, response, next) => {
  try {
    const id = GenerationArtifactIdSchema.safeParse(request.params.id);
    if (!id.success) { response.status(400).json({ error: "Invalid presentation ID." }); return; }
    const record = await publishedPresentations.get(id.data);
    if (!record) { response.status(404).json({ error: "Published presentation not found." }); return; }
    response.setHeader("Cache-Control", "no-store");
    response.json(PublishedPresentationViewSchema.parse({ id: record.presentation.artifactId,
      title: record.presentation.classification.subject, publishedAt: record.presentation.publishedAt,
      scenes: record.scenes, scripts: record.presentation.narrations.scripts }));
  } catch (error) { next(error); }
});

generationV2Router.get("/presentations/:id/slides/:slideIndex/audio", async (request, response, next) => {
  try {
    const params = z.object({ id: GenerationArtifactIdSchema, slideIndex: z.coerce.number().int().nonnegative() }).safeParse(request.params);
    if (!params.success) { response.status(400).json({ error: "Invalid presentation or slide." }); return; }
    const passage = z.coerce.number().int().nonnegative().optional().safeParse(request.query.passage);
    if (!passage.success) { response.status(400).json({ error: "Invalid narration passage." }); return; }
    const record = await publishedPresentations.get(params.data.id);
    if (!record || params.data.slideIndex >= record.scenes.length) { response.status(404).json({ error: "Published slide not found." }); return; }
    if (env.TTS_PROVIDER !== "piper") { response.status(503).json({ error: "This presenter currently requires the configured Piper backend." }); return; }
    const audio = await speech.synthesize(record, params.data.slideIndex, passage.data);
    response.setHeader("Content-Type", "audio/wav");
    response.setHeader("Cache-Control", "private, max-age=86400");
    response.send(Buffer.from(audio));
  } catch (error) { next(error); }
});

generationV2Router.post("/jobs", (request, response, next) => {
  try {
    response.status(202).json(generationV2Jobs.start(request.body));
  } catch (error) {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: "Check the presentation brief and advanced settings.", issues: error.issues });
    } else if (error instanceof GenerationV2JobBusyError) {
      response.status(429).json({ error: error.message });
    } else next(error);
  }
});

generationV2Router.get("/jobs/:id", (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  const job = generationV2Jobs.get(request.params.id);
  if (!job) {
    response.status(404).json({ error: "This run is no longer available. The server may have restarted. Start a new run when ready." });
  } else response.json(job);
});

generationV2Router.post("/jobs/:id/cancel", (request, response) => {
  const job = generationV2Jobs.cancel(request.params.id);
  if (!job) response.status(404).json({ error: "Run not found." });
  else response.json(job);
});
