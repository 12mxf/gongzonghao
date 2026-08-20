import type { StructuredLogger } from "./logger.js";

export interface HttpClientOptions {
  timeoutMs: number;
  maxRetries: number;
  logger: StructuredLogger;
  retryBaseDelayMs?: number;
}

class NonRetryableHttpError extends Error {}

async function safeHttpError(response: Response) {
  const status = `HTTP ${response.status}`;
  try {
    const payload = JSON.parse(await response.text()) as Record<string, unknown>;
    const detail = payload.detail && typeof payload.detail === "object" ? payload.detail as Record<string, unknown> : payload;
    const value = detail.message_zh || detail.message || (typeof detail.detail === "string" ? detail.detail : undefined);
    if (typeof value !== "string") return status;
    const sanitized = value.replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]").slice(0, 500);
    return `${status}: ${sanitized}`;
  } catch {
    return status;
  }
}

export class HttpClient {
  constructor(private readonly options: HttpClientOptions) {}

  async request(url: string, init: RequestInit = {}, context: Record<string, unknown> = {}) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.options.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok && (response.status >= 500 || response.status === 429)) {
          throw new Error(`HTTP ${response.status}`);
        }
        if (!response.ok) throw new NonRetryableHttpError(await safeHttpError(response));
        clearTimeout(timer);
        return response;
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof NonRetryableHttpError) throw error;
        lastError = error;
        this.options.logger.warn("external_request_retry", {
          ...context, url: new URL(url).origin, attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        if (attempt < this.options.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, (this.options.retryBaseDelayMs ?? 200) * 2 ** (attempt - 1)));
        }
      }
    }
    throw lastError;
  }
}
