import { describe, expect, it } from "vitest";
import { buildTopicCards, dedupeCandidates, titleSimilarity } from "../src/pipeline/topics.js";
import type { CandidateSource } from "../src/types.js";

const source = (id: string, title: string, url: string, reads: number): CandidateSource => ({
  id, title, url, author: "测试", publishedAt: "2026-08-01T00:00:00.000Z",
  readCount: reads, likeCount: 10, commentCount: 2, sourceType: "demo",
});

describe("选题去重与排序", () => {
  it("识别高度相似标题并保留公开指标更高者", () => {
    const a = source("a", "PET CT 检查前准备中最容易忽略的五个环节", "https://a.test/one", 100);
    const b = source("b", "PET/CT检查前准备：最容易忽略的5个环节", "https://b.test/two", 200);
    expect(titleSimilarity(a.title, b.title)).toBeGreaterThan(0.7);
    expect(dedupeCandidates([a, b])).toHaveLength(1);
    expect(dedupeCandidates([a, b])[0].id).toBe("b");
  });

  it("手动标题覆盖第一张选题卡且保留来源", () => {
    const cards = buildTopicCards([source("a", "候选标题", "https://a.test", 100)], "我的标题");
    expect(cards[0].title).toBe("我的标题");
    expect(cards[0].sourceIds).toEqual(["a"]);
  });
});
