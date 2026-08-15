/**
 * In-memory BM25 index — the replacement for SQLite FTS5.
 *
 * The FTS5 table it replaces existed for a constraint easywiki does not have:
 * the original service held ~300 wikis in one process and could not keep every
 * inverted index in memory. One wiki per process changes the arithmetic — a few
 * thousand pages of markdown is a few MB, so the index lives in a Map and is
 * rebuilt from the .md files whenever they change. Nothing is persisted, because
 * nothing here is a source of truth: the pages on disk are.
 *
 * Two fields per document (title, content) with the same 5.0 / 1.0 weighting the
 * FTS5 query used, and the same prefix matching (`token*`).
 */

const K1 = 1.2;
const B = 0.75;

/** Field weights — title matches count five times a body match, as before. */
const W_TITLE = 5.0;
const W_CONTENT = 1.0;

/** A single query token expands to at most this many indexed terms by prefix. */
const PREFIX_EXPANSION_CAP = 64;

/**
 * Stop words, in both languages the tokenizer handles. These are data, not
 * prose: dropping the CJK half would leave Chinese queries carrying grammar
 * particles as if they were search terms.
 *
 * The list only needs to catch the worst offenders — BM25's IDF already scores
 * a term that appears in most documents down to nearly nothing.
 */
const STOP_WORDS = new Set([
  // Chinese particles and question words: of / is / done / what / at / have /
  // and / with / toward / from
  "的", "是", "了", "什么", "在", "有", "和", "与", "对", "从",
  "the", "is", "a", "an", "what", "how", "are", "was", "were",
  "do", "does", "did", "be", "been", "being", "have", "has", "had",
  "it", "its", "in", "on", "at", "to", "for", "of", "with", "by",
  "this", "that", "these", "those",
]);

/**
 * CJK Unified Ideographs plus Extension A. A Unicode range, not text — it is
 * how the tokenizer decides whether a run needs bigram splitting. Chinese has
 * no spaces, so a whole sentence arrives as one token unless it is split here.
 */
const CJK = /[一-鿿㐀-䶿]/;

/**
 * Tokenizer — mixed Chinese/English.
 * - Latin: split on whitespace and punctuation, keep whole words, drop stop words.
 * - CJK: bigrams plus the whole run, so a two-character query still matches.
 *
 * Exported because query and document must be tokenized identically.
 */
export function tokenize(text: string): string[] {
  const rawTokens = text
    // Separators, ASCII and full-width alike. The full-width forms are the ones
    // real Chinese text actually uses; ASCII punctuation alone would leave a
    // whole clause glued together as a single token.
    .toLowerCase()
    .split(/[\s,，。！？、；：""''（）()\-_/\\·~～…\[\]【】{}《》<>]+/)
    .filter((t) => t.length > 0);

  const result: string[] = [];
  for (const token of rawTokens) {
    const hasCJK = CJK.test(token);
    const hasLatin = /[a-z]/.test(token);

    if (hasCJK && hasLatin) {
      // A run with no separator between a Latin part and a CJK part — common in
      // identifiers and version names. Split at the boundary so each side is
      // tokenized by its own rule.
      const parts = token.split(/(?<=[a-z0-9])(?=[一-鿿])|(?<=[一-鿿])(?=[a-z0-9])/);
      for (const part of parts) {
        if (CJK.test(part) && part.length > 1) {
          const chars = [...part];
          for (let i = 0; i < chars.length - 1; i++) result.push(chars[i] + chars[i + 1]);
          result.push(part);
        } else if (part.length > 0 && !STOP_WORDS.has(part)) {
          result.push(part);
        }
      }
    } else if (hasCJK && token.length > 1) {
      const chars = [...token];
      for (let i = 0; i < chars.length - 1; i++) result.push(chars[i] + chars[i + 1]);
      result.push(token);
    } else if (!STOP_WORDS.has(token) && token.length > 0) {
      result.push(token);
    }
  }
  return result;
}

export interface Bm25Doc {
  id: string;
  title: string;
  content: string;
}

