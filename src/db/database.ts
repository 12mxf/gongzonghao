import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { schemaStatements } from "./schema.js";
import { STEP_NAMES, type CandidateSource, type Evidence, type RunInput, type StepName, type StepStatus } from "../types.js";

const now = () => new Date().toISOString();
const parse = (value: unknown) => value ? JSON.parse(String(value)) : null;

export class WorkbenchDatabase {
  readonly db: Database.Database;

  constructor(filename: string) {
    if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    for (const statement of schemaStatements) this.db.prepare(statement).run();
    this.db.pragma("optimize");
  }

  close() { this.db.close(); }

  createRun(input: RunInput) {
    const id = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const timestamp = now();
    const transaction = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO runs (id, keyword, manual_title, status, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, ?)`).run(id, input.keyword || null, input.manualTitle || null, timestamp, timestamp);
      const insert = this.db.prepare(`INSERT INTO steps (run_id, name, ordinal, status) VALUES (?, ?, ?, 'pending')`);
      STEP_NAMES.forEach((name, ordinal) => insert.run(id, name, ordinal));
    });
    transaction();
    return id;
  }

  listRuns(limit = 50) {
    const runs = this.db.prepare(`SELECT * FROM runs ORDER BY created_at DESC LIMIT ?`).all(limit) as Record<string, unknown>[];
    return runs.map((run) => this.hydrateRun(run));
  }

  getRun(runId: string) {
    const run = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as Record<string, unknown> | undefined;
    return run ? this.hydrateRun(run) : null;
  }

  private hydrateRun(run: Record<string, unknown>) {
    const steps = this.db.prepare(`SELECT * FROM steps WHERE run_id = ? ORDER BY ordinal`).all(run.id) as Record<string, unknown>[];
    const sources = this.db.prepare(`SELECT * FROM sources WHERE run_id = ? ORDER BY rowid`).all(run.id) as Record<string, unknown>[];
    const evidence = this.db.prepare(`SELECT * FROM evidence WHERE run_id = ? ORDER BY kind, score DESC`).all(run.id) as Record<string, unknown>[];
    const artifacts = this.db.prepare(`SELECT * FROM artifacts WHERE run_id = ? ORDER BY id`).all(run.id) as Record<string, unknown>[];
    return {
      id: run.id,
      keyword: run.keyword,
      manualTitle: run.manual_title,
      status: run.status,
      finalTitle: run.final_title,
      draftMediaId: run.draft_media_id,
      errorMessage: run.error_message,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      steps: steps.map((step) => ({
        name: step.name, status: step.status, attempt: step.attempt,
        startedAt: step.started_at, finishedAt: step.finished_at,
        errorCode: step.error_code, errorMessage: step.error_message,
        output: parse(step.output_json),
      })),
      sources: sources.map((source) => ({
        id: source.id, url: source.url, title: source.title, author: source.author,
        publishedAt: source.published_at, readCount: source.read_count,
        likeCount: source.like_count, commentCount: source.comment_count,
        sourceType: source.source_type,
      })),
      evidence: evidence.map((item) => ({
        id: item.id, sourceId: item.source_id, kind: item.kind, title: item.title,
        author: item.author, content: item.content, score: item.score,
      })),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id, kind: artifact.kind, localPath: artifact.local_path,
        remoteUrl: artifact.remote_url, mediaId: artifact.media_id,
        metadata: parse(artifact.metadata_json), createdAt: artifact.created_at,
      })),
    };
  }

  setRunStatus(runId: string, status: "pending" | "running" | "succeeded" | "failed", errorMessage?: string) {
    this.db.prepare(`UPDATE runs SET status = ?, error_message = ?, updated_at = ? WHERE id = ?`)
      .run(status, errorMessage || null, now(), runId);
  }

  setFinal(runId: string, title: string, mediaId?: string) {
    this.db.prepare(`UPDATE runs SET final_title = ?, draft_media_id = COALESCE(?, draft_media_id), updated_at = ? WHERE id = ?`)
      .run(title, mediaId || null, now(), runId);
  }

  getStep(runId: string, name: StepName) {
    const row = this.db.prepare(`SELECT * FROM steps WHERE run_id = ? AND name = ?`).get(runId, name) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { name: row.name as StepName, status: row.status as StepStatus, output: parse(row.output_json), errorCode: row.error_code };
  }

  startStep(runId: string, name: StepName) {
    this.db.prepare(`UPDATE steps SET status='running', attempt=attempt+1, started_at=?, finished_at=NULL,
      error_code=NULL, error_message=NULL WHERE run_id=? AND name=?`).run(now(), runId, name);
  }

  finishStep(runId: string, name: StepName, status: "succeeded" | "failed", output?: unknown, errorCode?: string, errorMessage?: string) {
    this.db.prepare(`UPDATE steps SET status=?, finished_at=?, output_json=?, error_code=?, error_message=?
      WHERE run_id=? AND name=?`).run(status, now(), output ? JSON.stringify(output) : null, errorCode || null, errorMessage || null, runId, name);
  }

  pauseStep(runId: string, name: StepName, output: unknown, reason: string) {
    this.db.prepare(`UPDATE steps SET status='pending', finished_at=?, output_json=?, error_code='PAUSED', error_message=?
      WHERE run_id=? AND name=?`).run(now(), JSON.stringify(output), reason, runId, name);
  }

  saveSources(runId: string, sources: CandidateSource[]) {
    const insert = this.db.prepare(`INSERT INTO sources
      (id, run_id, url, title, author, published_at, read_count, like_count, comment_count, source_type, raw_json)
      VALUES (@id, @runId, @url, @title, @author, @publishedAt, @readCount, @likeCount, @commentCount, @sourceType, @rawJson)
      ON CONFLICT(run_id, id) DO UPDATE SET title=excluded.title, author=excluded.author,
      published_at=excluded.published_at, read_count=excluded.read_count,
      like_count=excluded.like_count, comment_count=excluded.comment_count, raw_json=excluded.raw_json`);
    this.db.transaction(() => sources.forEach((source) => insert.run({
      ...source, runId, rawJson: JSON.stringify(source),
    })))();
  }

  saveEvidence(runId: string, items: Evidence[]) {
    const insert = this.db.prepare(`INSERT OR REPLACE INTO evidence
      (id, run_id, source_id, kind, title, author, content, score)
      VALUES (@id, @runId, @sourceId, @kind, @title, @author, @content, @score)`);
    this.db.transaction(() => items.forEach((item) => insert.run({ ...item, runId, author: item.author || null })))();
  }

  saveBlocks(runId: string, stage: string, blocks: Array<{ key: string; content: string; sourceIds: string[] }>) {
    const insert = this.db.prepare(`INSERT INTO content_blocks (run_id, stage, block_key, content, source_ids_json)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id, stage, block_key) DO UPDATE SET
      content=excluded.content, source_ids_json=excluded.source_ids_json`);
    this.db.transaction(() => blocks.forEach((block) => insert.run(runId, stage, block.key, block.content, JSON.stringify(block.sourceIds))))();
  }

  addArtifact(runId: string, kind: string, values: { localPath?: string; remoteUrl?: string; mediaId?: string; metadata?: unknown }) {
    this.db.prepare(`INSERT INTO artifacts (run_id, kind, local_path, remote_url, media_id, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(runId, kind, values.localPath || null, values.remoteUrl || null,
      values.mediaId || null, values.metadata ? JSON.stringify(values.metadata) : null, now());
  }

  upsertRagChunk(chunk: { id: string; sourceId: string; kind: string; title: string; author?: string; content: string; filePath: string; contentHash: string }) {
    this.db.prepare(`INSERT INTO rag_chunks (id, source_id, kind, title, author, content, file_path, content_hash)
      VALUES (@id, @sourceId, @kind, @title, @author, @content, @filePath, @contentHash)
      ON CONFLICT(content_hash) DO UPDATE SET content=excluded.content, title=excluded.title, author=excluded.author`)
      .run({ ...chunk, author: chunk.author || null });
  }

  listRagChunks(kind: string) {
    return this.db.prepare(`SELECT * FROM rag_chunks WHERE kind = ?`).all(kind) as Array<Record<string, unknown>>;
  }
}
