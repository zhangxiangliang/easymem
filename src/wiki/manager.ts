/**
 * Wiki Source Manager — registration, scanning, indexing and query lifecycle.
 *
 * Pages are plain markdown files on disk; the calling agent writes them.
 *
 * Everything the search path needs — page metadata, the BM25 index and the link
 * graph — is held in memory and rebuilt from the .md files. There is no index
 * store to keep in sync, because the pages are the only source of truth. One
 * wiki per process makes this cheap: a few thousand pages rebuild in ~200 ms.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import Graph from "graphology";
import type {
  WikiPage,
  WikiSourceConfig,
  WikiSourceState,
  GraphNode,
  GraphEdge,
  CommunityInfo,
  SearchResult,
  SearchResponse,
  RelatedPage,
  ResultLink,
} from "./types.js";
import { graphMultiHopSearch } from "./graph-search.js";
import { buildBm25, bm25Search, type Bm25Index } from "./bm25.js";
import { createLogger } from "../logger.js";
import { slugify } from "./slug.js";

const log = createLogger("wiki-mgr");

// ── Inline frontmatter / wikilink parsing ──

function extractFrontmatter(content: string): { title: string; type: string; sources: string[]; description: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  const fm = fmMatch ? fmMatch[1] : "";
  const titleMatch = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  const typeMatch = fm.match(/^type:\s*["']?(.+?)["']?\s*$/m);
  const descMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  const sources: string[] = [];
  const sourcesBlockMatch = fm.match(/^sources:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (sourcesBlockMatch) {
    for (const line of sourcesBlockMatch[1].split("\n")) {
      const itemMatch = line.match(/^\s+-\s+["']?(.+?)["']?\s*$/);
      if (itemMatch) sources.push(itemMatch[1]);
    }
  } else {
    const inlineMatch = fm.match(/^sources:\s*\[([^\]]*)\]/m);
    if (inlineMatch) {
      for (const item of inlineMatch[1].split(",")) {
        const trimmed = item.trim().replace(/^["']|["']$/g, "");
        if (trimmed) sources.push(trimmed);
      }
    }
  }
  let title = titleMatch ? titleMatch[1].trim() : "";
  if (!title) {
    const headingMatch = content.match(/^#\s+(.+)$/m);
    title = headingMatch ? headingMatch[1].trim() : "";
  }
  return {
    title,
    type: typeMatch ? typeMatch[1].trim().toLowerCase() : "other",
    sources,
    description: descMatch ? descMatch[1].trim() : "",
  };
}

/**
 * Every `[[target]]` in a page, deduplicated, ignoring anything inside code.
 *
 * Code has to be stripped first or a page that documents the link syntax links
 * to it. Writing `` `[[Page Title]]` `` in a sentence about how linking works
 * produced an edge to a page called "Page Title", and a dangling-link report
 * pointing at prose that was never a link.
 */
function extractWikilinks(content: string): string[] {
  const prose = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ");

  const links = new Set<string>();
  const regex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(prose)) !== null) {
    const target = match[1]!.trim();
    if (target) links.add(target);
  }
  return [...links];
}

// ── Manager Interface ──

export interface SearchOptions {
  /** Multi-hop expansion depth (PRD FR-3). 0 = pure BM25. Range 0~5. */
  hop?: number;
  /** Per-hop score decay factor (0~1). */
  decay?: number;
  /** Minimum score threshold; nodes below this are dropped. */
  minScore?: number;
}

export interface WikiSourceManager {
  register(config: WikiSourceConfig): WikiSourceState;
  sync(name: string): WikiSourceState;
  get(name: string): WikiSourceState | undefined;
  list(): WikiSourceState[];
  remove(name: string): void;
  search(name: string, query: string, limit?: number, options?: SearchOptions): SearchResponse;
  graph(name: string): { nodes: GraphNode[]; edges: GraphEdge[]; communities: CommunityInfo[] };
  readPage(name: string, relPath: string): string | null;
  getPages(name: string): WikiPage[];
  init(config: WikiSourceConfig): WikiSourceState;
}

