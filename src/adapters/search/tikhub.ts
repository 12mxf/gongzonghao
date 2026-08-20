import fs from "node:fs/promises";
import path from "node:path";
import type { HttpClient } from "../../lib/http.js";
import type { SearchInput, SearchItem, SearchProvider } from "../../types.js";
import { dedupeSearchItems, normalizeSourceUrl, sourceIdFor } from "./evidence.js";

type JsonObject = Record<string, unknown>;

interface TikHubProviderOptions {
  apiKey: string;
  baseUrl: string;
  outputDir: string;
  maxSogouPages: number;
  http: HttpClient;
}

interface DiscoveredArticle {
  sogouUrl: string;
  title: string;
  author?: string;
  publishedAt?: string;
  summary?: string;
}

function decodeHtml(value: string) {
  return value
    .replace(/<!--.*?-->/gs, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSogouWechatResults(html: string): DiscoveredArticle[] {
  const list = html.match(/<ul[^>]*class=["'][^"']*news-list[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] || "";
  const blocks = list.match(/<li\b[\s\S]*?<\/li>/gi) || [];
  return blocks.flatMap((block) => {
    const titleMatch = block.match(/<a[^>]+id=["']sogou_vr_11002601_title_[^"']+["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]+href=["']([^"']+)["'][^>]+id=["']sogou_vr_11002601_title_[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) return [];
    const href = decodeHtml(titleMatch[1]);
    const timestamp = block.match(/timeConvert\(['"]?(\d+)['"]?\)/i)?.[1];
    const author = block.match(/<span[^>]+class=["'][^"']*all-time-y2[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
    const summary = block.match(/<p[^>]+class=["'][^"']*txt-info[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
    return [{
      sogouUrl: new URL(href, "https://weixin.sogou.com").toString(),
      title: decodeHtml(titleMatch[2]),
      author: author ? decodeHtml(author) : undefined,
      publishedAt: timestamp ? new Date(Number(timestamp) * 1000).toISOString() : undefined,
      summary: summary ? decodeHtml(summary) : undefined,
    }];
  });
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function findValue(root: unknown, names: string[]): unknown {
  for (const name of names) {
    const wanted = name.toLowerCase();
    const queue: unknown[] = [root];
    const visited = new Set<unknown>();
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object" || visited.has(current)) continue;
      visited.add(current);
      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }
      for (const [key, value] of Object.entries(current as JsonObject)) {
        if (key.toLowerCase() === wanted && value !== null && value !== "") return value;
        if (value && typeof value === "object") queue.push(value);
      }
    }
  }
  return undefined;
}

function textValue(root: unknown, names: string[]) {
  const value = findValue(root, names);
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function numberValue(root: unknown, names: string[]) {
  const value = findValue(root, names);
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateValue(root: unknown) {
  const value = findValue(root, ["published_at", "publish_time", "create_time", "ct", "datetime"]);
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function permanentUrl(root: unknown) {
  const candidate = textValue(root, ["article_url", "permanent_url", "mp_url", "url"]);
  return candidate && /^https?:\/\//.test(candidate) ? normalizeSourceUrl(candidate) : undefined;
}

export class TikHubWechatSearchProvider implements SearchProvider {
  constructor(private readonly options: TikHubProviderOptions) {}

  async search(input: SearchInput): Promise<SearchItem[]> {
    if (!this.options.apiKey) throw new Error("DATA_PROVIDER_KEY 未配置；TikHub 仅从环境变量读取密钥");
    const rawDir = path.join(this.options.outputDir, input.runId, "raw");
    await fs.mkdir(rawDir, { recursive: true });
    const discovered: DiscoveredArticle[] = [];
    const pages = Math.min(this.options.maxSogouPages, Math.max(1, Math.ceil(input.limit / 10)));

    for (let page = 1; page <= pages && discovered.length < input.limit; page += 1) {
      const url = new URL("https://weixin.sogou.com/weixin");
      url.searchParams.set("type", "2");
      url.searchParams.set("query", input.keyword);
      url.searchParams.set("ie", "utf8");
      url.searchParams.set("page", String(page));
      const response = await this.options.http.request(url.toString(), {
        headers: { "user-agent": "Mozilla/5.0 (compatible; ContentWorkbench/0.2; local research tool)" },
      }, { adapter: "sogou_wechat", page });
      const html = await response.text();
      await fs.writeFile(path.join(rawDir, `sogou-page-${page}.html`), html);
      const pageItems = parseSogouWechatResults(html);
      if (!pageItems.length) break;
      discovered.push(...pageItems);
    }

    const items: SearchItem[] = [];
    for (const [index, article] of discovered.slice(0, input.limit).entries()) {
      const prefix = String(index + 1).padStart(3, "0");
      const resolved = await this.call("/api/v1/wechat_mp/web/fetch_mp_article_url", { sogou_url: article.sogouUrl });
      const resolvedPath = path.join(rawDir, `${prefix}-url.json`);
      await fs.writeFile(resolvedPath, JSON.stringify(resolved, null, 2));
      const url = permanentUrl(resolved);
      if (!url) continue;

      const detail = await this.call("/api/v1/wechat_mp/web/fetch_mp_article_detail_json", { url });
      const detailPath = path.join(rawDir, `${prefix}-detail.json`);
      await fs.writeFile(detailPath, JSON.stringify(detail, null, 2));
      const commentId = textValue(detail, ["comment_id", "commentid"]);
      const metrics = await this.call("/api/v1/wechat_mp/web/fetch_mp_article_read_count", {
        url,
        comment_id: commentId || "",
      });
      await fs.writeFile(path.join(rawDir, `${prefix}-metrics.json`), JSON.stringify(metrics, null, 2));

      const publishedAt = dateValue(detail) || article.publishedAt;
      if (input.startAt && publishedAt && publishedAt < new Date(input.startAt).toISOString()) continue;
      if (input.endAt && publishedAt && publishedAt > new Date(input.endAt).toISOString()) continue;
      items.push({
        source: "tikhub-wechat-mp",
        sourceId: sourceIdFor("tikhub", url),
        url,
        title: textValue(detail, ["title", "msg_title"]) || article.title,
        author: textValue(detail, ["nickname", "author", "account_name"]) || article.author,
        publishedAt,
        collectedAt: new Date().toISOString(),
        metrics: {
          views: numberValue(metrics, ["read_num", "read_count", "reads", "view_count"]),
          likes: numberValue(metrics, ["like_num", "like_count", "likes", "old_like_num"]),
          comments: numberValue(metrics, ["comment_count", "comment_num", "comments", "total_comment_count"]),
          favorites: numberValue(metrics, ["favorite_count", "favorites", "collect_count", "bookmark_count"]),
        },
        rawText: textValue(detail, ["digest", "summary", "description", "content"]) || article.summary,
        rawPayloadPath: detailPath,
      });
    }
    return dedupeSearchItems(items);
  }

  private async call(endpoint: string, params: Record<string, string>) {
    const url = new URL(endpoint, this.options.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await this.options.http.request(url.toString(), {
      headers: { authorization: `Bearer ${this.options.apiKey}`, accept: "application/json" },
    }, { adapter: "tikhub", endpoint });
    const payload: unknown = await response.json();
    return asObject(payload) || { data: payload };
  }
}
