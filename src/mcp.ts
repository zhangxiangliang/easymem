/**
 * easymem — MCP stdio server.
 *
 * One process, no HTTP, no API key. The wiki lives in a plain directory:
 * markdown pages under `<dir>/wiki/`, nothing else. The search index and the
 * link graph are built in memory at startup — there is no database file.
 *
 *   easymem [--dir <path>]        # or EASYMEM_DIR
 *
 * Read tools (search / read / list / graph) answer from the index.
 * Write tools (guide / pending / write / reindex) let the connected agent
 * build the wiki itself — it supplies the intelligence, we supply the storage.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { createWikiSourceManager } from "./wiki/manager.js";
import {
  readSources,
  writeSources,
  classifySources,
  sha256,
  type SourceMap,
} from "./wiki/sources.js";
import { pageRelPath } from "./wiki/slug.js";
import { buildPage } from "./wiki/frontmatter.js";
import { rebuildIndexFile } from "./wiki/index-builder.js";
import { INGEST_GUIDE } from "./wiki/guide.js";
import { createLogger } from "./logger.js";
import { VERSION } from "./version.js";

const log = createLogger("easymem");

/** Single wiki per directory — the name is internal, never user-facing. */
const WIKI = "wiki";

/** Scaffolding pages: real files, but not knowledge. Kept out of listings. */
const STRUCTURAL_TYPES = new Set(["index", "purpose", "schema"]);

/**
 * Tool arguments arrive from the client unvalidated — a field declared as an
 * array in the input schema can still turn up as a string. Anything that is not
 * an array becomes an empty list rather than a crash mid tool call.
 */
function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

// ───────────────────────── tool definitions ─────────────────────────

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: Ctx) => unknown;
}

interface Ctx {
  /** Wiki project root: holds `wiki/` (pages) and `.state/` (source hashes). */
  dir: string;
  /** Where relative source paths in wiki_pending / wiki_reindex resolve from. */
  root: string;
  mgr: ReturnType<typeof createWikiSourceManager>;
}

const TOOLS: ToolDef[] = [
  {
    name: "wiki_search",
    description:
      "Search the wiki. Full-text (BM25) over every page, then expands along [[wikilinks]] " +
      "so pages that never mention the query still surface when they are linked to a hit. " +
      "Use this before reading files — it is the cheapest way to find what the project already knows.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms." },
        limit: { type: "number", description: "Max results. Default 10." },
        hop: {
          type: "number",
          description:
            "Link-expansion depth, 0-5. 0 = full-text only. Default 1. Raise it when you want " +
            "context around a hit rather than the hit itself.",
        },
      },
      required: ["query"],
    },
    run: (a, ctx) =>
      ctx.mgr.search(WIKI, String(a.query), Number(a.limit) || 10, {
        hop: a.hop === undefined ? 1 : Number(a.hop),
      }),
  },

  {
    name: "wiki_read",
    description: "Read one wiki page in full, by the path that wiki_search or wiki_list returned.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: 'Page path, e.g. "wiki/concepts/auth-flow.md".' },
      },
      required: ["path"],
    },
    run: (a, ctx) => {
      const content = ctx.mgr.readPage(WIKI, String(a.path));
      if (content === null) throw new Error(`page not found: ${a.path}`);
      return content;
    },
  },

  {
    name: "wiki_list",
    description:
      "List every page: id, title, type, path. Use it to see the shape of the wiki before writing, " +
      "so you extend it instead of duplicating it.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Optional filter, e.g. entity / concept / source." },
      },
    },
    run: (a, ctx) => {
      const pages = ctx.mgr
        .getPages(WIKI)
        .filter((p) => !STRUCTURAL_TYPES.has(p.type)); // index.md is scaffolding, not knowledge
      const filtered = a.type ? pages.filter((p) => p.type === String(a.type)) : pages;
      return filtered.map((p) => ({
        id: p.id,
        title: p.title,
        type: p.type,
        path: p.relPath,
        sources: p.sources,
      }));
    },
  },

  {
    name: "wiki_graph",
    description:
      "The whole link graph: nodes, edges and clusters. Use it to spot hubs and orphan pages — " +
      "an orphan usually means a missing [[link]], not a missing page.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, ctx) => ctx.mgr.graph(WIKI),
  },

  {
    name: "wiki_guide",
    description:
      "READ THIS FIRST before writing anything. Returns the rules for building this wiki: " +
      "the ingest workflow, what earns its own page, page types, and the linking convention.",
    inputSchema: { type: "object", properties: {} },
    run: () => INGEST_GUIDE,
  },

  {
    name: "wiki_pending",
    description:
      "Given source file paths, report which ones still need work. Content-hashed, so a file " +
      "already turned into pages and unchanged since comes back as skipped — do not read those again.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Source file paths, relative to the project root or absolute.",
        },
      },
      required: ["paths"],
    },
    run: (a, ctx) => {
      const paths: string[] = strArray(a.paths);
      const disk: Array<{ filename: string; sha256: string }> = [];
      const unreadable: string[] = [];
      for (const p of paths) {
        const abs = resolve(ctx.root, p);
        try {
          disk.push({ filename: p, sha256: sha256(readFileSync(abs, "utf-8")) });
        } catch {
          unreadable.push(p);
        }
      }
      const { toIngest, skipped, deleted } = classifySources(disk, readSources(ctx.dir));
      return { to_ingest: toIngest, skipped, deleted, unreadable };
    },
  },

  {
    name: "wiki_write",
    description:
      "Write one wiki page. Overwrites a page with the same type+title, so read it first and merge " +
      "rather than dropping what is there. Call wiki_reindex when you have finished a batch — " +
      "search does not see the page until you do.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "entity | concept | source | comparison | synthesis. See wiki_guide.",
        },
        title: { type: "string", description: "Page title. Also decides the filename." },
        body: {
          type: "string",
          description:
            "Markdown body, no frontmatter — easymem adds it. Link related pages with [[Title]].",
        },
        sources: {
          type: "array",
          items: { type: "string" },
          description: "Source file paths this page was written from.",
        },
        description: { type: "string", description: "One-line summary, shown in search results." },
      },
      required: ["type", "title", "body"],
    },
    run: (a, ctx) => {
      const type = String(a.type).trim().toLowerCase();
      const title = String(a.title).trim();
      if (!title) throw new Error("title must not be empty");
      const relPath = pageRelPath(type, title);
      const full = join(ctx.dir, relPath);
      if (!full.startsWith(join(ctx.dir, "wiki"))) throw new Error(`refusing to write outside wiki/: ${relPath}`);

      const existed = existsSync(full);
      const content = buildPage(
        {
          type,
          title,
          description: a.description ? String(a.description) : undefined,
          sources: strArray(a.sources),
          timestamp: new Date().toISOString(),
        },
        String(a.body),
      );
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf-8");
      return { path: relPath, action: existed ? "updated" : "created" };
    },
  },

  {
    name: "wiki_delete",
    description: "Delete a wiki page. Use it when a source is gone (wiki_pending reported it deleted).",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Page path from wiki_list." } },
      required: ["path"],
    },
    run: (a, ctx) => {
      const rel = String(a.path).replace(/^wiki\//, "");
      const full = join(ctx.dir, "wiki", rel);
      if (!full.startsWith(join(ctx.dir, "wiki"))) throw new Error("path escapes wiki/");
      if (!existsSync(full)) throw new Error(`page not found: ${a.path}`);
      rmSync(full);
      return { deleted: `wiki/${rel}` };
    },
  },

  {
    name: "wiki_reindex",
    description:
      "Rebuild the search index, the link graph and wiki/index.md from the pages on disk. " +
      "Run it once after a batch of wiki_write calls — nothing you wrote is searchable until you do. " +
      "Pass the source paths you finished so wiki_pending can skip them next time.",
    inputSchema: {
      type: "object",
      properties: {
        ingested: {
          type: "array",
          items: { type: "string" },
          description: "Source paths successfully turned into pages during this run.",
        },
        removed: {
          type: "array",
          items: { type: "string" },
          description: "Source paths that no longer exist (from wiki_pending's deleted list).",
        },
      },
    },
    run: (a, ctx) => {
      const ingested: string[] = strArray(a.ingested);
      const removed: string[] = strArray(a.removed);

      const state = ctx.mgr.sync(WIKI); // rescan pages → rebuild FTS + graph
      if (state.status === "error") throw new Error(state.error ?? "reindex failed");

      const entries = rebuildIndexFile(ctx.dir);

      if (ingested.length || removed.length) {
        const known: SourceMap = readSources(ctx.dir);
        const now = new Date().toISOString();
        for (const p of ingested) {
          let content = "";
          try {
            content = readFileSync(resolve(ctx.root, p), "utf-8");
          } catch {
            continue; // vanished mid-run — leave it for the next wiki_pending
          }
          known[p] = {
            sha256: sha256(content),
            size: Buffer.byteLength(content, "utf-8"),
            ingestedAt: now,
          };
        }
        for (const p of removed) delete known[p];
        writeSources(ctx.dir, known);
      }

      return {
        pages: state.pageCount ?? 0,
        index_entries: entries,
        sources_recorded: ingested.length,
        sources_removed: removed.length,
      };
    },
  },
];

