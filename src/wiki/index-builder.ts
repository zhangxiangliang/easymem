/**
 * index-builder.ts — maintains wiki/index.md, the human entry point.
 *
 * Called after a batch of writes: scan the frontmatter of every page, group by
 * page type, and rewrite index.md as `* [title](path) - description` lists.
 *
 * Decisions worth knowing:
 *   - Regenerated wholesale, never patched, so it can never drift from the pages.
 *   - Plain markdown links, not [[wikilinks]], so the index does not add edges
 *     to the graph and turn itself into an artificial hub.
 *   - Fixed group order, titles sorted inside a group — the output is stable,
 *     so rewriting it produces an empty diff when nothing changed.
 *   - Forgiving: an unreadable page or one with no frontmatter is skipped.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

/** Scaffolding pages are not listed in the index. */
const STRUCTURAL = new Set(["index.md", "schema.md", "purpose.md", "log.md", "overview.md"]);

/** Group order and section headings. Any other type is emitted after these. */
const GROUP_ORDER: Array<{ type: string; heading: string }> = [
  { type: "source", heading: "Sources" },
  { type: "entity", heading: "Entities" },
  { type: "concept", heading: "Concepts" },
  { type: "comparison", heading: "Comparisons" },
  { type: "synthesis", heading: "Synthesis" },
];

export interface IndexEntry {
  title: string;
  /**
   * Relative to index.md, which sits in the same `wiki/` directory — so
   * `entities/order-service.md`, never `/entities/order-service.md`. A leading
   * slash resolves to the root of the repository or the site, so every link in
   * the generated index would be dead on GitHub and in an editor alike.
   */
  relPath: string;
  description: string;
  type: string;
}

/** Walk wiki/ and collect an index entry for every real page. */
function collectEntries(wikiDir: string): IndexEntry[] {
  const out: IndexEntry[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (entry !== "media") walk(full);
        continue;
      }
      if (!entry.endsWith(".md")) continue;
      const rel = relative(wikiDir, full).replace(/\\/g, "/");
      if (STRUCTURAL.has(rel)) continue;
      let content: string;
      try {
        content = readFileSync(full, "utf-8");
      } catch {
        continue;
      }
      const { frontmatter } = parseFrontmatter(content);
      const title =
        typeof frontmatter.title === "string" && frontmatter.title.trim()
          ? frontmatter.title.trim()
          : entry.replace(/\.md$/, "");
      const description =
        typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
      out.push({ title, relPath: rel, description, type: frontmatter.type });
    }
  };
  if (existsSync(wikiDir)) walk(wikiDir);
  return out;
}

/**
 * Render the index.md text from the collected entries. Exported so the shape can
 * be checked without touching the filesystem.
 */
export function renderIndex(entries: IndexEntry[]): string {
  const byType = new Map<string, IndexEntry[]>();
  for (const e of entries) {
    const arr = byType.get(e.type) ?? [];
    arr.push(e);
    byType.set(e.type, arr);
  }

  // The frontmatter is load-bearing: without `type: index` the regenerated
  // index.md is rescanned as an ordinary page and pollutes search and the graph.
  const sections: string[] = ["---", "type: index", "title: Index", "---", "", "# Index", ""];
  const emitted = new Set<string>();

  const emitGroup = (type: string, heading: string) => {
    const items = byType.get(type);
    if (!items || items.length === 0) return;
    emitted.add(type);
    items.sort((a, b) => a.title.localeCompare(b.title));
    sections.push(`## ${heading}`, "");
    for (const it of items) {
      sections.push(`* [${it.title}](${it.relPath})${it.description ? ` - ${it.description}` : ""}`);
    }
    sections.push("");
  };

  for (const { type, heading } of GROUP_ORDER) emitGroup(type, heading);

  // Any type not in GROUP_ORDER still gets a section, so no page is ever dropped.
  const otherTypes = [...byType.keys()].filter((t) => !emitted.has(t)).sort();
  for (const t of otherTypes) emitGroup(t, t.charAt(0).toUpperCase() + t.slice(1));

  return sections.join("\n").replace(/\n+$/, "") + "\n";
}

/**
 * Rebuild and overwrite wiki/index.md.
 * @returns how many entries were written.
 */
export function rebuildIndexFile(projectPath: string): number {
  const wikiDir = join(projectPath, "wiki");
  if (!existsSync(wikiDir)) return 0;
  const entries = collectEntries(wikiDir);
  const text = renderIndex(entries);
  writeFileSync(join(wikiDir, "index.md"), text, "utf-8");
  return entries.length;
}
