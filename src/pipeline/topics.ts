import { createHash } from "node:crypto";
import type { CandidateSource, TopicCard } from "../types.js";

export function normalizeTitle(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").replace(/[一二三四五六七八九十]/g, (m) => "一二三四五六七八九十".indexOf(m) + 1 + "");
}

function bigrams(value: string) {
  const text = normalizeTitle(value);
  return new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2)));
}

export function titleSimilarity(a: string, b: string) {
  const left = bigrams(a); const right = bigrams(b);
  if (!left.size || !right.size) return normalizeTitle(a) === normalizeTitle(b) ? 1 : 0;
  const intersection = [...left].filter((item) => right.has(item)).length;
  return intersection / (left.size + right.size - intersection);
}

export function dedupeCandidates(items: CandidateSource[]) {
  const sorted = [...items].sort((a, b) => metricScore(b) - metricScore(a));
  return sorted.filter((item, index, all) => !all.slice(0, index).some((existing) =>
    canonicalUrl(existing.url) === canonicalUrl(item.url) || titleSimilarity(existing.title, item.title) >= 0.72));
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.search = ""; url.hash = "";
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch { return value; }
}

export function metricScore(item: CandidateSource) {
  const reads = Math.log10((item.readCount || 0) + 1) * 10;
  const engagement = Math.log10((item.likeCount || 0) * 3 + (item.commentCount || 0) * 8 + 1) * 8;
  const ageDays = item.publishedAt ? Math.max(0, (Date.now() - new Date(item.publishedAt).getTime()) / 86_400_000) : 365;
  const recency = Math.max(0, 14 - Math.log2(ageDays + 1) * 2);
  return Number((reads + engagement + recency).toFixed(2));
}

export function buildTopicCards(items: CandidateSource[], manualTitle?: string): TopicCard[] {
  const unique = dedupeCandidates(items).sort((a, b) => metricScore(b) - metricScore(a));
  const cards = unique.slice(0, 5).map((item, index) => ({
    id: `topic-${createHash("sha1").update(item.id).digest("hex").slice(0, 8)}`,
    title: index === 0 && manualTitle ? manualTitle : item.title,
    angle: item.summary || "围绕公开资料中的核心问题，结合本地知识库形成原创分析。",
    score: metricScore(item),
    reason: `公开指标与时效综合排序；可用指标：阅读 ${item.readCount ?? "未公开"}、点赞 ${item.likeCount ?? "未公开"}、评论 ${item.commentCount ?? "未公开"}`,
    sourceIds: [item.id],
  }));
  if (manualTitle && cards.length === 0) {
    cards.push({ id: "topic-manual", title: manualTitle, angle: "用户手动指定标题", score: 100, reason: "无候选文章时保留手动选题", sourceIds: [] });
  }
  return cards;
}
