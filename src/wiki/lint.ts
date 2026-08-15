/**
 * lint.ts — find the places where the wiki has stopped being true.
 *
 * A wiki is derived data. That is fine as long as it can be checked against
 * what it was derived from, and the danger is not the duplication — it is
 * drift: a page that still reads as confident and current while the file it
 * describes moved on. Nothing about a stale page looks stale.
 *
 * Every check here is mechanical, and the interesting one is `outdated`. Most
 * tools that attempt this compare timestamps, which reports a file every time
 * someone reformats it. easymem already stores a sha256 for every ingested
 * source in `.state/sources.json`, so it can ask the exact question instead:
 * has the content changed since the page was written?
 *
 * Judgement stays with the caller. `reviewForContradiction` returns pairs to
 * read, never a verdict — a false contradiction is worse than a missed one,
 * because the agent will rewrite a page that was never wrong.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sha256, type SourceMap } from "./sources.js";
import type { WikiPage } from "./types.js";

/** Pages that are scaffolding, not knowledge — never reported as orphans. */
const STRUCTURAL_TYPES = new Set(["index", "purpose", "schema"]);

export interface LintReport {
  /** A `[[target]]` no page answers to. A typo, or a page worth writing. */
  danglingLinks: Array<{ page: string; target: string }>;
  /** Nothing links here. Usually a missing link elsewhere, not a bad page. */
  orphans: string[];
  /** The page declares no sources, so no claim on it can be checked. */
  missingSources: string[];
  /** A declared source is gone from disk. The page may describe nothing. */
  staleSources: Array<{ page: string; missing: string[] }>;
  /** A declared source has changed content since it was ingested. */
  outdated: Array<{ page: string; changed: string[] }>;
  /** A declared source was never ingested, so nothing watches it for changes. */
  untracked: Array<{ page: string; sources: string[] }>;
  /** The page names another page in prose but never links it. */
  missingLinks: Array<{ page: string; shouldLink: string }>;
  /** Pages built from the same source. Read them together — candidates only. */
  reviewForContradiction: Array<{ pages: [string, string]; sharedSources: string[] }>;
  /** Counts, so a caller can decide whether it is worth reading the detail. */
  summary: Record<string, number>;
}

/** Text with every `[[link]]` removed, so a mention inside one does not count. */
function prose(page: WikiPage): string {
  return page.content.replace(/\[\[[^\]]*\]\]/g, " ").toLowerCase();
}

/**
 * Check the wiki against the sources it was built from.
 *
 * @param pages     every page, as the manager scanned them
 * @param known     the ingest record from `.state/sources.json`
 * @param sourceRoot where a page's relative `sources` paths resolve from
 */
export function lint(pages: WikiPage[], known: SourceMap, sourceRoot: string): LintReport {
  const byTitle = new Map(pages.map((p) => [p.title.toLowerCase(), p]));

  const danglingLinks: LintReport["danglingLinks"] = [];
  const linkedTo = new Set<string>();
  for (const page of pages) {
    for (const target of page.links) {
      const hit = byTitle.get(target.trim().toLowerCase());
      if (hit) linkedTo.add(hit.title.toLowerCase());
      else danglingLinks.push({ page: page.relPath, target });
    }
  }

  const orphans = pages
    .filter((p) => !STRUCTURAL_TYPES.has(p.type) && !linkedTo.has(p.title.toLowerCase()))
    .map((p) => p.relPath);

  const missingSources: string[] = [];
  const staleSources: LintReport["staleSources"] = [];
  const outdated: LintReport["outdated"] = [];
  const untracked: LintReport["untracked"] = [];

  // One hash per file, not per mention: a source cited by twenty pages is read
  // once.
  const currentHash = new Map<string, string | null>();
  const hashOf = (source: string): string | null => {
    if (currentHash.has(source)) return currentHash.get(source)!;
    const abs = resolve(sourceRoot, source);
    let value: string | null = null;
    if (existsSync(abs)) {
      try {
        value = sha256(readFileSync(abs, "utf-8"));
      } catch {
        value = null; // unreadable counts as gone, which is what the reader sees
      }
    }
    currentHash.set(source, value);
    return value;
  };

  for (const page of pages) {
    if (STRUCTURAL_TYPES.has(page.type)) continue;
    if (page.sources.length === 0) {
      missingSources.push(page.relPath);
      continue;
    }

    const missing: string[] = [];
    const changed: string[] = [];
    const neverIngested: string[] = [];

    for (const source of page.sources) {
      const now = hashOf(source);
      if (now === null) {
        missing.push(source);
        continue;
      }
      const record = known[source];
      if (!record) neverIngested.push(source);
      else if (record.sha256 !== now) changed.push(source);
    }

    if (missing.length) staleSources.push({ page: page.relPath, missing });
    if (changed.length) outdated.push({ page: page.relPath, changed });
    if (neverIngested.length) untracked.push({ page: page.relPath, sources: neverIngested });
  }

  const missingLinks: LintReport["missingLinks"] = [];
  for (const page of pages) {
    if (STRUCTURAL_TYPES.has(page.type)) continue;
    const text = prose(page);
    for (const other of pages) {
      if (other.relPath === page.relPath) continue;
      const title = other.title.trim().toLowerCase();
      // Two characters is noise in both languages — it would flag every page
      // whose title happens to be a common word or a CJK bigram.
      if (title.length < 3) continue;
      if (text.includes(title) && !page.links.some((l) => l.trim().toLowerCase() === title)) {
        missingLinks.push({ page: page.relPath, shouldLink: other.title });
      }
    }
  }

  const reviewForContradiction = sharedSourcePairs(pages);

  const report: Omit<LintReport, "summary"> = {
    danglingLinks,
    orphans,
    missingSources,
    staleSources,
    outdated,
    untracked,
    missingLinks,
    reviewForContradiction,
  };

  return {
    ...report,
    summary: Object.fromEntries(
      Object.entries(report).map(([key, value]) => [key, value.length]),
    ),
  };
}

/**
 * Pages written from the same source file are where contradictions hide: two
 * readings of one document, made at different times, drifting apart. It is a
 * cheap and honest filter — it narrows a quadratic problem down to the handful
 * of pairs an agent can actually read.
 */
function sharedSourcePairs(pages: WikiPage[]): LintReport["reviewForContradiction"] {
  const out: LintReport["reviewForContradiction"] = [];
  const real = pages.filter((p) => !STRUCTURAL_TYPES.has(p.type));
  for (let i = 0; i < real.length; i += 1) {
    for (let j = i + 1; j < real.length; j += 1) {
      const shared = real[i]!.sources.filter((s) => real[j]!.sources.includes(s));
      if (shared.length) {
        out.push({ pages: [real[i]!.relPath, real[j]!.relPath], sharedSources: shared });
      }
    }
  }
  return out;
}
