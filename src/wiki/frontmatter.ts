/**
 * frontmatter.ts — parse and build YAML frontmatter.
 *
 * Every page carries valid frontmatter; the scanner, the search index and the
 * link graph all read it:
 *   type (required) / title / description / sources / tags / timestamp
 *
 * Parsing is forgiving on purpose. A page with broken YAML is still a page the
 * user can read and fix, so a bad block degrades to `{type: "other"}` rather
 * than throwing and taking the whole scan down with it.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface PageFrontmatter {
  type: string;
  title?: string;
  description?: string;
  sources?: string[];
  tags?: string[];
  timestamp?: string;
  locked?: boolean;
  /** Unknown keys are preserved, so a round-trip never silently drops a field. */
  [key: string]: unknown;
}

export interface ParsedPage {
  frontmatter: PageFrontmatter;
  body: string;
  /** Whether a frontmatter block was actually found and parsed. */
  hasFrontmatter: boolean;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Split page content into frontmatter and body. A page with no frontmatter — or
 * with unparseable YAML — comes back as `{type: "other"}` and never throws.
 */
export function parseFrontmatter(content: string): ParsedPage {
  const text = content ?? "";
  const m = text.match(FM_RE);
  if (!m) {
    return { frontmatter: { type: "other" }, body: text, hasFrontmatter: false };
  }
  const yamlText = m[1];
  const body = text.slice(m[0].length);
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch {
    return { frontmatter: { type: "other" }, body, hasFrontmatter: false };
  }
  if (!parsed || typeof parsed !== "object") {
    return { frontmatter: { type: "other" }, body, hasFrontmatter: false };
  }
  const fm = parsed as Record<string, unknown>;
  const type = typeof fm.type === "string" && fm.type.trim() ? fm.type : "other";
  return { frontmatter: { ...fm, type } as PageFrontmatter, body, hasFrontmatter: true };
}

/** Whether the page was pinned by hand (`locked: true`). A locked page is never overwritten. */
export function isLocked(content: string): boolean {
  const { frontmatter } = parseFrontmatter(content);
  return frontmatter.locked === true;
}

/** The source paths a page declares it was written from. */
export function readSources(content: string): string[] {
  const { frontmatter } = parseFrontmatter(content);
  const s = frontmatter.sources;
  if (Array.isArray(s)) return s.filter((x): x is string => typeof x === "string");
  return [];
}

/**
 * Assemble frontmatter and body into page content.
 *
 * - `type` is required; a missing one becomes "other" rather than an error.
 * - `locked` is never written — it is a human's mark, not ours to set.
 * - Key order is fixed (type → title → description → sources → tags →
 *   timestamp → the rest) so rewriting a page produces a small, readable diff.
 */
export function buildPage(frontmatter: PageFrontmatter, body: string): string {
  const fm: Record<string, unknown> = {};
  fm.type = (frontmatter.type ?? "other").toString();
  if (frontmatter.title != null) fm.title = frontmatter.title;
  if (frontmatter.description != null) fm.description = frontmatter.description;
  if (frontmatter.sources != null) fm.sources = frontmatter.sources;
  if (frontmatter.tags != null) fm.tags = frontmatter.tags;
  if (frontmatter.timestamp != null) fm.timestamp = frontmatter.timestamp;
  // Pass through any custom keys, minus the ones already placed above.
  for (const [k, v] of Object.entries(frontmatter)) {
    if (["type", "title", "description", "sources", "tags", "timestamp", "locked"].includes(k)) continue;
    if (v != null) fm[k] = v;
  }

  const yamlText = stringifyYaml(fm).trimEnd();
  const cleanBody = (body ?? "").replace(/^\s+/, "").replace(/\s+$/, "");
  return `---\n${yamlText}\n---\n\n${cleanBody}\n`;
}
