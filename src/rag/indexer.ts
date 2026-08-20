import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { WorkbenchDatabase } from "../db/database.js";
import type { EvidenceKind } from "../types.js";

const allowedKinds = new Set<EvidenceKind>(["viewpoint", "quote", "case", "method", "style"]);

function parseDocument(content: string, filePath: string) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  const meta: Record<string, string> = {};
  const body = match ? match[2].trim() : content.trim();
  if (match) {
    for (const line of match[1].split("\n")) {
      const separator = line.indexOf(":");
      if (separator > 0) meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
  }
  const kind = allowedKinds.has(meta.type as EvidenceKind) ? meta.type as EvidenceKind : "viewpoint";
  const sourceId = meta.sourceId || `kb-${createHash("sha1").update(filePath).digest("hex").slice(0, 12)}`;
  return { sourceId, kind, title: meta.title || path.basename(filePath, path.extname(filePath)), author: meta.author || "本地知识库", body };
}

function chunksOf(text: string, maxLength = 420) {
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > maxLength) { chunks.push(current); current = ""; }
    current = current ? `${current}\n${paragraph}` : paragraph;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function indexDirectory(db: WorkbenchDatabase, directory: string) {
  if (!fs.existsSync(directory)) return { files: 0, chunks: 0 };
  const files = fs.readdirSync(directory, { recursive: true })
    .map((entry) => path.join(directory, String(entry)))
    .filter((file) => fs.statSync(file).isFile() && /\.(md|txt)$/i.test(file));
  let chunkCount = 0;
  for (const file of files) {
    const doc = parseDocument(fs.readFileSync(file, "utf8"), file);
    chunksOf(doc.body).forEach((content, index) => {
      const contentHash = createHash("sha256").update(`${doc.sourceId}:${content}`).digest("hex");
      db.upsertRagChunk({
        id: `${doc.sourceId}-${index + 1}`, sourceId: doc.sourceId, kind: doc.kind,
        title: doc.title, author: doc.author, content, filePath: file, contentHash,
      });
      chunkCount += 1;
    });
  }
  return { files: files.length, chunks: chunkCount };
}
