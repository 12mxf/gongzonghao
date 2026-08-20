import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApplication } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const tempDirs: string[] = [];
function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-pipeline-")); tempDirs.push(temp);
  const raw = path.join(temp, "raw"); fs.cpSync(path.resolve("tests/fixtures/corpus"), raw, { recursive: true });
  const config = loadConfig({
    DATABASE_PATH: path.join(temp, "workbench.sqlite"), LOG_DIR: path.join(temp, "logs"),
    OUTPUT_DIR: path.join(temp, "output"), RAW_DATA_DIR: raw, IMAGE_INBOX_DIR: path.join(temp, "inbox"),
    DATA_SOURCE_MODE: "demo", IMAGE_PROVIDER_MODE: "codex_manual", WECHAT_MODE: "mock",
  });
  return { temp, config };
}
afterEach(() => tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("完整流水线", () => {
  it("演示数据跑到本地 HTML 和微信 mock 草稿，图片不可用时保持暂停", async () => {
    const { config } = fixture(); const { db, pipeline } = createApplication(config);
    const runId = db.createRun({ keyword: "PET/CT 质量管理", manualTitle: "可追溯的质量管理" });
    const run = await pipeline.run(runId);
    expect(run?.status).toBe("succeeded");
    expect(run?.draftMediaId).toMatch(/^mock-draft-/);
    expect(run?.steps.find((step) => String(step.name) === "image_generation")?.status).toBe("pending");
    expect(fs.readFileSync(path.join(config.outputDir, runId, "article.html"), "utf8")).toContain("资料边界与来源");
    const blocks = db.db.prepare("SELECT source_ids_json FROM content_blocks WHERE run_id = ?").all(runId) as Array<{ source_ids_json: string }>;
    expect(blocks.length).toBeGreaterThan(3);
    expect(blocks.every((block) => JSON.parse(block.source_ids_json).length > 0)).toBe(true);
    const before = Number(run?.steps.find((step) => String(step.name) === "wechat_draft")?.attempt);
    const rerun = await pipeline.run(runId);
    const after = Number(rerun?.steps.find((step) => String(step.name) === "wechat_draft")?.attempt);
    expect(after).toBe(before);
    db.close();
  });

  it("API 刷新后仍可从 SQLite 读取历史任务", async () => {
    const { config } = fixture();
    const first = createApplication(config);
    const created = await request(first.app).post("/api/runs").send({ keyword: "测试", manualTitle: "持久化任务", autoStart: false }).expect(201);
    const runId = created.body.run.id; first.db.close();
    const second = createApplication(config);
    const listed = await request(second.app).get("/api/runs").expect(200);
    expect(listed.body.runs.some((run: { id: string }) => run.id === runId)).toBe(true);
    const health = await request(second.app).get("/api/health").expect(200);
    expect(health.body.publishingEnabled).toBe(false);
    second.db.close();
  });
});