// ───────────────────────── shared entry points ─────────────────────────

/** Where the wiki lives: `--dir`, else EASYMEM_DIR, else `.easymem`. */
export function parseDir(argv: string[]): string {
  const i = argv.indexOf("--dir");
  const raw = i >= 0 && argv[i + 1] ? argv[i + 1] : process.env.EASYMEM_DIR || ".easymem";
  return resolve(process.cwd(), raw);
}

/**
 * Open the wiki at `dir`, creating the directory tree on first run.
 *
 * Both front ends build one of these and then call `runTool`. Keeping the
 * behaviour in one place is the point: a subcommand and a tool call with the
 * same arguments must not be able to do different things.
 */
export function createContext(dir: string, root: string): Ctx {
  const mgr = createWikiSourceManager(join(dir, ".state"));
  mgr.init({ name: WIKI, path: dir }); // creates the wiki/ tree on first run, idempotent
  return { dir, root, mgr };
}

/** Every tool, with the description the MCP client and `--help` both show. */
export function toolCatalog(): Array<{ name: string; description: string }> {
  return TOOLS.map((t) => ({ name: t.name, description: t.description }));
}

/** Run one tool by name. Throws if the name is unknown or the tool throws. */
export function runTool(name: string, args: Record<string, unknown>, ctx: Ctx): unknown {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.run(args, ctx);
}

export function createEasymemServer(dir: string, root: string): Server {
  const ctx = createContext(dir, root);

  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  const server = new Server(
    { name: "easymem", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = byName.get(name);
    if (!tool) {
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
    try {
      const out = tool.run((args ?? {}) as Record<string, unknown>, ctx);
      const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
      return { content: [{ type: "text", text: text || "(empty)" }], isError: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`tool ${name} failed`, { error: msg });
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  });

  return server;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const dir = parseDir(argv);
  const root = process.cwd();
  log.info("starting", { dir, root });
  const server = createEasymemServer(dir, root);
  await server.connect(new StdioServerTransport());
  log.info("connected over stdio");
}
