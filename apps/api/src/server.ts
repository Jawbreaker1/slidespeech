import cors from "cors";
import express from "express";

import { env } from "./config/env";
import { presentationsRouter } from "./routes/presentations";
import { researchRouter } from "./routes/research";

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "slidespeech-api",
  });
});

app.use("/api/presentations", presentationsRouter);
app.use("/api/research", researchRouter);

app.use(
  (
    error: Error,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[slidespeech-api] request failed", error);
    response.status(500).json({
      error: error.message,
    });
  },
);

const server = app.listen(env.API_PORT, () => {
  console.log(
    `[slidespeech-api] listening on http://localhost:${env.API_PORT} with LLM provider ${env.LLM_PROVIDER}`,
  );
});

let shuttingDown = false;

const shutdown = (signal: string) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[slidespeech-api] received ${signal}, shutting down`);

  server.close((error) => {
    if (error) {
      console.error("[slidespeech-api] shutdown failed", error);
      process.exit(1);
    }

    console.log("[slidespeech-api] shutdown complete");
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
