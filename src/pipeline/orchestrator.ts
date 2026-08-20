import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { WorkbenchDatabase } from "../db/database.js";
import type { StructuredLogger } from "../lib/logger.js";
import type { SearchAdapter } from "../adapters/search.js";
import type { WriterAdapter } from "../adapters/writer.js";
import type { CodexMembershipImageAdapter } from "../adapters/image.js";
import type { WechatDraftAdapter } from "../adapters/wechat.js";
import { buildTopicCards } from "./topics.js";
import { indexDirectory } from "../rag/indexer.js";
import { retrieveByKinds } from "../rag/retriever.js";
import { renderWechatHtml } from "../templates/wechat.js";
import { STEP_NAMES, type CandidateSource, type DraftDocument, type ImageJob, type StepName, type TopicCard } from "../types.js";

interface PipelineDeps {
  config: AppConfig;
  db: WorkbenchDatabase;
  logger: StructuredLogger;
  search: SearchAdapter;
  writer: WriterAdapter;
  image: CodexMembershipImageAdapter;
  wechat: WechatDraftAdapter;
}

export class PipelineOrchestrator {
  constructor(private readonly deps: PipelineDeps) {}

  async run(runId: string, onlyStep?: StepName, force = false) {
    const run = this.deps.db.getRun(runId);
    if (!run) throw new Error(`任务不存在：${runId}`);
    this.deps.db.setRunStatus(runId, "running");
    const steps = onlyStep ? [onlyStep] : [...STEP_NAMES];
    for (const stepName of steps) {
      const current = this.deps.db.getStep(runId, stepName);
      const sensitive = stepName === "asset_upload" || stepName === "wechat_draft";
      if (current?.status === "succeeded" && !(force && onlyStep === stepName && !sensitive)) {
        this.deps.logger.info("step_cache_hit", { runId, step: stepName });
        continue;
      }
      await this.execute(runId, stepName);
      if (this.deps.db.getStep(runId, stepName)?.status === "failed") return this.deps.db.getRun(runId);
    }
    const after = this.deps.db.getRun(runId)!;
    const blockingFailure = after.steps.some((step) => String(step.status) === "failed");
    this.deps.db.setRunStatus(runId, blockingFailure ? "failed" : "succeeded", blockingFailure ? "存在失败步骤" : undefined);
    return this.deps.db.getRun(runId);
  }

  private output<T>(runId: string, name: StepName): T {
    const step = this.deps.db.getStep(runId, name);
    if (!step?.output) throw new Error(`前置步骤 ${name} 尚无可用产物`);
    return step.output as T;
  }