/** Term frequency of one term in one document: [title, content]. */
type FieldTf = [number, number];

export interface Bm25Index {
  ids: string[];
  /** term → (document index → per-field term frequency) */
  postings: Map<string, Map<number, FieldTf>>;
  /** Sorted term list, so a prefix query is a binary search plus a walk. */
  terms: string[];
  /** Per-document field lengths in tokens. */
  lengths: FieldTf[];
  avgTitleLen: number;
  avgContentLen: number;
}

export function buildBm25(docs: Bm25Doc[]): Bm25Index {
  const ids: string[] = [];
  const postings = new Map<string, Map<number, FieldTf>>();
  const lengths: FieldTf[] = [];
  let totalTitle = 0;
  let totalContent = 0;

  docs.forEach((doc, i) => {
    ids.push(doc.id);
    const titleToks = tokenize(doc.title);
    const contentToks = tokenize(doc.content);
    lengths.push([titleToks.length, contentToks.length]);
    totalTitle += titleToks.length;
    totalContent += contentToks.length;

    const bump = (term: string, field: 0 | 1) => {
      let byDoc = postings.get(term);
      if (!byDoc) {
        byDoc = new Map();
        postings.set(term, byDoc);
      }
      const tf = byDoc.get(i);
      if (tf) tf[field] += 1;
      else byDoc.set(i, field === 0 ? [1, 0] : [0, 1]);
    };
    for (const t of titleToks) bump(t, 0);
    for (const t of contentToks) bump(t, 1);
  });

  const n = docs.length || 1;
  return {
    ids,
    postings,
    terms: [...postings.keys()].sort(),
    lengths,
    avgTitleLen: totalTitle / n,
    avgContentLen: totalContent / n,
  };
}

/** First index in `terms` whose value is >= target. */
function lowerBound(terms: string[], target: string): number {
  let lo = 0;
  let hi = terms.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (terms[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Indexed terms starting with `prefix`, capped so a short prefix cannot blow up. */
function expandPrefix(idx: Bm25Index, prefix: string): string[] {
  const out: string[] = [];
  for (let i = lowerBound(idx.terms, prefix); i < idx.terms.length; i++) {
    const term = idx.terms[i]!;
    if (!term.startsWith(prefix)) break;
    out.push(term);
    if (out.length >= PREFIX_EXPANSION_CAP) break;
  }
  return out;
}

function idf(df: number, n: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

/**
 * Score every document matching any query token; return the top `limit`.
 *
 * A query token that expands to several indexed terms by prefix contributes only
 * its best-scoring term per document, so a token is never counted twice for the
 * same document just because the prefix was broad.
 */
export function bm25Search(
  idx: Bm25Index,
  query: string,
  limit: number,
): Array<{ id: string; score: number }> {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0 || idx.ids.length === 0) return [];

  const n = idx.ids.length;
  const totals = new Map<number, number>();

  for (const qt of queryTokens) {
    const best = new Map<number, number>(); // document index → best score for this token
    for (const term of expandPrefix(idx, qt)) {
      const byDoc = idx.postings.get(term);
      if (!byDoc) continue;
      const termIdf = idf(byDoc.size, n);
      for (const [docIdx, tf] of byDoc) {
        const [lenTitle, lenContent] = idx.lengths[docIdx]!;
        const titlePart = fieldScore(tf[0], lenTitle, idx.avgTitleLen) * W_TITLE;
        const contentPart = fieldScore(tf[1], lenContent, idx.avgContentLen) * W_CONTENT;
        const score = termIdf * (titlePart + contentPart);
        if (score > (best.get(docIdx) ?? 0)) best.set(docIdx, score);
      }
    }
    for (const [docIdx, score] of best) {
      totals.set(docIdx, (totals.get(docIdx) ?? 0) + score);
    }
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(limit, 0))
    .map(([docIdx, score]) => ({ id: idx.ids[docIdx]!, score }));
}

function fieldScore(tf: number, len: number, avgLen: number): number {
  if (tf === 0) return 0;
  const norm = avgLen > 0 ? len / avgLen : 1;
  return (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * norm));
}
