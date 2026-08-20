import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { HttpClient } from "../lib/http.js";
import type { DraftDocument } from "../types.js";

interface UploadInput {
  runId: string;
  coverPath?: string;
  inlineImages: Array<{ localPath: string; jobId: string }>;
}

export class WechatDraftAdapter {
  constructor(private readonly config: AppConfig, private readonly http: HttpClient) {}

  private async token() {
    if (!this.config.wechatAppId || !this.config.wechatAppSecret) throw new Error("WECHAT_APP_ID / WECHAT_APP_SECRET 未配置");
    const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set("appid", this.config.wechatAppId);
    url.searchParams.set("secret", this.config.wechatAppSecret);
    const result = await (await this.http.request(url.toString(), {}, { adapter: "wechat", action: "token" })).json() as Record<string, unknown>;
    if (!result.access_token) throw new Error(`微信 access_token 获取失败：${JSON.stringify(result)}`);
    return String(result.access_token);
  }

  async uploadAssets(input: UploadInput) {
    if (this.config.wechatMode !== "real") {
      const mockId = `mock-thumb-${createHash("sha1").update(input.runId).digest("hex").slice(0, 12)}`;
      return {
        mode: "mock", coverMediaId: mockId,
        inlineUrls: Object.fromEntries(input.inlineImages.map((image) => [image.jobId, `https://mock.local/${input.runId}/${path.basename(image.localPath)}`])),
        requestShape: { cover: "POST /cgi-bin/material/add_material?type=thumb", inline: "POST /cgi-bin/media/uploadimg" },
      };
    }
    if (!input.coverPath) throw new Error("真实微信草稿需要封面图；请先用 Codex 内置图片能力生成并回填 cover.png");
    const token = await this.token();
    const upload = async (filePath: string, endpoint: string, field = "media") => {
      const form = new FormData();
      form.set(field, new Blob([await fs.readFile(filePath)]), path.basename(filePath));
      return await (await this.http.request(`${endpoint}&access_token=${encodeURIComponent(token)}`, { method: "POST", body: form }, { adapter: "wechat", action: "upload" })).json() as Record<string, unknown>;
    };
    const cover = await upload(input.coverPath, "https://api.weixin.qq.com/cgi-bin/material/add_material?type=thumb");
    if (!cover.media_id) throw new Error(`微信封面上传失败：${JSON.stringify(cover)}`);
    const inlineEntries = await Promise.all(input.inlineImages.map(async (image) => {
      const result = await upload(image.localPath, "https://api.weixin.qq.com/cgi-bin/media/uploadimg?");
      if (!result.url) throw new Error(`微信正文图片上传失败：${JSON.stringify(result)}`);
      return [image.jobId, String(result.url)] as const;
    }));
    return { mode: "real", coverMediaId: String(cover.media_id), inlineUrls: Object.fromEntries(inlineEntries) };
  }

  async createDraft(input: { runId: string; draft: DraftDocument; html: string; coverMediaId: string }) {
    const payload = {
      articles: [{
        title: input.draft.title,
        author: "",
        digest: input.draft.digest.slice(0, 120),
        content: input.html,
        content_source_url: "",
        thumb_media_id: input.coverMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      }],
    };
    if (this.config.wechatMode !== "real") {
      return { mode: "mock", mediaId: `mock-draft-${createHash("sha1").update(input.runId).digest("hex").slice(0, 16)}`, payload };
    }
    const token = await this.token();
    const result = await (await this.http.request(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }, { adapter: "wechat", action: "draft_add" })).json() as Record<string, unknown>;
    if (!result.media_id) throw new Error(`微信草稿创建失败：${JSON.stringify(result)}`);
    return { mode: "real", mediaId: String(result.media_id), payload };
  }
}
