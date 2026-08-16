/**
 * Source-file tracking — which files have already been turned into pages.
 *
 * This is the one piece of state that is *not* derivable from the wiki pages, so
 * it is the one piece that gets persisted: a small JSON file of content hashes.
 * It replaces the `source` table of the old SQLite index; a hash map does not
 * need a database.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface SourceRecord {
  sha256: string;
  size: number;
  ingestedAt: string;
}

export type SourceMap = Record<string, SourceRecord>;

function storePath(wikiDir: string): string {
  return join(wikiDir, ".state", "sources.json");
}

export function readSources(wikiDir: string): SourceMap {
  const p = storePath(wikiDir);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as SourceMap) : {};
  } catch {
    return {}; // corrupt or hand-edited → treat everything as new, never crash
  }
}

export function writeSources(wikiDir: string, map: SourceMap): void {
  const p = storePath(wikiDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(map, null, 2), "utf-8");
}

/**
 * Compare the files on disk against what was recorded last run.
 * - `toIngest` — never seen, or the content hash moved.
 * - `skipped`  — recorded and unchanged; the agent can leave these alone.
 * - `deleted`  — recorded before, **absent from `disk`**. That only means gone
 *   when `disk` is the complete source list; for a partial list it is just
 *   "not mentioned this time", which is why the caller decides whether to
 *   surface it.
 */
export function classifySources(
  disk: Array<{ filename: string; sha256: string }>,
  known: SourceMap,
): { toIngest: string[]; skipped: string[]; deleted: string[] } {
  const diskNames = new Set(disk.map((d) => d.filename));
  const deleted = Object.keys(known).filter((fn) => !diskNames.has(fn));
  const toIngest: string[] = [];
  const skipped: string[] = [];
  for (const d of disk) {
    const prev = known[d.filename];
    if (!prev || prev.sha256 !== d.sha256) toIngest.push(d.filename);
    else skipped.push(d.filename);
  }
  return { toIngest, skipped, deleted };
}
