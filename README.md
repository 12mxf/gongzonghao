# 公众号内容工作台

一个可在本机运行的公众号内容生产流水线。它从公开/授权数据源发现候选选题，用本地知识库完成五类 RAG 召回，生成带 `sourceIds` 的原创初稿、图片计划和固定模板 HTML，最后只调用微信公众号官方“草稿”接口。项目没有自动发布能力。

## 已实现的最小可用版

1. 输入关键词，也可以手动指定标题。
2. `demo` 模式读取可复现的演示候选；`rss` 模式只读取你在 `.env` 明确配置的公开或已授权 RSS。
3. 保存来源 URL、标题、作者、时间及可获得的阅读/点赞/评论指标；拿不到的指标保存为 `null`，不会猜测。
4. 对 URL 和相似标题去重，综合公开指标与时效排序，生成选题卡。
5. 从 `data/raw/` 检索观点、原话、案例、方法卡和写作风格五类证据。
6. 生成原创结构化初稿。正文块、选题卡、图片任务均保留 `sourceIds`。
7. 输出封面和内页图任务包。只接受当前 Codex 会员内置 `image_gen` / Image2 生成的文件；应用本身不读取图片 API Key，也没有第三方付费回退。
8. 生成固定公众号模板 HTML。
9. mock 模式验证封面和正文图片的官方上传请求结构；real 模式调用微信官方素材接口。
10. mock 或真实调用 `draft/add` 创建草稿，返回 `media_id`。代码中没有 `freepublish`、`sendall` 等发布调用。
11. 每个 run 有唯一 `runId`，每一步记录 `pending / running / succeeded / failed`、执行次数、错误码和错误原因。
12. 成功步骤默认读取缓存。图片/排版等本地步骤可以显式重跑；已成功的上传和微信草稿步骤始终复用结果，避免重复上传或重复创建草稿。

## 环境要求

- Node.js 20 或更高版本
- npm 10 或更高版本
- macOS、Linux 或 Windows

## 安装与启动

```bash
cd content-workbench
npm install
cp .env.example .env
npm run demo
npm run dev
```

开发界面：`http://127.0.0.1:4310`

生产方式：

```bash
npm run build
npm start
```

生产界面：`http://127.0.0.1:4311`

`npm run demo` 会把 `tests/fixtures/corpus/` 复制到被 Git 忽略的 `data/raw/`，然后完整跑到本地 HTML 和微信 mock 草稿。图片尚未回填时，图片步骤保持 `pending` 并写明暂停原因；HTML 使用图片计划占位并继续生成。

## 配置

复制 `.env.example` 为 `.env`。密钥只能写在 `.env`，不要写入源码、README 或命令参数。

### 数据源

默认：

```dotenv
DATA_SOURCE_MODE=demo
```

使用公开或已授权 RSS：

```dotenv
DATA_SOURCE_MODE=rss
PUBLIC_RSS_FEEDS=https://example.com/feed.xml,https://example.org/rss
```

RSS 适配器只读取明确配置的地址，不绕过登录、不抓取受限页面。RSS 没有公开互动指标时，对应字段保持空值。

### 本地知识库

把 Markdown 或 TXT 放入 `data/raw/`。推荐 Markdown 头部：

```markdown
---
sourceId: my-note-001
type: viewpoint
title: 资料标题
author: 作者或来源
---
正文内容
```

`type` 可选：`viewpoint`、`quote`、`case`、`method`、`style`。没有标注时按 `viewpoint` 处理。索引切片保存在 SQLite 的 `rag_chunks` 表；本地语料、索引和数据库都被 `.gitignore` 忽略。

### Codex 会员图片桥接

默认配置：

```dotenv
IMAGE_PROVIDER_MODE=codex_manual
```

执行到图片计划后会生成：

```text
output/<runId>/image-jobs.json
```

在当前 Codex 会话中，让内置 `image_gen` / Image2 按该文件生成图片。不要使用 CLI/API Key 回退。把最终图片按任务里的固定文件名放到：

```text
data/image-inbox/<runId>/cover.png
data/image-inbox/<runId>/inline-method.png
```

然后在页面点击“图片生成”的“重跑”，再重跑“模板排版”。如果内置能力不可用，就让图片步骤保持暂停；不要配置 `OPENAI_API_KEY` 或第三方付费接口。

