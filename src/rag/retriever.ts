import type { WorkbenchDatabase } from "../db/database.js";
import type { Evidence, EvidenceKind } from "../types.js";

const kinds: EvidenceKind[] = ["viewpoint", "quote", "case", "method", "style"];

function chars(value: string) {
  return new Set(value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ""));
}

function relevance(query: string, text: string) {
  const queryChars = chars(query); const textChars = chars(text);
  if (!queryChars.size) return 0.5;
  const overlap = [...queryChars].filter((char) => textChars.has(char)).length;
  const coverage = overlap / queryChars.size;
  const density = overlap / Math.max(1, Math.sqrt(textChars.size * queryChars.size));
  return Number((coverage * 0.72 + density * 0.28).toFixed(4));
}

export function retrieveByKinds(db: WorkbenchDatabase, query: string, limitPerKind = 2): Evidence[] {
  return kinds.flatMap((kind) => {
    const rows = db.listRagChunks(kind);
    return rows.map((row) => ({
      id: String(row.id), sourceId: String(row.source_id), kind,
      title: String(row.title), author: row.author ? String(row.author) : undefined,
      content: String(row.content), score: relevance(query, `${row.title} ${row.content}`),
    })).sort((a, b) => b.score - a.score).slice(0, limitPerKind);
  });
}
