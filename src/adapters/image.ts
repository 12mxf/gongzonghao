import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config.js";
import type { DraftDocument, ImageJob } from "../types.js";
import { buildImageJobs } from "../templates/prompts.js";

export interface ImageResult {
  paused: boolean;
  reason?: string;
  images: Array<{ jobId: string; role: string; localPath: string; sourceIds: string[] }>;
}

export class CodexMembershipImageAdapter {
  constructor(private readonly config: AppConfig) {}

  plan(draft: DraftDocument): ImageJob[] {
    return buildImageJobs(draft);
  }

  collect(runId: string, jobs: ImageJob[]): ImageResult {
    const inbox = path.join(this.config.imageInboxDir, runId);
    const images = jobs.flatMap((job) => {
      const localPath = path.join(inbox, job.filename);
      return fs.existsSync(localPath) ? [{ jobId: job.id, role: job.role, localPath, sourceIds: job.sourceIds }] : [];
    });
    if (images.length === jobs.length) return { paused: false, images };
    return {
      paused: true,
      reason: "当前本地应用没有权限直接调用 Codex 会员内置 image_gen/Image2。已生成 image-jobs.json；请在当前 Codex 会话生成图片并放入指定 inbox 后单独重跑图片步骤。未配置 API Key，也不会回退到第三方付费接口。",
      images,
    };
  }
}
