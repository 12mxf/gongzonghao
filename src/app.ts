import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { WorkbenchDatabase } from "./db/database.js";
import { StructuredLogger } from "./lib/logger.js";
import { HttpClient } from "./lib/http.js";
import { createSearchAdapter } from "./adapters/search.js";
import { EvidenceBoundWriter } from "./adapters/writer.js";
import { CodexMembershipImageAdapter } from "./adapters/image.js";
import { WechatDraftAdapter } from "./adapters/wechat.js";
import { PipelineOrchestrator } from "./pipeline/orchestrator.js";
import { STEP_NAMES, type StepName } from "./types.js";

export function createApplication(config: AppConfig = loadConfig()) {
  const db = new WorkbenchDatabase(config.databasePath);
  const logger = new StructuredLogger(config.logDir);
  const http = new HttpClient({ timeoutMs: config.httpTimeoutMs, maxRetries: config.httpMaxRetries, logger });
  const pipeline = new PipelineOrchestrator({
    config, db, logger,
    search: createSearchAdapter(config, http),
    writer: new EvidenceBoundWriter(),
    image: new CodexMembershipImageAdapter(config),
    wechat: new WechatDraftAdapter(config, http),
  } as ConstructorParameters<typeof PipelineOrchestrator>[0]);
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/output", express.static(config.outputDir, { index: false, fallthrough: false }));

  app.get("/api/health", (_request, response) => response.json({
    ok: true, service: "公众号内容工作台", database: "sqlite",
    sourceMode: config.sourceMode, imageMode: config.imageMode, wechatMode: config.wechatMode,
    publishingEnabled: false,
  }));
  app.get("/api/runs", (_request, response) => response.json({ runs: db.listRuns() }));
  app.get("/api/runs/:runId", (request, response) => {
    const run = db.getRun(request.params.runId);
    if (!run) return response.status(404).json({ error: "RUN_NOT_FOUND", message: "任务不存在" });
    response.json({ run });
  });
  app.get("/api/runs/:runId/logs", (request, response) => response.json({ logs: logger.readForRun(request.params.runId) }));
  app.post("/api/runs", async (request, response, next) => {
    try {
      const keyword = String(request.body?.keyword || "").trim();
      const manualTitle = String(request.body?.manualTitle || "").trim();
      if (!keyword && !manualTitle) return response.status(400).json({ error: "INPUT_REQUIRED", message: "关键词和手动标题至少填写一项" });
      const runId = db.createRun({ keyword, manualTitle });
      logger.info("run_created", { runId, keyword, hasManualTitle: Boolean(manualTitle) });
      const run = request.body?.autoStart === false ? db.getRun(runId) : await pipeline.run(runId);
      response.status(201).json({ run });
    } catch (error) { next(error); }
  });
  app.post("/api/runs/:runId/run", async (request, response, next) => {
    try { response.json({ run: await pipeline.run(request.params.runId) }); } catch (error) { next(error); }
  });
  app.post("/api/runs/:runId/steps/:step/retry", async (request, response, next) => {
    try {
      const step = request.params.step as StepName;
      if (!STEP_NAMES.includes(step)) return response.status(400).json({ error: "INVALID_STEP", message: "未知步骤" });
      response.json({ run: await pipeline.run(request.params.runId, step, true) });
    } catch (error) { next(error); }
  });

  const clientDir = path.resolve(process.cwd(), "dist/client");
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get("/{*splat}", (_request, response) => response.sendFile(path.join(clientDir, "index.html")));
  }
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("api_error", { error: message });
    response.status(500).json({ error: "INTERNAL_ERROR", message });
  });
  return { app, db, pipeline, logger, config };
}
