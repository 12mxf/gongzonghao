export const STEP_NAMES = [
  "source_search",
  "topic_cards",
  "rag_retrieval",
  "draft_generation",
  "image_plan",
  "image_generation",
  "html_layout",
  "asset_upload",
  "wechat_draft",
] as const;

export type StepName = (typeof STEP_NAMES)[number];
export type StepStatus = "pending" | "running" | "succeeded" | "failed";
export type RunStatus = "pending" | "running" | "succeeded" | "failed";
export type EvidenceKind = "viewpoint" | "quote" | "case" | "method" | "style";
export type EvidenceLevel = "可比较真实数据" | "真实数据候选" | "已发现·数据待补" | "不可入库";

export interface SearchItem {
  source: string;
  sourceId: string;
  url: string;
  title: string;
  author?: string;
  publishedAt?: string;
  collectedAt: string;
  metrics: {
    views?: number;
    likes?: number;
    comments?: number;
    favorites?: number;
  };
  rawText?: string;
  rawPayloadPath?: string;
}

export interface SearchInput {
  keyword: string;
  startAt?: string;
  endAt?: string;
  limit: number;
  runId: string;
}

export interface SearchProvider {
  search(input: SearchInput): Promise<SearchItem[]>;
}

export interface RunInput {
  keyword?: string;
  manualTitle?: string;
}

export interface CandidateSource {
  id: string;
  url: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  readCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  favoriteCount?: number | null;
  collectedAt?: string;
  evidenceLevel?: EvidenceLevel;
  rawPayloadPath?: string;
  sourceType: "demo" | "rss" | "tikhub" | "knowledge";
  summary?: string;
}

export interface TopicCard {
  id: string;
  title: string;
  angle: string;
  score: number;
  reason: string;
  sourceIds: string[];
}

export interface Evidence {
  id: string;
  sourceId: string;
  kind: EvidenceKind;
  content: string;
  score: number;
  title: string;
  author?: string;
}

export interface DraftBlock {
  key: string;
  heading?: string;
  content: string;
  sourceIds: string[];
}

export interface DraftDocument {
  title: string;
  digest: string;
  blocks: DraftBlock[];
  sourceIds: string[];
  complianceNotes: string[];
}

export interface ImageJob {
  id: string;
  role: "cover" | "inline";
  filename: string;
  prompt: string;
  ratio: string;
  sourceIds: string[];
}