### 微信公众号

无凭证验收：

```dotenv
WECHAT_MODE=mock
```

真实创建草稿：

```dotenv
WECHAT_MODE=real
WECHAT_APP_ID=你的 AppID
WECHAT_APP_SECRET=你的 AppSecret
```

真实模式调用的官方路径仅包括：

- `cgi-bin/token`
- `cgi-bin/material/add_material?type=thumb`
- `cgi-bin/media/uploadimg`
- `cgi-bin/draft/add`

没有封面图时真实上传会失败并给出原因，不会使用假 `media_id`。无论配置如何，项目都不会自动发布。

## 运行、重跑与产物

页面中失败或暂停的步骤会显示“重跑”。成功的本地步骤也可通过 API/CLI 显式重建；成功的上传和草稿步骤会命中缓存。

命令行单独重跑示例：

```bash
npx tsx src/cli.ts retry <runId> image_generation
npx tsx src/cli.ts retry <runId> html_layout
```

步骤名：

```text
source_search
topic_cards
rag_retrieval
draft_generation
image_plan
image_generation
html_layout
asset_upload
wechat_draft
```

每次任务产物位于 `output/<runId>/`：

- `topic-cards.json`：去重、排序后的选题卡
- `rag-evidence.json`：五类召回证据
- `draft.json`：带 `sourceIds` 的结构化初稿
- `image-jobs.json`：Codex 内置图片任务包
- `article.html`：最终本地预览

结构化日志位于 `logs/workbench.ndjson`，也可读取 `GET /api/runs/<runId>/logs`。页面刷新后历史任务和步骤状态会从 SQLite 恢复。

## API

- `GET /api/health`：运行模式与安全开关
- `GET /api/runs`：历史任务
- `GET /api/runs/:runId`：任务、步骤、来源、证据和产物
- `POST /api/runs`：创建并运行任务
- `POST /api/runs/:runId/run`：继续未成功步骤
- `POST /api/runs/:runId/steps/:step/retry`：单独重跑步骤
- `GET /api/runs/:runId/logs`：结构化日志

创建任务请求：

```json
{
  "keyword": "PET/CT 质量管理",
  "manualTitle": "把质量管理写成一条可追踪的证据链"
}
```

## 测试

```bash
npm test
npm run build
npm run check
```

当前测试覆盖：相似标题去重、公开指标排序、五类 RAG 召回、完整演示流水线、本地 HTML、mock `media_id`、步骤幂等，以及重启后 SQLite 历史任务恢复。

## 常见错误

### `本地知识库没有可检索语料`

运行 `npm run demo`，或把带内容的 `.md` / `.txt` 文件放到 `data/raw/`。

### 图片步骤显示 `PAUSED`

这是安全暂停，不是自动降级。检查 `output/<runId>/image-jobs.json`，用当前 Codex 会员内置图片能力生成后放入对应 inbox，再重跑图片和排版。

### `WECHAT_APP_ID / WECHAT_APP_SECRET 未配置`

没有凭证时使用 `WECHAT_MODE=mock`。需要真实草稿时，在本地 `.env` 配置公众号凭证；不要把凭证发到聊天或提交到 Git。

### 微信返回 `invalid ip` / `40164`

在微信公众平台把当前出口 IP 加入白名单，然后只重跑失败的微信步骤。

### 微信返回素材或草稿参数错误

查看对应步骤的 `errorMessage` 和 `logs/workbench.ndjson`。确认封面已生成、图片格式受微信支持、标题/摘要长度没有超过公众号限制。

### 端口被占用

开发界面默认使用 `4310`，API 使用 `4311`。可在 `.env` 修改 `PORT`；如修改 API 端口，同时更新 `vite.config.ts` 的开发代理地址。

## 目录

```text
src/adapters/    数据搜索、写作、图片、微信官方接口
src/rag/         本地切片、索引、分类型召回
src/pipeline/    去重排序与阶段编排
src/templates/   固定公众号 HTML 模板
src/db/          SQLite 结构和访问层
data/raw/        本地语料（Git 忽略）
data/index/      预留索引目录（Git 忽略）
output/<runId>/  每次任务产物（Git 忽略）
tests/           单元与集成测试
```
