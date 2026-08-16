/**
 * The whole loop, through the same entry point the CLI and the MCP server use.
 *
 * Everything below runs against a real directory: manager.ts scans it,
 * index-builder.ts writes into it, and the BM25 index and link graph are built
 * from what is actually on disk. These are the paths that no unit test reaches,
 * and the ones that break when the pieces stop fitting together.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createContext, runTool } from "../../src/mcp.js";

type Ctx = ReturnType<typeof createContext>;

interface WriteResult {
  path: string;
  action: string;
}
interface SearchHit {
  path: string;
  title: string;
  hop: number;
  via?: string;
  score: number;
}
interface PendingResult {
  to_ingest: string[];
  skipped: string[];
  deleted: string[];
  unreadable: string[];
  note?: string;
}

describe("the wiki loop", () => {
  let root: string;
  let ctx: Ctx;

  const call = <T>(tool: string, args: Record<string, unknown> = {}): T =>
    runTool(tool, args, ctx) as T;

  const write = (title: string, type: string, body: string, sources: string[] = []) =>
    call<WriteResult>("wiki_write", { type, title, body, sources });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "easymem-loop-"));
    ctx = createContext(join(root, ".easymem"), root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("starts empty", () => {
    expect(call<unknown[]>("wiki_list")).toEqual([]);
  });

  it("creates a page, then updates the same file for the same title", () => {
    expect(write("Order Service", "entity", "first")).toEqual({
      path: "wiki/entities/order-service.md",
      action: "created",
    });
    expect(write("Order Service", "entity", "second").action).toBe("updated");
    expect(call<unknown[]>("wiki_list")).toHaveLength(1);
  });

  it("refuses to overwrite a page a human pinned", () => {
    // The regression: `locked: true` was documented and parsed, and then
    // nothing checked it — a pinned page was overwritten like any other.
    const { path } = write("Pinned", "entity", "handwritten");
    const file = join(root, ".easymem", path);
    writeFileSync(file, readFileSync(file, "utf-8").replace("type:", "locked: true\ntype:"));

    expect(write("Pinned", "entity", "clobbered").action).toBe("skipped-locked");
    expect(readFileSync(file, "utf-8")).toContain("handwritten");
  });

  it("hides a page from search until reindex runs", () => {
    write("Checkout Flow", "concept", "Refunds before shipment are free.");
    expect(call<{ results: SearchHit[] }>("wiki_search", { query: "refunds" }).results).toHaveLength(0);

    call("wiki_reindex", { ingested: [] });
    expect(call<{ results: SearchHit[] }>("wiki_search", { query: "refunds" }).results.length)
      .toBeGreaterThan(0);
  });

  it("reaches a page through a link that never mentions the query", () => {
    // This is the reason the graph exists. "refund" appears only in Checkout
    // Flow; Order Service comes back because Checkout Flow links to it.
    write("Checkout Flow", "concept", "A refund before shipment is free. [[Order Service]] drives it.");
    write("Order Service", "entity", "Turns a cart into an order.");
    call("wiki_reindex", { ingested: [] });

    const hits = call<{ results: SearchHit[] }>("wiki_search", { query: "refund", hop: 1 }).results;
    const direct = hits.find((h) => h.title === "Checkout Flow");
    const linked = hits.find((h) => h.title === "Order Service");

    expect(direct?.hop).toBe(0);
    expect(linked?.hop).toBe(1);
    expect(linked?.via).toBe("Checkout Flow");
    expect(direct!.score).toBeGreaterThan(linked!.score);
  });

  it("returns only direct matches at hop 0", () => {
    write("Checkout Flow", "concept", "A refund. [[Order Service]] drives it.");
    write("Order Service", "entity", "Turns a cart into an order.");
    call("wiki_reindex", { ingested: [] });

    const hits = call<{ results: SearchHit[] }>("wiki_search", { query: "refund", hop: 0 }).results;
    expect(hits.map((h) => h.title)).toEqual(["Checkout Flow"]);
  });

  it("reads a page back whole, and reports a missing one", () => {
    write("Alpha", "entity", "Body text here.", ["src/a.ts"]);
    const page = call<string>("wiki_read", { path: "wiki/entities/alpha.md" });
    expect(page).toContain("Body text here.");
    expect(page).toContain("src/a.ts");

    expect(() => call("wiki_read", { path: "wiki/entities/ghost.md" })).toThrow(/not found/);
  });

  it("refuses to write outside the wiki directory", () => {
    // The type becomes a directory name unchanged, so it is the field that can
    // climb out. The title cannot: slugify treats punctuation as a separator,
    // so "../../escape" is already flattened to "escape" before it is a path.
    expect(() => write("Escape", "../../etc", "body")).toThrow(/outside wiki/);
    expect(write("../../escape", "entity", "body").path).toBe("wiki/entities/escape.md");
  });

  it("rejects an empty title rather than writing a nameless file", () => {
    expect(() => write("   ", "entity", "body")).toThrow(/title must not be empty/);
  });

  it("regenerates index.md on reindex, with links that resolve", () => {
    write("Alpha", "entity", "body");
    call("wiki_reindex", { ingested: [] });

    const index = readFileSync(join(root, ".easymem", "wiki", "index.md"), "utf-8");
    expect(index).toContain("[Alpha](entities/alpha.md)");
    expect(index).not.toContain("](/");
  });

  it("deletes a page and drops it from the listing", () => {
    write("Temp", "entity", "body");
    call("wiki_delete", { path: "wiki/entities/temp.md" });
    expect(call<unknown[]>("wiki_list")).toEqual([]);
  });

  it("keeps the structural index page out of wiki_list", () => {
    write("Alpha", "entity", "body");
    call("wiki_reindex", { ingested: [] });
    expect(call<Array<{ title: string }>>("wiki_list").map((p) => p.title)).toEqual(["Alpha"]);
  });

  it("does not treat a link inside code as a link", () => {
    // Found by running easymem over its own source: a page explaining the
    // syntax wrote `[[Page Title]]` in backticks, and got an edge to a page
    // called "Page Title" plus a dangling-link report about its own prose.
    write("Docs", "concept", "Write a link as `[[Some Page]]`.\n\n```\n[[Fenced Page]]\n```");
    write("Real", "concept", "Points at [[Docs]].");
    call("wiki_reindex", { ingested: [] });

    const report = call<{ danglingLinks: unknown[] }>("wiki_lint");
    expect(report.danglingLinks).toEqual([]);

    const graph = call<{ edges: unknown[] }>("wiki_graph");
    expect(graph.edges).toHaveLength(1); // Real → Docs, and nothing from the code
  });

  it("never asks a page to link the generated index", () => {
    // "the index" appears in almost every page of a wiki about an index.
    write("Alpha", "concept", "Rebuilding the index is cheap. [[Beta]] agrees.");
    write("Beta", "concept", "See [[Alpha]].");
    call("wiki_reindex", { ingested: [] });

    const report = call<{ missingLinks: Array<{ shouldLink: string }> }>("wiki_lint");
    expect(report.missingLinks.map((m) => m.shouldLink)).not.toContain("Index");
  });

  it("builds a graph of the pages and their links", () => {
    write("Alpha", "entity", "Links to [[Beta]].");
    write("Beta", "entity", "Links back to [[Alpha]].");
    call("wiki_reindex", { ingested: [] });

    const graph = call<{ nodes: unknown[]; edges: unknown[] }>("wiki_graph");
    expect(graph.nodes.length).toBe(2);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it("records a source from the page that declares it, with no arguments", () => {
    // The regression: writeSources only ran when the caller passed `ingested`,
    // so a plain reindex recorded nothing, wiki_pending reported every file as
    // new forever, and the incremental path silently became a full re-read —
    // while reindex still returned success.
    writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
    write("Alpha", "entity", "body", ["a.ts"]);

    const out = call<{ sources_recorded: number; warning?: string }>("wiki_reindex", {});
    expect(out.sources_recorded).toBe(1);
    expect(out.warning).toBeUndefined();

    const after = call<{ skipped: string[] }>("wiki_pending", { paths: ["a.ts"] });
    expect(after.skipped).toEqual(["a.ts"]);
  });

  it("warns when pages exist but none of them names a source that is there", () => {
    write("Alpha", "entity", "body");
    const out = call<{ sources_recorded: number; warning?: string }>("wiki_reindex", {});
    expect(out.sources_recorded).toBe(0);
    expect(out.warning).toMatch(/No sources recorded/);
  });

  it("hands the writing rules over as text", () => {
    expect(call<string>("wiki_guide")).toContain("wiki_write");
  });
});

describe("wiki_pending", () => {
  let root: string;
  let ctx: Ctx;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "easymem-pending-"));
    ctx = createContext(join(root, ".easymem"), root);
    writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "b.ts"), "export const b = 2;\n");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const pending = (paths: string[]) =>
    runTool("wiki_pending", { paths }, ctx) as PendingResult;

  it("reports every unseen file as work to do", () => {
    expect(pending(["a.ts", "b.ts"]).to_ingest).toEqual(["a.ts", "b.ts"]);
  });

  it("skips a file whose content has not moved since the last reindex", () => {
    runTool("wiki_reindex", { ingested: ["a.ts"] }, ctx);
    const r = pending(["a.ts", "b.ts"]);
    expect(r.skipped).toEqual(["a.ts"]);
    expect(r.to_ingest).toEqual(["b.ts"]);
  });

  it("brings a file back when its content changes", () => {
    runTool("wiki_reindex", { ingested: ["a.ts"] }, ctx);
    writeFileSync(join(root, "a.ts"), "export const a = 99;\n");
    expect(pending(["a.ts"]).to_ingest).toEqual(["a.ts"]);
  });

  it("reports a tracked file that is really gone, given the complete list", () => {
    runTool("wiki_reindex", { ingested: ["a.ts"] }, ctx);
    const r = runTool("wiki_pending", { paths: ["b.ts"], complete: true }, ctx) as PendingResult;
    expect(r.deleted).toEqual(["a.ts"]);
  });

  it("stays silent about deletion when it was handed a partial list", () => {
    // `deleted` means "recorded before, not in the list you gave me". Reporting
    // that for a partial list told the caller pages were stale for files that
    // were sitting right there, and the documented next step was to delete them.
    runTool("wiki_reindex", { ingested: ["a.ts", "b.ts"] }, ctx);
    const partial = pending(["a.ts"]);
    expect(partial.deleted).toEqual([]);
    expect(String(partial.note)).toMatch(/not in this list/);
  });

  it("checks for deletion when the caller says the list is complete", () => {
    runTool("wiki_reindex", { ingested: ["a.ts", "b.ts"] }, ctx);
    const full = runTool("wiki_pending", { paths: ["a.ts"], complete: true }, ctx) as PendingResult;
    expect(full.deleted).toEqual(["b.ts"]);
    expect(full).not.toHaveProperty("note");
  });

  it("separates a path it cannot read from one that is simply new", () => {
    const r = pending(["a.ts", "missing.ts"]);
    expect(r.unreadable).toEqual(["missing.ts"]);
    expect(r.to_ingest).toEqual(["a.ts"]);
  });

  it("survives being handed nothing", () => {
    expect(pending([]).to_ingest).toEqual([]);
  });
});
