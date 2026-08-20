import fs from "node:fs";
import path from "node:path";

type Level = "info" | "warn" | "error";

export class StructuredLogger {
  constructor(private readonly logDir: string) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  log(level: Level, event: string, fields: Record<string, unknown> = {}) {
    const entry = { timestamp: new Date().toISOString(), level, event, ...fields };
    const line = JSON.stringify(entry);
    fs.appendFileSync(path.join(this.logDir, "workbench.ndjson"), `${line}\n`, "utf8");
    if (process.env.NODE_ENV !== "test") {
      const writer = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      writer(line);
    }
  }

  info(event: string, fields?: Record<string, unknown>) { this.log("info", event, fields); }
  warn(event: string, fields?: Record<string, unknown>) { this.log("warn", event, fields); }
  error(event: string, fields?: Record<string, unknown>) { this.log("error", event, fields); }

  readForRun(runId: string, limit = 200) {
    const file = path.join(this.logDir, "workbench.ndjson");
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.runId === runId).slice(-limit);
  }
}
