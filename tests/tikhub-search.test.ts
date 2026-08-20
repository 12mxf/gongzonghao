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

function provider(outputDir: string, maxRetries = 3, seedUrls: string[] = []) {
  const logger = new StructuredLogger(path.join(outputDir, "logs"));
  const http = new HttpClient({ timeoutMs: 1_000, maxRetries, retryBaseDelayMs: 1, logger });
  return new TikHubWechatSearchProvider({
    apiKey: "test-only-token",
    baseUrl: "https://api.tikhub.dev",
    seedUrls,
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
    const requests: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn(async (urlValue: string | URL | Request, init?: RequestInit) => {
      requests.push(init || {});
      const url = String(urlValue);
      if (url.includes("fetch_article_detail")) return Response.json({ data: { title: "AI 写作实战", nickname: "公众号作者", publish_time: 1700000000, digest: "文章摘要" } });
      if (url.includes("fetch_article_stats")) return Response.json({ data: { read_num: 12345, like_num: 88, comment_count: 12, collect_count: 9 } });
      return new Response("not found", { status: 404 });
    }));

    const [item] = await provider(dir, 3, ["https://mp.weixin.qq.com/s/example?scene=1"]).search(input);
    expect(item).toMatchObject({
      source: "tikhub-wechat-mp",
      url: "https://mp.weixin.qq.com/s/example",
      title: "AI 写作实战",
      author: "公众号作者",
      metrics: { views: 12345, likes: 88, comments: 12, favorites: 9 },
    });
    expect(evidenceLevel(item)).toBe("可比较真实数据");
    expect(fs.existsSync(item.rawPayloadPath!)).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.method === "POST")).toBe(true);
    expect(requests.every((request) => JSON.parse(String(request.body)).raw === true)).toBe(true);
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
    let detailAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (urlValue: string | URL | Request) => {
      const url = String(urlValue);
      if (url.includes("fetch_article_detail")) {
        detailAttempts += 1;
        if (detailAttempts === 1) return new Response("rate limited", { status: 429 });
        return Response.json({ data: { title: "重试成功" } });
      }
      return Response.json({ data: { read_count: 1 } });
    }));
    const items = await provider(dir, 3, ["https://mp.weixin.qq.com/s/retried"]).search(input);
    expect(detailAttempts).toBe(2);
    expect(items[0].title).toBe("重试成功");
  });

  it("字段缺失：保留发现证据并明确标记数据待补", async () => {
    const dir = tempDir();
    vi.stubGlobal("fetch", vi.fn(async (urlValue: string | URL | Request) => {
      return Response.json({ code: 200, data: {} });
    }));
    const [item] = await provider(dir, 3, ["https://mp.weixin.qq.com/s/missing"]).search(input);
    expect(item.title).toBe("公众号文章（详情待补）");
    expect(item.metrics).toEqual({ views: undefined, likes: undefined, comments: undefined, favorites: undefined });
    expect(evidenceLevel(item)).toBe("已发现·数据待补");
  });

  it("402 不重试，且错误响应回显的 Authorization 不进入错误文本", async () => {
    const dir = tempDir();
    const fetchMock = vi.fn(async () => Response.json({
      detail: {
        message_zh: "余额不足",
        headers: { Authorization: "Bearer test-only-token" },
      },
    }, { status: 402 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider(dir, 3, ["https://mp.weixin.qq.com/s/paid"]).search(input)).rejects.toThrow("HTTP 402: 余额不足");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const logPath = path.join(dir, "logs", "workbench.ndjson");
    const logText = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    expect(logText).not.toContain("test-only-token");
  });

  it("搜狗候选无法转换时保留发现证据，不调用已下线接口", async () => {
    const dir = tempDir();
    const fetchMock = vi.fn(async () => new Response(sogouHtml()));
    vi.stubGlobal("fetch", fetchMock);
    const [item] = await provider(dir).search(input);
    expect(item).toMatchObject({ source: "sogou-wechat", title: "AI 写作实战", metrics: {} });
    expect(evidenceLevel(item)).toBe("已发现·数据待补");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
