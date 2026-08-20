import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TikHubWechatSearchProvider } from "../src/adapters/search/tikhub.js";
import { evidenceLevel } from "../src/adapters/search/evidence.js";
import { HttpClient } from "../src/lib/http.js";
import { StructuredLogger } from "../src/lib/logger.js";

const tempDirs: string[] = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-tikhub-"));
  tempDirs.push(dir);
  return dir;
}

function sogouHtml() {
  return `<ul class="news-list"><li><div class="txt-box"><h3>
    <a target="_blank" href="/link?url=token&amp;type=2&amp;query=test" id="sogou_vr_11002601_title_0">
      AI <em>写作</em>实战
    </a></h3><p class="txt-info">一段公开摘要</p>
    <span class="all-time-y2">示例作者</span><span><script>document.write(timeConvert('1700000000'))</script></span>
  </div></li></ul>`;
}

function provider(outputDir: string, maxRetries = 3) {
  const logger = new StructuredLogger(path.join(outputDir, "logs"));
  const http = new HttpClient({ timeoutMs: 1_000, maxRetries, retryBaseDelayMs: 1, logger });
  return new TikHubWechatSearchProvider({
    apiKey: "test-only-token",
    baseUrl: "https://api.tikhub.dev",
    outputDir,
    maxSogouPages: 2,
    http,
  });
}

const input = { keyword: "AI 写作", limit: 10, runId: "run-test" };

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("TikHub 微信公众号搜索适配器", () => {
  it("正常响应：发现文章、补全指标并保存原始证据", async () => {
    const dir = tempDir();
    vi.stubGlobal("fetch", vi.fn(async (urlValue: string | URL | Request) => {
      const url = String(urlValue);
      if (url.startsWith("https://weixin.sogou.com")) return new Response(sogouHtml());
      if (url.includes("fetch_mp_article_url?")) return Response.json({ code: 200, data: { article_url: "https://mp.weixin.qq.com/s/example?scene=1" } });
      if (url.includes("fetch_mp_article_detail_json?")) return Response.json({ data: { title: "AI 写作实战", nickname: "公众号作者", publish_time: 1700000000, comment_id: "c-1", digest: "文章摘要" } });
      if (url.includes("fetch_mp_article_read_count?")) return Response.json({ data: { read_num: 12345, like_num: 88, comment_count: 12, collect_count: 9 } });
      return new Response("not found", { status: 404 });
    }));

    const [item] = await provider(dir).search(input);
    expect(item).toMatchObject({
      source: "tikhub-wechat-mp",
      url: "https://mp.weixin.qq.com/s/example",
      title: "AI 写作实战",
      author: "公众号作者",
      metrics: { views: 12345, likes: 88, comments: 12, favorites: 9 },
    });
    expect(evidenceLevel(item)).toBe("可比较真实数据");
    expect(fs.existsSync(path.join(dir, input.runId, "raw", "sogou-page-1.html"))).toBe(true);
    expect(fs.existsSync(item.rawPayloadPath!)).toBe(true);
  });

  it("空结果：不调用 TikHub，也不伪造热度", async () => {
    const dir = tempDir();
    const fetchMock = vi.fn(async () => new Response('<ul class="news-list"></ul>'));
    vi.stubGlobal("fetch", fetchMock);
    expect(await provider(dir).search(input)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 限流：按指数退避重试后成功", async () => {
    const dir = tempDir();
    let resolveAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (urlValue: string | URL | Request) => {
      const url = String(urlValue);
      if (url.startsWith("https://weixin.sogou.com")) return new Response(sogouHtml());
      if (url.includes("fetch_mp_article_url?")) {
        resolveAttempts += 1;
        if (resolveAttempts === 1) return new Response("rate limited", { status: 429 });
        return Response.json({ data: { url: "https://mp.weixin.qq.com/s/retried" } });
      }
      if (url.includes("fetch_mp_article_detail_json?")) return Response.json({ data: { title: "重试成功" } });
      return Response.json({ data: { read_count: 1 } });
    }));
    const items = await provider(dir).search(input);
    expect(resolveAttempts).toBe(2);
    expect(items[0].title).toBe("重试成功");
  });

  it("字段缺失：保留发现证据并明确标记数据待补", async () => {
    const dir = tempDir();
    vi.stubGlobal("fetch", vi.fn(async (urlValue: string | URL | Request) => {
      const url = String(urlValue);
      if (url.startsWith("https://weixin.sogou.com")) return new Response(sogouHtml());
      if (url.includes("fetch_mp_article_url?")) return Response.json({ data: { url: "https://mp.weixin.qq.com/s/missing" } });
      return Response.json({ code: 200, data: {} });
    }));
    const [item] = await provider(dir).search(input);
    expect(item.title).toBe("AI 写作实战");
    expect(item.metrics).toEqual({ views: undefined, likes: undefined, comments: undefined, favorites: undefined });
    expect(evidenceLevel(item)).toBe("已发现·数据待补");
  });
});
