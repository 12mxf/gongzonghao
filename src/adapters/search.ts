import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { AppConfig } from "../config.js";
import type { CandidateSource, SearchInput } from "../types.js";
import type { HttpClient } from "../lib/http.js";
import { TikHubWechatSearchProvider } from "./search/tikhub.js";
import { sourceIdFor, toCandidateSource } from "./search/evidence.js";

export interface SearchAdapter {
  search(input: SearchInput): Promise<CandidateSource[]>;
}

export class DemoSearchAdapter implements SearchAdapter {
  async search(input: SearchInput) {
    const filename = path.resolve(process.cwd(), "tests/fixtures/candidates.json");
    const rows = JSON.parse(await fs.readFile(filename, "utf8")) as Array<Omit<CandidateSource, "id" | "sourceType">>;
    const terms = input.keyword.toLowerCase().split(/[\s/]+/).filter((term) => term.length > 1);
    return rows.filter((row) => terms.length === 0 || terms.some((term) => `${row.title}${row.summary}`.toLowerCase().includes(term)))
      .slice(0, input.limit)
      .map((row) => ({ ...row, id: sourceIdFor("demo", row.url), sourceType: "demo" as const }));
  }
}

export class RssSearchAdapter implements SearchAdapter {
  private readonly parser = new XMLParser({ ignoreAttributes: false });
  constructor(private readonly feeds: string[], private readonly http: HttpClient) {}

  async search(input: SearchInput) {
    if (!this.feeds.length) throw new Error("PUBLIC_RSS_FEEDS 未配置；rss 模式只读取用户明确授权的公开订阅源");
    const terms = input.keyword.toLowerCase().split(/\s+/).filter(Boolean);
    const batches = await Promise.all(this.feeds.map(async (feedUrl) => {
      const response = await this.http.request(feedUrl, { headers: { "user-agent": "ContentWorkbench/0.1 (+local RSS reader)" } }, { adapter: "rss" });
      const parsed = this.parser.parse(await response.text());
      const items = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
      return (Array.isArray(items) ? items : [items]).map((item: Record<string, unknown>) => {
        const linkValue = typeof item.link === "object" ? (item.link as Record<string, unknown>)["@_href"] : item.link;
        const url = String(linkValue || item.guid || "");
        return {
          id: sourceIdFor("rss", url), url, title: String(item.title || "未命名条目"),
          author: item.author ? String(item.author) : null,
          publishedAt: item.pubDate || item.published || item.updated ? new Date(String(item.pubDate || item.published || item.updated)).toISOString() : null,
          readCount: null, likeCount: null, commentCount: null,
          sourceType: "rss" as const,
          summary: String(item.description || item.summary || "").replace(/<[^>]+>/g, " ").slice(0, 500),
        };
      });
    }));
    return batches.flat().filter((item) => item.url && (terms.length === 0 || terms.some((term) => `${item.title}${item.summary}`.toLowerCase().includes(term))))
      .slice(0, input.limit);
  }
}

export class TikHubSearchAdapter implements SearchAdapter {
  private readonly provider: TikHubWechatSearchProvider;

  constructor(config: AppConfig, http: HttpClient) {
    this.provider = new TikHubWechatSearchProvider({
      apiKey: config.dataProviderKey,
      baseUrl: config.tikhubBaseUrl,
      outputDir: config.outputDir,
      maxSogouPages: config.sogouMaxPages,
      http,
    });
  }

  async search(input: SearchInput) {
    return (await this.provider.search(input)).map((item) => toCandidateSource(item));
  }
}

export function createSearchAdapter(config: AppConfig, http: HttpClient): SearchAdapter {
  if (config.sourceMode === "tikhub") return new TikHubSearchAdapter(config, http);
  if (config.sourceMode === "rss") return new RssSearchAdapter(config.rssFeeds, http);
  return new DemoSearchAdapter();
}
