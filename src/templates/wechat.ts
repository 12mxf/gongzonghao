import path from "node:path";
import type { CandidateSource, DraftDocument, ImageJob } from "../types.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char] || char));

export function renderWechatHtml(input: {
  runId: string;
  draft: DraftDocument;
  sources: CandidateSource[];
  imageJobs: ImageJob[];
  images: Array<{ jobId: string; localPath: string }>;
}) {
  const { runId, draft, sources, imageJobs, images } = input;
  const inline = images.find((image) => image.jobId === "inline-method");
  const inlinePlan = imageJobs.find((job) => job.id === "inline-method");
  const blocks = draft.blocks.map((block) => {
    const heading = block.heading ? `<h2 style="font-size:22px;line-height:1.45;margin:42px 0 16px;color:#173b33;font-weight:700;">${escapeHtml(block.heading)}</h2>` : "";
    const image = block.key === "method" ? (inline
      ? `<img src="${escapeHtml(path.basename(inline.localPath))}" alt="证据流程内页图" style="display:block;width:100%;margin:22px 0;border-radius:8px;" />`
      : `<section style="margin:22px 0;padding:24px;background:#f0f4ef;border-left:4px solid #e98053;color:#527069;font-size:14px;">内页图计划：${escapeHtml(inlinePlan?.prompt || "待生成")}</section>`) : "";
    return `${heading}<p style="font-size:17px;line-height:1.9;margin:0 0 18px;color:#283d38;letter-spacing:.02em;">${escapeHtml(block.content)}</p>${image}`;
  }).join("\n");
  const usedSources = sources.filter((source) => draft.sourceIds.includes(source.id));
  const references = usedSources.length ? usedSources.map((source, index) => {
    const label = escapeHtml(source.title);
    const reference = /^https?:\/\//.test(source.url) ? `<a href="${escapeHtml(source.url)}" style="color:#287b68;">${label}</a>` : `<span>${label}（本地知识库）</span>`;
    return `<li style="margin:8px 0;word-break:break-all;">${index + 1}. ${reference}</li>`;
  }).join("") : "<li>本稿主要使用本地知识卡；候选文章仅用于选题。</li>";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(draft.title)}</title></head>
<body style="margin:0;background:#f4f0e8;color:#283d38;"><main style="max-width:720px;margin:0 auto;background:#fff;padding:48px 34px 64px;box-sizing:border-box;">
  <section style="margin-bottom:36px;border-top:8px solid #173b33;padding-top:28px;">
    <p style="margin:0 0 12px;color:#e06f43;font-size:13px;letter-spacing:.18em;font-weight:700;">证据写作 · 公众号内容工作台</p>
    <h1 style="font-size:32px;line-height:1.35;margin:0 0 18px;color:#173b33;">${escapeHtml(draft.title)}</h1>
    <p style="font-size:16px;line-height:1.8;color:#6b7d77;margin:0;">${escapeHtml(draft.digest)}</p>
  </section>
  ${blocks}
  <section style="margin-top:48px;padding:24px;background:#fbf7f0;border-radius:8px;">
    <h2 style="font-size:18px;margin:0 0 12px;color:#173b33;">资料边界与来源</h2>
    <ul style="padding-left:20px;margin:0;color:#66746f;font-size:13px;line-height:1.7;">${references}</ul>
    <p style="font-size:12px;color:#95a09c;margin:18px 0 0;">runId: ${escapeHtml(runId)} · 每个正文块的 sourceIds 已保存在本地数据库。</p>
  </section>
</main></body></html>`;
}
