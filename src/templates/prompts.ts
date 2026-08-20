import type { DraftDocument, ImageJob } from "../types.js";

export function buildImageJobs(draft: DraftDocument): ImageJob[] {
  const shared = "原创编辑视觉，不使用任何文章配图，不出现患者身份信息，不生成虚构数据图表";
  return [
    {
      id: "cover", role: "cover", filename: "cover.png", ratio: "2.35:1",
      prompt: `公众号封面，标题主题：${draft.title}。现代编辑设计，米白纸张质感，深墨绿与暖橙，抽象流程节点与证据卡片，留出清晰标题区。${shared}`,
      sourceIds: draft.sourceIds,
    },
    {
      id: "inline-method", role: "inline", filename: "inline-method.png", ratio: "16:9",
      prompt: `公众号内页图，主题：证据如何沿着流程节点被记录和核验。清晰的卡片式信息结构，无具体数值，无品牌标识。${shared}`,
      sourceIds: draft.blocks.find((block) => block.key === "method")?.sourceIds || draft.sourceIds,
    },
  ];
}
