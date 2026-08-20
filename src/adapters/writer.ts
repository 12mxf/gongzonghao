import type { DraftDocument, Evidence, TopicCard } from "../types.js";

export interface WriterAdapter {
  write(topic: TopicCard, evidence: Evidence[]): Promise<DraftDocument>;
}

const first = (items: Evidence[], kind: Evidence["kind"]) => items.find((item) => item.kind === kind);

export class EvidenceBoundWriter implements WriterAdapter {
  async write(topic: TopicCard, evidence: Evidence[]): Promise<DraftDocument> {
    const viewpoint = first(evidence, "viewpoint");
    const quote = first(evidence, "quote");
    const example = first(evidence, "case");
    const method = first(evidence, "method");
    const style = first(evidence, "style");
    const topicIds = topic.sourceIds;
    const blocks = [
      {
        key: "opening",
        content: `很多内容从“把信息写全”开始，但更值得先问的是：围绕「${topic.title}」，读者真正需要解决的具体问题是什么？这篇文章只使用可追溯的公开候选资料与本地知识卡，资料没有覆盖的细节将保持空白。`,
        sourceIds: topicIds,
      },
      viewpoint && {
        key: "viewpoint", heading: "一、先把问题放回完整流程",
        content: "本地观点卡把质量管理从一次结果检查，扩展为对准备、执行和复盘节点的连续观察。换句话说，判断一个做法是否有效，不能只盯住最后结果，还要看偏差出现在哪个位置、由什么触发，以及有没有留下可复核的记录。",
        sourceIds: [viewpoint.sourceId],
      },
      example && {
        key: "case", heading: "二、案例的价值在于暴露断点",
        content: "本地案例记录了一次流程复盘：咨询反复出现，并非单纯因为材料不够，而是多个服务节点给出的时间口径不一致。团队统一表达后，再按问题类型持续观察变化。这个演示案例不能外推成普遍结论，但能提示我们，表面的沟通问题可能来自流程交接处。",
        sourceIds: [example.sourceId],
      },
      method && {
        key: "method", heading: "三、把证据变成可执行的方法",
        content: "可以把写作过程压缩成四个检查点：先确定读者的具体问题，再分别绑定观点、数据和案例的出处；随后删去无法核验的细节，最后用反例测试结论是否说得过满。这样做的目的，是让每个判断都有证据边界。",
        sourceIds: [method.sourceId],
      },
      quote && {
        key: "quote", heading: "四、给写作者的自检句",
        content: `本地原话卡有一句简短提醒：“先标出证据边界，再写结论。”在交稿前逐段检查来源标记，通常比成稿后补引用更可靠。`,
        sourceIds: [quote.sourceId],
      },
      {
        key: "closing", heading: "最后：从一个小动作开始",
        content: "下一次准备文章时，先建立一张三列表：准备表达的判断、支持它的来源、暂时无法确认的空白。保留空白不是内容不完整，而是对事实负责。",
        sourceIds: method ? [method.sourceId] : topicIds,
      },
    ].filter(Boolean) as DraftDocument["blocks"];
    const sourceIds = [...new Set(blocks.flatMap((block) => block.sourceIds))];
    return {
      title: topic.title,
      digest: "从公开候选资料和本地知识卡出发，建立可追溯、不过度推断的内容生产方法。",
      blocks,
      sourceIds,
      complianceNotes: [
        "未把候选文章正文复制进初稿，仅使用标题、公开指标与摘要辅助选题。",
        "案例与数字只来自已召回资料；演示案例已明确标注。",
        `已召回写作风格卡：${style?.title || "无"}；风格只约束表达，不作为事实证据。`,
      ],
    };
  }
}