  private async execute(runId: string, name: StepName) {
    this.deps.db.startStep(runId, name);
    this.deps.logger.info("step_started", { runId, step: name });
    try {
      const result = await this.stage(runId, name);
      if (result && typeof result === "object" && "paused" in result && result.paused) {
        this.deps.db.pauseStep(runId, name, result, String(result.reason || "等待外部条件"));
        this.deps.logger.warn("step_paused", { runId, step: name, reason: result.reason });
      } else {
        this.deps.db.finishStep(runId, name, "succeeded", result);
        this.deps.logger.info("step_succeeded", { runId, step: name });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.db.finishStep(runId, name, "failed", undefined, "STEP_FAILED", message);
      this.deps.db.setRunStatus(runId, "failed", message);
      this.deps.logger.error("step_failed", { runId, step: name, error: message });
    }
  }

  private async stage(runId: string, name: StepName): Promise<Record<string, unknown>> {
    const run = this.deps.db.getRun(runId)!;
    const runDir = path.join(this.deps.config.outputDir, runId);
    fs.mkdirSync(runDir, { recursive: true });

    if (name === "source_search") {
      const query = String(run.keyword || run.manualTitle || "");
      const sources = await this.deps.search.search({
        keyword: query,
        limit: this.deps.config.searchResultLimit,
        runId,
      });
      this.deps.db.saveSources(runId, sources);
      return { query, count: sources.length, sources };
    }
    if (name === "topic_cards") {
      const { sources } = this.output<{ sources: CandidateSource[] }>(runId, "source_search");
      const cards = buildTopicCards(sources, run.manualTitle ? String(run.manualTitle) : undefined);
      if (!cards.length) throw new Error("未找到候选文章；请更换关键词、手动填写标题或配置公开 RSS");
      fs.writeFileSync(path.join(runDir, "topic-cards.json"), JSON.stringify(cards, null, 2));
      return { cards, selected: cards[0] };
    }
    if (name === "rag_retrieval") {
      const { selected } = this.output<{ selected: TopicCard }>(runId, "topic_cards");
      const indexed = indexDirectory(this.deps.db, this.deps.config.rawDataDir);
      const evidence = retrieveByKinds(this.deps.db, `${selected.title} ${selected.angle}`);
      if (!evidence.length) throw new Error("本地知识库没有可检索语料；先运行 npm run demo 或把 Markdown/TXT 放入 data/raw");
      this.deps.db.saveEvidence(runId, evidence);
      this.deps.db.saveSources(runId, evidence.map((item) => ({
        id: item.sourceId, url: `local-kb://${item.sourceId}`, title: item.title,
        author: item.author || "本地知识库", publishedAt: null, readCount: null,
        likeCount: null, commentCount: null, sourceType: "knowledge" as const,
      })));
      fs.writeFileSync(path.join(runDir, "rag-evidence.json"), JSON.stringify(evidence, null, 2));
      return { indexed, evidence };
    }
    if (name === "draft_generation") {
      const { selected } = this.output<{ selected: TopicCard }>(runId, "topic_cards");
      const { evidence } = this.output<{ evidence: ReturnType<typeof retrieveByKinds> }>(runId, "rag_retrieval");
      const draft = await this.deps.writer.write(selected, evidence);
      this.deps.db.saveBlocks(runId, name, draft.blocks);
      this.deps.db.setFinal(runId, draft.title);
      fs.writeFileSync(path.join(runDir, "draft.json"), JSON.stringify(draft, null, 2));
      return { draft };
    }
    if (name === "image_plan") {
      const { draft } = this.output<{ draft: DraftDocument }>(runId, "draft_generation");
      const jobs = this.deps.image.plan(draft);
      fs.writeFileSync(path.join(runDir, "image-jobs.json"), JSON.stringify({ runId, provider: "Codex membership image_gen/Image2 only", jobs }, null, 2));
      return { jobs, jobFile: path.join(runDir, "image-jobs.json") };
    }
    if (name === "image_generation") {
      const { jobs } = this.output<{ jobs: ImageJob[] }>(runId, "image_plan");
      const result = this.deps.image.collect(runId, jobs);
      if (!result.paused) result.images.forEach((image) => this.deps.db.addArtifact(runId, image.role === "cover" ? "cover_image" : "inline_image", { localPath: image.localPath, metadata: { jobId: image.jobId, sourceIds: image.sourceIds } }));
      return result as unknown as Record<string, unknown>;
    }
    if (name === "html_layout") {
      const { draft } = this.output<{ draft: DraftDocument }>(runId, "draft_generation");
      const { jobs } = this.output<{ jobs: ImageJob[] }>(runId, "image_plan");
      const imageOutput = this.deps.db.getStep(runId, "image_generation")?.output as { images?: Array<{ jobId: string; localPath: string }> } | null;
      const images = imageOutput?.images || [];
      for (const image of images) fs.copyFileSync(image.localPath, path.join(runDir, path.basename(image.localPath)));
      const allSources = run.sources as CandidateSource[];
      const html = renderWechatHtml({ runId, draft, sources: allSources, imageJobs: jobs, images });
      const htmlPath = path.join(runDir, "article.html");
      fs.writeFileSync(htmlPath, html);
      this.deps.db.addArtifact(runId, "article_html", { localPath: htmlPath, metadata: { sourceIds: draft.sourceIds } });
      return { htmlPath, previewUrl: `/output/${runId}/article.html`, sourceIds: draft.sourceIds };
    }
    if (name === "asset_upload") {
      const imageOutput = this.deps.db.getStep(runId, "image_generation")?.output as { images?: Array<{ jobId: string; role: string; localPath: string }> } | null;
      const images = imageOutput?.images || [];
      const cover = images.find((image) => image.role === "cover");
      const result = await this.deps.wechat.uploadAssets({ runId, coverPath: cover?.localPath, inlineImages: images.filter((image) => image.role === "inline") });
      this.deps.db.addArtifact(runId, "wechat_asset_manifest", { mediaId: result.coverMediaId, metadata: result });
      return result as unknown as Record<string, unknown>;
    }
    if (name === "wechat_draft") {
      const { draft } = this.output<{ draft: DraftDocument }>(runId, "draft_generation");
      const { htmlPath } = this.output<{ htmlPath: string }>(runId, "html_layout");
      const assets = this.output<{ coverMediaId: string; inlineUrls: Record<string, string> }>(runId, "asset_upload");
      let html = fs.readFileSync(htmlPath, "utf8");
      for (const [jobId, remoteUrl] of Object.entries(assets.inlineUrls || {})) {
        const localName = jobId === "inline-method" ? "inline-method.png" : `${jobId}.png`;
        html = html.replaceAll(localName, remoteUrl);
      }
      const contentFragment = html.match(/<main[\s\S]*<\/main>/)?.[0] || html;
      const result = await this.deps.wechat.createDraft({ runId, draft, html: contentFragment, coverMediaId: assets.coverMediaId });
      this.deps.db.setFinal(runId, draft.title, result.mediaId);
      this.deps.db.addArtifact(runId, "wechat_draft", { mediaId: result.mediaId, metadata: { mode: result.mode, payload: result.payload } });
      return result as unknown as Record<string, unknown>;
    }
    throw new Error(`未知步骤：${name}`);
  }
}
