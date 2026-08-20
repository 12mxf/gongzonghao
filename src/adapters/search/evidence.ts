import { createHash } from "node:crypto";
import type { CandidateSource, EvidenceLevel, SearchItem } from "../../types.js";

const TRACKING_PARAMS = new Set(["from", "scene", "subscene", "clicktime", "enterid", "sessionid", "ascene", "chksm"]);

export function normalizeSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) {
      if (name.startsWith("utm_") || TRACKING_PARAMS.has(name.toLowerCase())) url.searchParams.delete(name);
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function sourceIdFor(source: string, url: string) {
  return `${source}-${createHash("sha256").update(normalizeSourceUrl(url)).digest("hex").slice(0, 16)}`;
}

export function evidenceLevel(item: Pick<SearchItem, "url" | "metrics">): EvidenceLevel {
  const hasUrl = Boolean(item.url);
  const metricCount = Object.values(item.metrics).filter(Number.isFinite).length;
  if (hasUrl && metricCount >= 2) return "可比较真实数据";
  if (hasUrl && metricCount >= 1) return "真实数据候选";
  if (hasUrl) return "已发现·数据待补";
  return "不可入库";
}

export function dedupeSearchItems(items: SearchItem[]) {
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();
  return items.filter((item) => {
    const url = normalizeSourceUrl(item.url);
    if (!url || seenUrls.has(url) || seenIds.has(item.sourceId)) return false;
    seenUrls.add(url);
    seenIds.add(item.sourceId);
    item.url = url;
    return true;
  });
}

export function toCandidateSource(item: SearchItem, summary?: string): CandidateSource {
  return {
    id: item.sourceId,
    url: item.url,
    title: item.title,
    author: item.author || null,
    publishedAt: item.publishedAt || null,
    readCount: item.metrics.views ?? null,
    likeCount: item.metrics.likes ?? null,
    commentCount: item.metrics.comments ?? null,
    favoriteCount: item.metrics.favorites ?? null,
    collectedAt: item.collectedAt,
    evidenceLevel: evidenceLevel(item),
    rawPayloadPath: item.rawPayloadPath,
    sourceType: "tikhub",
    summary: item.rawText || summary,
  };
}
