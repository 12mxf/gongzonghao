import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchDatabase } from "../src/db/database.js";
import { indexDirectory } from "../src/rag/indexer.js";
import { retrieveByKinds } from "../src/rag/retriever.js";

const tempDirs: string[] = [];
afterEach(() => tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("本地知识库 RAG", () => {
  it("分别召回观点、原话、案例、方法和风格，并保留 sourceId", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "workbench-rag-")); tempDirs.push(temp);
    const corpus = path.join(temp, "corpus");
    fs.cpSync(path.resolve("tests/fixtures/corpus"), corpus, { recursive: true });
    const db = new WorkbenchDatabase(":memory:");
    const result = indexDirectory(db, corpus);
    const evidence = retrieveByKinds(db, "PET CT 质量 证据 写作");
    expect(result.files).toBe(5);
    expect(new Set(evidence.map((item) => item.kind))).toEqual(new Set(["viewpoint", "quote", "case", "method", "style"]));
    expect(evidence.every((item) => item.sourceId.startsWith("kb-"))).toBe(true);
    db.close();
  });
});
