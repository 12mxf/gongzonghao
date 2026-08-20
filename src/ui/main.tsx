import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Status = "pending" | "running" | "succeeded" | "failed";
type Step = { name: string; status: Status; attempt: number; errorCode?: string; errorMessage?: string; output?: Record<string, unknown> };
type Source = { id: string; title: string; url: string; author?: string; publishedAt?: string; readCount?: number; likeCount?: number; commentCount?: number; sourceType: string };
type Artifact = { id: number; kind: string; localPath?: string; mediaId?: string };
type Run = {
  id: string; keyword?: string; manualTitle?: string; status: Status; finalTitle?: string; draftMediaId?: string;
  createdAt: string; updatedAt: string; steps: Step[]; sources: Source[]; artifacts: Artifact[];
};

const stepLabels: Record<string, string> = {
  source_search: "搜索候选", topic_cards: "选题卡", rag_retrieval: "知识召回",
  draft_generation: "原创初稿", image_plan: "图片计划", image_generation: "图片生成",
  html_layout: "模板排版", asset_upload: "图片上传", wechat_draft: "微信草稿",
};
const statusLabels: Record<Status, string> = { pending: "待处理", running: "运行中", succeeded: "已完成", failed: "失败" };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "请求失败");
  return body;
}

function App() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [keyword, setKeyword] = useState("PET/CT 质量管理");
  const [manualTitle, setManualTitle] = useState("把 PET/CT 质量管理写成一条可追踪的证据链");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Record<string, unknown>>({});
  const selected = runs.find((run) => run.id === selectedId) || runs[0];
  const completed = selected?.steps.filter((step) => step.status === "succeeded").length || 0;

  const load = async (preferredId?: string) => {
    const [{ runs: nextRuns }, nextHealth] = await Promise.all([
      json<{ runs: Run[] }>("/api/runs"), json<Record<string, unknown>>("/api/health"),
    ]);
    setRuns(nextRuns); setHealth(nextHealth);
    if (preferredId) setSelectedId(preferredId);
    else if (!selectedId && nextRuns[0]) setSelectedId(nextRuns[0].id);
  };
  useEffect(() => { load().catch((caught) => setError(caught.message)); }, []);

  const createRun = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { run } = await json<{ run: Run }>("/api/runs", { method: "POST", body: JSON.stringify({ keyword, manualTitle }) });
      await load(run.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const retry = async (step: Step) => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const { run } = await json<{ run: Run }>(`/api/runs/${selected.id}/steps/${step.name}/retry`, { method: "POST", body: "{}" });
      await load(run.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const metrics = useMemo(() => ({
    total: runs.length,
    succeeded: runs.filter((run) => run.status === "succeeded").length,
    sources: runs.reduce((sum, run) => sum + run.sources.length, 0),
  }), [runs]);

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">文</span><div><strong>内容工作台</strong><small>WECHAT STUDIO</small></div></div>
      <nav>
        <button className="nav-item active"><span>01</span>生产流水线</button>
        <button className="nav-item"><span>02</span>知识来源</button>
        <button className="nav-item"><span>03</span>图片任务</button>
        <button className="nav-item"><span>04</span>草稿记录</button>
      </nav>
      <div className="safety-note"><span className="safety-dot"/><strong>仅创建草稿</strong><p>发布能力未启用。所有内容保留来源追踪。</p></div>
      <div className="mode-chip">微信 {String(health.wechatMode || "—")} · 图片 {String(health.imageMode || "—")}</div>
    </aside>
    <main className="workspace">
      <header className="topbar">
        <div><p className="eyebrow">CONTENT OPERATIONS</p><h1>公众号内容工作台</h1></div>
        <div className="top-actions"><span className="local-pill"><i/>本地运行</span><button onClick={() => load(selected?.id)} className="icon-button" aria-label="刷新">↻</button></div>
      </header>

      <section className="hero-grid">
        <form className="new-run" onSubmit={createRun}>
          <div className="section-kicker">新建内容任务</div>
          <h2>从一个可信的选题开始</h2>
          <p>公开来源负责发现问题，本地知识库负责形成观点。每一步都可以单独重跑。</p>
          <label>搜索关键词<input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="例如：PET/CT 质量管理" /></label>
          <label>手动标题 <em>可选</em><input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="已有标题时直接填写" /></label>
          {error && <div className="error-banner">{error}</div>}
          <button className="primary" disabled={busy}>{busy ? "正在执行流水线…" : "开始生成任务 →"}</button>
        </form>
        <div className="overview">
          <div className="overview-head"><span>工作台概览</span><small>SQLite 持久化</small></div>
          <div className="metric-grid">
            <div><strong>{metrics.total}</strong><span>历史任务</span></div>
            <div><strong>{metrics.succeeded}</strong><span>完成任务</span></div>
            <div><strong>{metrics.sources}</strong><span>已存来源</span></div>
            <div><strong>0</strong><span>自动发布</span></div>
          </div>
          <div className="rule-list"><p><b>01</b> 成功步骤读取缓存</p><p><b>02</b> 上传请求结构可预览</p><p><b>03</b> 图片能力不可用时暂停</p></div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel pipeline-panel">
          <div className="panel-title"><div><span className="section-kicker">当前流水线</span><h2>{selected?.finalTitle || selected?.manualTitle || "尚未创建任务"}</h2></div>{selected && <span className={`status ${selected.status}`}>{statusLabels[selected.status]}</span>}</div>
          {selected ? <>
            <div className="run-meta"><code>{selected.id}</code><span>{new Date(selected.createdAt).toLocaleString("zh-CN")}</span><span>{completed}/9 完成</span></div>
            <div className="progress"><i style={{ width: `${completed / 9 * 100}%` }}/></div>
            <div className="steps">{selected.steps.map((step, index) => <div className={`step-row ${step.status}`} key={step.name}>
              <div className="step-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="step-copy"><strong>{stepLabels[step.name]}</strong><span>{step.errorMessage || (step.status === "succeeded" ? `已完成 · 执行 ${step.attempt} 次` : "等待执行")}</span></div>
              <span className={`status ${step.status}`}>{statusLabels[step.status]}</span>
              {(step.status === "failed" || (step.status === "pending" && step.errorCode === "PAUSED")) && <button className="retry" onClick={() => retry(step)} disabled={busy}>重跑</button>}
              {step.status === "succeeded" && <span className="cache">缓存</span>}
            </div>)}</div>
            <div className="deliverables">
              <a className={selected.artifacts.some((item) => item.kind === "article_html") ? "deliverable" : "deliverable disabled"} href={`/output/${selected.id}/article.html`} target="_blank" rel="noreferrer"><span>HTML</span><div><strong>预览最终排版</strong><small>固定公众号模板</small></div>↗</a>
              <div className="deliverable"><span>ID</span><div><strong>{selected.draftMediaId || "等待创建"}</strong><small>草稿 media_id</small></div></div>
            </div>
          </> : <div className="empty">创建第一个任务后，九个阶段会在这里逐项留下状态和产物。</div>}
        </div>
        <div className="side-stack">
          <div className="panel history-panel"><div className="panel-title"><h2>历史任务</h2><span>{runs.length}</span></div><div className="history-list">{runs.map((run) => <button key={run.id} className={run.id === selected?.id ? "history active" : "history"} onClick={() => setSelectedId(run.id)}><i className={run.status}/><div><strong>{run.finalTitle || run.manualTitle || run.keyword}</strong><small>{run.id} · {new Date(run.createdAt).toLocaleDateString("zh-CN")}</small></div></button>)}</div></div>
          <div className="panel source-panel"><div className="panel-title"><h2>当前来源</h2><span>{selected?.sources.length || 0}</span></div>{selected?.sources.slice(0, 5).map((source) => <a href={source.url.startsWith("http") ? source.url : undefined} key={source.id} className="source-item" target="_blank" rel="noreferrer"><span>{source.sourceType === "knowledge" ? "知" : "源"}</span><div><strong>{source.title}</strong><small>{source.author || "作者未公开"} · {source.readCount ? `${source.readCount.toLocaleString()} 阅读` : "公开指标未提供"}</small></div></a>) || <div className="empty small">暂无来源</div>}</div>
        </div>
      </section>
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
