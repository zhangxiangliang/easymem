/**
 * The MCP server itself, driven by a real client over an in-memory transport.
 *
 * The tool bodies are covered elsewhere; what is covered here is the wiring
 * around them — the handshake, the tool listing a client uses to decide what it
 * can call, and what a client sees when a call goes wrong.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  createContext,
  createEasymemServer,
  isWikiEmpty,
  parseDir,
  runTool,
  toolCatalog,
} from "../../src/mcp.js";

interface TextContent {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

describe("over a real MCP connection", () => {
  let root: string;
  let client: Client;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "easymem-server-"));
    const server = createEasymemServer(join(root, ".easymem"), root);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test", version: "1" }, { capabilities: {} });
    await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
  });

  afterEach(async () => {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("lists every tool with a description and a schema", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(toolCatalog().map((t) => t.name).sort());
    for (const tool of tools) {
      expect(tool.description!.length).toBeGreaterThan(20);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("marks the arguments a tool cannot work without", async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t.inputSchema]));
    expect(byName.get("wiki_search")).toMatchObject({ required: ["query"] });
    expect(byName.get("wiki_write")).toMatchObject({ required: ["type", "title", "body"] });
  });

  it("runs a tool and returns its text", async () => {
    const out = (await client.callTool({ name: "wiki_guide", arguments: {} })) as TextContent;
    expect(out.isError).toBe(false);
    expect(out.content[0]!.text).toContain("wiki_write");
  });

  it("returns JSON as text for a tool that answers with an object", async () => {
    const out = (await client.callTool({ name: "wiki_list", arguments: {} })) as TextContent;
    expect(JSON.parse(out.content[0]!.text)).toEqual([]);
  });

  it("reports an unknown tool instead of dropping the connection", async () => {
    const out = (await client.callTool({ name: "wiki_nope", arguments: {} })) as TextContent;
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toContain("Unknown tool");
  });

  it("turns a failing tool into an error result, not a crash", async () => {
    const out = (await client.callTool({
      name: "wiki_read",
      arguments: { path: "wiki/entities/ghost.md" },
    })) as TextContent;
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/^Error: /);

    // The connection still works afterwards.
    const after = (await client.callTool({ name: "wiki_list", arguments: {} })) as TextContent;
    expect(after.isError).toBe(false);
  });

  it("treats missing arguments as empty rather than refusing the call", async () => {
    const out = (await client.callTool({ name: "wiki_graph" })) as TextContent;
    expect(out.isError).toBe(false);
  });
});

describe("parseDir", () => {
  const original = process.env.EASYMEM_DIR;
  afterEach(() => {
    if (original === undefined) delete process.env.EASYMEM_DIR;
    else process.env.EASYMEM_DIR = original;
  });

  it("prefers --dir", () => {
    delete process.env.EASYMEM_DIR;
    expect(parseDir(["--dir", "./somewhere"])).toBe(join(process.cwd(), "somewhere"));
  });

  it("falls back to EASYMEM_DIR", () => {
    process.env.EASYMEM_DIR = "./from-env";
    expect(parseDir([])).toBe(join(process.cwd(), "from-env"));
  });

  it("defaults to .easymem beside the code", () => {
    delete process.env.EASYMEM_DIR;
    expect(parseDir([])).toBe(join(process.cwd(), ".easymem"));
  });

  it("ignores a --dir with nothing after it", () => {
    delete process.env.EASYMEM_DIR;
    expect(parseDir(["--dir"])).toBe(join(process.cwd(), ".easymem"));
  });

  it("resolves an absolute path unchanged", () => {
    expect(parseDir(["--dir", "/tmp/wiki-here"])).toBe("/tmp/wiki-here");
  });
});

describe("isWikiEmpty", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "easymem-empty-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("is true for a wiki that has never been written to", () => {
    expect(isWikiEmpty(createContext(join(root, ".easymem"), root))).toBe(true);
  });

  it("stays true when the only page is the generated index", () => {
    const ctx = createContext(join(root, ".easymem"), root);
    runTool("wiki_reindex", { ingested: [] }, ctx);
    expect(isWikiEmpty(ctx)).toBe(true);
  });

  it("is false once a real page exists", () => {
    const ctx = createContext(join(root, ".easymem"), root);
    runTool("wiki_write", { type: "entity", title: "Alpha", body: "body" }, ctx);
    expect(isWikiEmpty(ctx)).toBe(false);
  });
});

describe("runTool", () => {
  it("names the tool it could not find", () => {
    const root = mkdtempSync(join(tmpdir(), "easymem-run-"));
    const ctx = createContext(join(root, ".easymem"), root);
    expect(() => runTool("nope", {}, ctx)).toThrow(/unknown tool: nope/);
    rmSync(root, { recursive: true, force: true });
  });
});
