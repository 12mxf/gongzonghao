import "dotenv/config";
import path from "node:path";

const cwd = process.cwd();
const resolveLocal = (value: string | undefined, fallback: string) =>
  path.resolve(cwd, value || fallback);

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(overrides: Partial<Record<string, string>> = {}) {
  const env = { ...process.env, ...overrides };
  return {
    port: Number(env.PORT || 4311),
    baseUrl: env.APP_BASE_URL || "http://127.0.0.1:4311",
    databasePath: resolveLocal(env.DATABASE_PATH, "./data/workbench.sqlite"),
    logDir: resolveLocal(env.LOG_DIR, "./logs"),
    outputDir: resolveLocal(env.OUTPUT_DIR, "./output"),
    rawDataDir: resolveLocal(env.RAW_DATA_DIR, "./data/raw"),
    sourceMode: env.DATA_SOURCE_MODE || "demo",
    rssFeeds: (env.PUBLIC_RSS_FEEDS || "").split(",").map((v) => v.trim()).filter(Boolean),
    dataProviderKey: env.DATA_PROVIDER_KEY || "",
    tikhubBaseUrl: env.TIKHUB_BASE_URL || "https://api.tikhub.dev",
    searchResultLimit: Math.max(1, Math.min(50, Number(env.SEARCH_RESULT_LIMIT || 20))),
    sogouMaxPages: Math.max(1, Math.min(5, Number(env.SOGOU_MAX_PAGES || 3))),
    httpTimeoutMs: Number(env.HTTP_TIMEOUT_MS || 10_000),
    httpMaxRetries: Number(env.HTTP_MAX_RETRIES || 3),
    imageMode: env.IMAGE_PROVIDER_MODE || "codex_manual",
    imageInboxDir: resolveLocal(env.IMAGE_INBOX_DIR, "./data/image-inbox"),
    wechatMode: env.WECHAT_MODE || "mock",
    wechatAppId: env.WECHAT_APP_ID || "",
    wechatAppSecret: env.WECHAT_APP_SECRET || "",
  };
}