/** Page types kept out of the graph: scaffolding, not knowledge. */
const HIDDEN_TYPES = new Set(["query", "index", "purpose", "schema"]);

// ── Graph structures, built once per rebuild and read on every query ──

export interface PageGraph {
  /** Public view (filtered, with linkCount/community). */
  view: { nodes: GraphNode[]; edges: GraphEdge[]; communities: CommunityInfo[] };
  /** graphology instance — undirected, no multi-edges. Used for multi-hop BFS. */
  graph: Graph;
  /** Per-page directed wikilink adjacency (id -> outgoing target ids). */
  outAdj: Map<string, Set<string>>;
  /** Per-page reverse adjacency (id -> ids whose page links into this one). */
  inAdj: Map<string, Set<string>>;
  /** Degree (= linkCount in nodes view). */
  degree: Map<string, number>;
}

/** Page metadata for search results. The body stays on disk; snippet is precomputed. */
interface PageMeta {
  id: string;
  title: string;
  type: string;
  relPath: string;
  snippet: string;
}

/** Everything needed to answer a query, held in memory, rebuilt from the pages. */
interface WikiIndex {
  metaById: Map<string, PageMeta>;
  bm25: Bm25Index;
  pg: PageGraph;
}

/**
 * Resolve the [[wikilinks]] between pages into directed edges.
 * Only visible pages take part; self-loops, unresolvable targets and duplicate
 * (source, target) pairs are dropped.
 */
