import fs from "node:fs";
import path from "node:path";
import { createApplication } from "./app.js";

function seedDemo() {
  const source = path.resolve(process.cwd(), "tests/fixtures/corpus");
  const target = path.resolve(process.cwd(), "data/raw");
  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(source)) fs.copyFileSync(path.join(source, file), path.join(target, file));
  return target;
}

if (process.argv[2] === "demo") {
  const rawDir = seedDemo();
  const { db, pipeline } = createApplication();
  const runId = db.createRun({ keyword: "PET/CT 质量管理", manualTitle: "把 PET/CT 质量管理写成一条可追踪的证据链" });
  const result = await pipeline.run(runId);
  console.log(JSON.stringify({ runId, status: result?.status, mediaId: result?.draftMediaId,
    html: path.resolve(process.cwd(), `output/${runId}/article.html`), rawDir,
    imageStep: result?.steps.find((step) => String(step.name) === "image_generation")?.status }, null, 2));
  db.close();
} else if (process.argv[2] === "retry" && process.argv[3] && process.argv[4]) {
  const { db, pipeline } = createApplication();
  const runId = process.argv[3];
  const result = await pipeline.run(runId, process.argv[4] as import("./types.js").StepName, true);
  console.log(JSON.stringify({ runId, step: process.argv[4], status: result?.status }, null, 2));
  db.close();
} else {
  console.error("用法：npm run demo；或 npx tsx src/cli.ts retry <runId> <step>");
  process.exitCode = 1;
}
