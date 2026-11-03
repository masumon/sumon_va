// A tiny in-memory vector database.
//
// The personal corpus (a user's memories/tasks) is small — hundreds, maybe a few
// thousand short texts — so an exact brute-force cosine scan is instant and needs no
// ANN structure. Documents are embedded once; IDF is learned from the corpus so rare
// words dominate the match. The index is rebuilt from a corpus fingerprint, so it stays
// consistent with the database without any schema or migration.

import { cosineSimilarity, embed, tokenizeForEmbedding } from './vectorizer';

export interface VectorDoc<M = unknown> {
  id: string;
  text: string;
  meta: M;
}

export interface VectorHit<M = unknown> {
  id: string;
  score: number;
  meta: M;
}

export class VectorIndex<M = unknown> {
  private vectors = new Map<string, Float32Array>();
  private docs = new Map<string, VectorDoc<M>>();
  private idf = new Map<string, number>();

  get size(): number {
    return this.docs.size;
  }

  /** Replace the whole index with `documents` (embeds every doc, learns IDF first). */
  rebuild(documents: VectorDoc<M>[]): void {
    this.vectors.clear();
    this.docs.clear();
    this.idf.clear();

    const df = new Map<string, number>();
    for (const doc of documents) {
      for (const term of new Set(tokenizeForEmbedding(doc.text))) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
    const n = Math.max(1, documents.length);
    for (const [term, count] of df) this.idf.set(term, Math.log(1 + n / (1 + count)) + 1);

    for (const doc of documents) {
      this.docs.set(doc.id, doc);
      this.vectors.set(doc.id, embed(doc.text, { idf: this.idf, defaultIdf: Math.log(1 + n) + 1 }));
    }
  }

  /** Embed a query with the corpus IDF + synonym expansion. */
  embedQuery(text: string): Float32Array {
    const n = Math.max(1, this.docs.size);
    return embed(text, { idf: this.idf, defaultIdf: Math.log(1 + n) + 1, expand: true });
  }

  /** Top `k` documents by cosine similarity, best first, filtered by `minScore`. */
  query(text: string, k = 5, minScore = 0): VectorHit<M>[] {
    if (this.docs.size === 0) return [];
    const q = this.embedQuery(text);
    const hits: VectorHit<M>[] = [];
    for (const [id, vec] of this.vectors) {
      const score = cosineSimilarity(q, vec);
      if (score > minScore) hits.push({ id, score, meta: this.docs.get(id)!.meta });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }
}