function resolveEdges(pages: WikiPage[]): Array<{ source: string; target: string }> {
  const visible = pages.filter((p) => !HIDDEN_TYPES.has(p.type));
  const out: Array<{ source: string; target: string }> = [];
  if (visible.length === 0) return out;

  // Three lookup tables, built once. Resolving a wikilink used to scan every
  // node id and slugify it per candidate — O(pages × links × pages), which cost
  // 10s on a 5k-page wiki. Precomputing makes each resolve a map hit.
  const nodeIds = new Set(visible.map((p) => p.id));
  const lowerIdToId = new Map<string, string>();
  const basenameSlugToId = new Map<string, string>();
  const titleSlugToId = new Map<string, string>();
  for (const p of visible) {
    const lower = p.id.toLowerCase();
    if (!lowerIdToId.has(lower)) lowerIdToId.set(lower, p.id);

    const bs = slugify(p.id.split("/").pop() ?? p.id);
    if (bs && !basenameSlugToId.has(bs)) basenameSlugToId.set(bs, p.id);

    const ts = slugify(p.title);
    if (ts && !titleSlugToId.has(ts)) titleSlugToId.set(ts, p.id);
  }

  const seen = new Set<string>();
  for (const page of visible) {
    for (const targetRaw of page.links) {
      const targetId = resolveTarget(targetRaw, nodeIds, lowerIdToId, basenameSlugToId, titleSlugToId);
      if (!targetId || targetId === page.id) continue;
      const key = `${page.id}\u0000${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ source: page.id, target: targetId });
    }
  }
  return out;
}

/**
 * Build the in-memory PageGraph. Nodes are the non-hidden pages; edges are the
 * resolved wikilinks, deduplicated undirected for the public view.
 */
function buildPageGraph(
  metaById: Map<string, PageMeta>,
  edgeRows: Array<{ source: string; target: string }>,
): PageGraph {
  const graph = new Graph({ multi: false, type: "undirected" });
  const outAdj = new Map<string, Set<string>>();
  const inAdj = new Map<string, Set<string>>();
  const degree = new Map<string, number>();

  const visible: PageMeta[] = [];
  for (const m of metaById.values()) {
    if (!HIDDEN_TYPES.has(m.type)) visible.push(m);
  }

  for (const m of visible) {
    outAdj.set(m.id, new Set());
    inAdj.set(m.id, new Set());
    degree.set(m.id, 0);
    graph.addNode(m.id, { label: m.title, type: m.type, path: m.relPath });
  }

  const seenEdges = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const { source: s, target: t } of edgeRows) {
    // Both endpoints must be visible nodes (resolveEdges guarantees it; defensive here).
    if (!outAdj.has(s) || !inAdj.has(t)) continue;
    outAdj.get(s)!.add(t);
    inAdj.get(t)!.add(s);
    const key = [s, t].sort().join(":::");
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ source: s, target: t, weight: 1 });
    if (!graph.hasEdge(s, t)) graph.addEdge(s, t, { weight: 1 });
    degree.set(s, (degree.get(s) ?? 0) + 1);
    degree.set(t, (degree.get(t) ?? 0) + 1);
  }

  const nodes: GraphNode[] = visible.map((m) => ({
    id: m.id,
    label: m.title,
    type: m.type,
    path: m.relPath,
    linkCount: degree.get(m.id) ?? 0,
    community: 0,
  }));

  return { view: { nodes, edges, communities: [] }, graph, outAdj, inAdj, degree };
}

/**
 * Resolve one `[[wikilink]]` target to a page id.
 *
 * A link can be written many ways — with or without `.md`, with a path prefix,
 * by title instead of filename, in any case. Everything is normalised through
 * the same `slugify` used for filenames, so a link written as a path with
 * spaces resolves to the same page as its slug. Tried in order: exact id, exact id
 * ignoring case, filename slug, title slug.
 */
function resolveTarget(
  raw: string,
  nodeIds: Set<string>,
  lowerIdToId: Map<string, string>,
  basenameSlugToId: Map<string, string>,
  titleSlugToId: Map<string, string>,
): string | null {
  if (nodeIds.has(raw)) return raw;

  const byLower = lowerIdToId.get(raw.toLowerCase());
  if (byLower) return byLower;

  const target = slugify(raw.replace(/\.md$/i, ""));
  if (!target) return null;

  return basenameSlugToId.get(target) ?? titleSlugToId.get(target) ?? null;
}

// ── Search index (in-memory) ──

const SNIPPET_CONTEXT = 80;

/**
 * Precompute a page snippet: the frontmatter description if there is one,
 * otherwise the opening of the body with frontmatter and headings stripped.
 * It is static rather than query-highlighted — the reader is an agent that will
 * fetch the full page anyway if the snippet looks relevant.
 */
function makeSnippet(page: WikiPage): string {
  if (page.description) return page.description;
  const body = page.content
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/^#+\s+.*$/gm, "")
    .trim();
  return [...body].slice(0, SNIPPET_CONTEXT).join("").replace(/\n/g, " ").trim();
}

/**
 * Build the whole read model for a wiki: page metadata, the BM25 index and the
 * link graph. Everything is derived from the .md files, so a rebuild is the only
 * write path — there is no separate index to keep in sync.
 */
function buildIndex(pages: WikiPage[]): WikiIndex {
  const metaById = new Map<string, PageMeta>();
  for (const p of pages) {
    metaById.set(p.id, {
      id: p.id,
      title: p.title,
      type: p.type,
      relPath: p.relPath,
      snippet: makeSnippet(p),
    });
  }
  // Every page is searchable, including hidden types; only the graph filters them.
  const bm25 = buildBm25(pages.map((p) => ({ id: p.id, title: p.title, content: p.content })));
  const pg = buildPageGraph(metaById, resolveEdges(pages));
  return { metaById, bm25, pg };
}

// ── Search Constants & Helpers ──

const HOP_LIMIT = 5;
const DEFAULT_LIMIT = 20;
const DEFAULT_HOP = 0;
const DEFAULT_DECAY = 0.5;
const DEFAULT_MIN_SCORE = 0.1;
const RELATED_CAP = 10;
const EXPANSION_CAP = 200;

/**
 * Build the `related` field for one result page (PRD FR-1).
 *
 * Out-link (this → other), in-link (other → this), or both. Same neighbour
 * keeps a single entry. Sort by neighbour degree descending, cap at RELATED_CAP.
 */
function buildRelated(
  pageId: string,
  pg: PageGraph,
  metaById: Map<string, PageMeta>,
): RelatedPage[] {
  const out = pg.outAdj.get(pageId) ?? new Set<string>();
  const inn = pg.inAdj.get(pageId) ?? new Set<string>();
  const all = new Set<string>([...out, ...inn]);
  const items: RelatedPage[] = [];
  for (const nbId of all) {
    const nbMeta = metaById.get(nbId);
    if (!nbMeta) continue;
    const isOut = out.has(nbId);
    const isIn = inn.has(nbId);
    const direction: RelatedPage["direction"] = isOut && isIn ? "both" : isOut ? "out" : "in";
    items.push({ title: nbMeta.title, path: nbMeta.relPath, type: nbMeta.type, direction });
  }
  items.sort((a, b) => {
    const da = pg.degree.get(idFromPath(a.path)) ?? 0;
    const db = pg.degree.get(idFromPath(b.path)) ?? 0;
    return db - da;
  });
  return items.slice(0, RELATED_CAP);
}

function idFromPath(relPath: string): string {
  return relPath.replace(/^wiki\//, "").replace(/\.md$/, "");
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}

/**
 * Build inter-result wikilink edges (PRD FR-2).
 *
 * Only edges where both endpoints are in `resultIds`. Undirected dedup
 * via sorted-pair key. Self-loops were already excluded at graph-build time.
 */
function buildResultLinks(resultIds: string[], pg: PageGraph, metaById: Map<string, PageMeta>): ResultLink[] {
  const inResults = new Set(resultIds);
  const seen = new Set<string>();
  const links: ResultLink[] = [];
  for (const id of resultIds) {
    const meta = metaById.get(id);
    if (!meta) continue;
    const out = pg.outAdj.get(id) ?? new Set<string>();
    for (const target of out) {
      if (!inResults.has(target)) continue;
      const key = [id, target].sort().join(":::");
      if (seen.has(key)) continue;
      seen.add(key);
      const targetMeta = metaById.get(target);
      links.push({
        source: meta.relPath,
        target: targetMeta ? targetMeta.relPath : target,
        weight: 1,
      });
    }
  }
  return links;
}

// ── Project scaffolding ──

function initWikiProject(projectPath: string): void {
  const dirs = ["wiki/entities", "wiki/concepts", "wiki/sources", "wiki/comparisons", "wiki/synthesis"];
  for (const dir of dirs) mkdirSync(join(projectPath, dir), { recursive: true });
  // index.md is the human entry point; rebuildIndexFile regenerates it on every
  // reindex. It carries type:index so it stays out of search and the graph.
  const index = join(projectPath, "wiki/index.md");
  if (!existsSync(index)) {
    writeFileSync(index, "---\ntype: index\ntitle: Index\n---\n\n# Index\n", "utf-8");
  }
}


// ── Factory ──

export function createWikiSourceManager(dataDir: string): WikiSourceManager {
  const sources = new Map<string, WikiSourceState>();
  /** In-memory read model per wiki, rebuilt whenever the pages are rescanned. */
  const indexes = new Map<string, WikiIndex>();
  const stateFile = join(dataDir, "wiki-sources.json");

  mkdirSync(dataDir, { recursive: true });

  function persist() {
    writeFileSync(stateFile, JSON.stringify(Object.fromEntries(sources.entries()), null, 2), "utf-8");
  }

  function loadState() {
    if (!existsSync(stateFile)) return;
    try {
      const raw: unknown = JSON.parse(readFileSync(stateFile, "utf-8"));
      if (!raw || typeof raw !== "object") return;
      for (const [name, state] of Object.entries(raw as Record<string, WikiSourceState>)) {
        if (state.status === "scanning") { state.status = "error"; state.error = "Restart"; }
        sources.set(name, state);
      }
    } catch { /* fresh start */ }
  }

  function scanWikiDir(projectPath: string): WikiPage[] {
    const wikiDir = join(projectPath, "wiki");
    if (!existsSync(wikiDir)) throw new Error(`wiki/ not found: ${wikiDir}`);
    const pages: WikiPage[] = [];
    scanRecursive(wikiDir, wikiDir, pages);
    return pages;
  }

  function scanRecursive(baseDir: string, dir: string, pages: WikiPage[]) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) { if (entry !== "media") scanRecursive(baseDir, full, pages); }
      else if (entry.endsWith(".md")) {
        try {
          const content = readFileSync(full, "utf-8");
          const rel = full.slice(baseDir.length + 1);
          const id = rel.replace(/\.md$/, "").replace(/\\/g, "/");
          const fm = extractFrontmatter(content);
          pages.push({ id, title: fm.title || basename(entry, ".md").replace(/-/g, " "), type: fm.type, path: full, relPath: `wiki/${rel}`, content, sources: fm.sources, links: extractWikilinks(content), description: fm.description });
        } catch { /* skip */ }
      }
    }
  }

  /** Rebuild this wiki's in-memory index from the pages just scanned off disk. */
  function rebuildIndex(name: string, pages: WikiPage[]) {
    if (!sources.has(name)) throw new Error(`rebuildIndex: unknown wiki ${name}`);
    indexes.set(name, buildIndex(pages));
  }

  function searchInternal(name: string, query: string, limit: number, options: SearchOptions): SearchResponse {
    const idx = indexes.get(name);
    if (!idx) return { results: [], links: [], count: 0 };
    const { pg, metaById } = idx;

    const hop = clamp(options.hop ?? DEFAULT_HOP, 0, HOP_LIMIT);
    const decay = clamp(options.decay ?? DEFAULT_DECAY, 0, 1);
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const finalLimit = limit > 0 ? limit : DEFAULT_LIMIT;

    // Pull a slightly oversized seed pool so graph expansion still has something
    // to walk from when `limit` is small but `hop>0` is requested.
    const seedPoolSize = Math.max(finalLimit, hop > 0 ? finalLimit * 2 : finalLimit);
    const rawSeeds = bm25Search(idx.bm25, query, seedPoolSize);
    if (rawSeeds.length === 0) {
      return { results: [], links: [], count: 0 };
    }

    let hits: { id: string; score: number; hop: number; via?: string }[];
    if (hop === 0) {
      hits = rawSeeds.slice(0, finalLimit).map((s) => ({ id: s.id, score: s.score, hop: 0 }));
    } else {
      hits = graphMultiHopSearch(pg.graph, rawSeeds, { hop, decay, minScore, maxNodes: EXPANSION_CAP });
      hits = hits.slice(0, finalLimit);
    }

    const results: SearchResult[] = [];
    const resultIds: string[] = [];
    for (const hit of hits) {
      const meta = metaById.get(hit.id);
      if (!meta) continue;
      const result: SearchResult = {
        path: meta.relPath,
        title: meta.title,
        snippet: meta.snippet,
        score: hit.score,
        type: meta.type,
        hop: hit.hop,
        related: buildRelated(meta.id, pg, metaById),
      };
      if (hit.hop > 0 && hit.via) result.via = hit.via;
      results.push(result);
      resultIds.push(meta.id);
    }

    const links = buildResultLinks(resultIds, pg, metaById);
    return { results, links, count: results.length };
  }

  loadState();
  // loadState only restores which wikis exist. The index itself is never
  // persisted, so it is rebuilt from disk here — otherwise search, pages and
  // graph would all answer empty until the first write.
  log.info("Restoring wiki indexes", { count: sources.size });
  let restored = 0;
  let failed = 0;
  for (const [name, state] of sources.entries()) {
    if (state.status !== "ready") {
      log.debug("Skip non-ready wiki source", { name, status: state.status });
      continue;
    }
    const wikiDir = join(state.path, "wiki");
    if (!existsSync(wikiDir)) {
      log.warn("Wiki dir missing on disk; mark error and skip restore", { name, path: state.path });
      state.status = "error";
      state.error = `wiki dir not found: ${wikiDir}`;
      failed++;
      continue;
    }
    try {
      const pages = scanWikiDir(state.path);
      rebuildIndex(name, pages);
      restored++;
      log.info("Restored wiki index", { name, pageCount: pages.length });
    } catch (err) {
      failed++;
      log.error("Failed to restore wiki index", { name, error: err instanceof Error ? err.message : String(err) });
      state.status = "error";
      state.error = err instanceof Error ? err.message : String(err);
    }
  }
  log.info("Wiki restore complete", { restored, failed, total: sources.size });

  function register(config: WikiSourceConfig): WikiSourceState {
    const existing = sources.get(config.name);
    if (existing) return existing;
    const state: WikiSourceState = { name: config.name, path: config.path, status: "scanning" };
    sources.set(config.name, state);
    try {
      const pages = scanWikiDir(config.path);
      rebuildIndex(config.name, pages);
      state.status = "ready"; state.pageCount = pages.length; state.lastSyncAt = new Date().toISOString();
    } catch (err) { state.status = "error"; state.error = String(err); }
    persist();
    return state;
  }

  function sync(name: string): WikiSourceState {
    const state = sources.get(name);
    if (!state) throw new Error(`Not found: ${name}`);
    state.status = "scanning";
    const t0 = Date.now();
    try {
      const pages = scanWikiDir(state.path);
      rebuildIndex(name, pages);
      state.status = "ready"; state.pageCount = pages.length; state.lastSyncAt = new Date().toISOString(); state.error = undefined;
      log.info("sync complete, index rebuilt", { name, pageCount: pages.length, ms: Date.now() - t0 });
    } catch (err) {
      state.status = "error"; state.error = String(err);
      log.error("sync failed", { name, path: state.path, error: String(err) });
    }
    persist();
    return state;
  }

  function init(config: WikiSourceConfig): WikiSourceState {
    initWikiProject(config.path);
    return register(config);
  }

  return {
    register, sync, init,
    get: (name) => sources.get(name),
    list: () => [...sources.values()],
    remove: (name) => {
      sources.delete(name);
      indexes.delete(name);
      persist();
    },
    search: (name, query, limit, options) => searchInternal(name, query, limit ?? DEFAULT_LIMIT, options ?? {}),
    graph: (name) => indexes.get(name)?.pg.view ?? { nodes: [], edges: [], communities: [] },
    readPage: (name, relPath) => {
      const state = sources.get(name);
      if (!state) return null;

      // Accept the three shapes a caller might have: the full relPath as
      // returned by search, the same path without the leading "wiki/", and the
      // bare page id with no ".md" suffix.
      const cleanPath = relPath.replace(/^wiki\//, "");
      const base = join(state.path, "wiki");
      const fullPath = join(base, cleanPath);
      if (!fullPath.startsWith(base)) return null;
      // Try the path as given, then with .md appended. A miss is not an error:
      // the caller asked for a page that may simply not exist.
      try { return readFileSync(fullPath, "utf-8"); } catch { /* fall through */ }
      if (!cleanPath.endsWith(".md")) {
        try { return readFileSync(fullPath + ".md", "utf-8"); } catch { /* fall through */ }
      }
      return null;
    },
    getPages: (name) => {
      const state = sources.get(name);
      if (!state) return [];
      try { return scanWikiDir(state.path); } catch { return []; }
    },
  };
}
