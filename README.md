# easymem

English · [简体中文](./README.zh.md)

A local wiki for your codebase, served as an **MCP server**. No API key, no cloud, no second model.

The coding agent you already run — Claude Code, Codex, opencode — writes the pages.
easymem keeps them, indexes them, and links them.

## Why

Most "knowledge base" tools want their own model key. That means a second bill, a
second config file, and a second model that is often weaker than the agent asking
the question.

easymem has no model inside it. **The agent on the other end of the MCP pipe is
the model.** It reads your files, decides what a page should say, and calls
`wiki_write`. easymem does the parts a model is bad at: full-text search, a link
graph, and knowing which source files changed since last time.

It also has no native modules — three pure-JavaScript dependencies, nothing to
compile. `npx` either works or your network is down.

## Install

Add one block to your agent's MCP config. There is nothing else to set up.

**Claude Code** — `.mcp.json` in the project root:

```json
{
  "mcpServers": {
    "easymem": { "command": "npx", "args": ["-y", "easymem"] }
  }
}
```

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.easymem]
command = "npx"
args = ["-y", "easymem"]
```

**opencode** — `opencode.json`:

```json
{
  "mcp": {
    "easymem": { "type": "local", "command": ["npx", "-y", "easymem"], "enabled": true }
  }
}
```

Pages land in `.easymem/wiki/` next to your code. Point somewhere else with
`--dir <path>` or `EASYMEM_DIR`.

## Use

Just ask. The agent picks the tools by itself:

> Read everything under `docs/` and build the wiki.

> What do we already know about the checkout flow?

The first run walks the files and writes pages. Later runs only touch what
changed — easymem hashes each source file, so unchanged files cost nothing.

## Tools

| Tool | What it does |
| --- | --- |
| `wiki_search` | Full-text search, then follows `[[links]]` so related pages surface too |
| `wiki_read` | Read one page |
| `wiki_list` | Every page: id, title, type, path |
| `wiki_graph` | The whole link graph — find hubs and orphans |
| `wiki_guide` | The writing rules, handed to the agent at run time |
| `wiki_pending` | Which source files are new or changed since last time |
| `wiki_write` | Write one page |
| `wiki_delete` | Delete one page |
| `wiki_reindex` | Rebuild the index, the graph and `index.md` |

`wiki_guide` is why the wiki comes out the same shape in every client: the
writing rules ride in a tool result, not in a config file each tool spells
differently. The package does ship a `SKILL.md`, and it is deliberately thin —
it says *when* to reach for the wiki and hands the *how* straight back to
`wiki_guide`.

## What is on disk

```
.easymem/
├── wiki/                     markdown pages — commit these
│   ├── index.md              regenerated on every reindex
│   ├── entities/             one concrete thing: a service, a table, a role
│   ├── concepts/             an idea across things: a flow, a policy
│   ├── sources/              one page per source document
│   ├── comparisons/          X versus Y
│   └── synthesis/            a conclusion drawn from several pages
└── .state/
    ├── sources.json          which source files are done, by content hash
    └── wiki-sources.json     scan bookkeeping
```

That is everything. There is no database.

The search index and the link graph are built in memory from the markdown when
the server starts, and rebuilt on `wiki_reindex`. Nothing is cached, because
nothing needs to be: the pages **are** the source of truth, and rebuilding is
about 120 ms for 1,000 pages, 230 ms for 5,000. Queries run in single-digit
milliseconds.

Nothing outside `wiki/` is a source of truth. `.state/` holds the content hashes
that let `wiki_pending` skip files it has already done — the one fact you cannot
derive from the pages — plus a little scan bookkeeping. Delete `.state/` and the
next run re-reads every source; nothing is lost but time.

Pages are plain markdown with YAML frontmatter. Nothing is locked in — delete
easymem and you still have a folder of readable notes.

Add to `.gitignore`:

```
.easymem/.state/
```

## Development

```bash
npm install
npm run dev      # run the MCP server over stdio, straight from src
npm run lint
npm test         # jest, unit tests with coverage
npm run build    # tsc → dist/; dist/cli.js is the published binary
npm run ci       # build + typecheck + test, the same thing CI runs
```

Requires Node 20 or newer.

## Where this comes from

The idea is Andrej Karpathy's
[LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f):
stop running RAG over raw sources on every question. Have the agent *compile*
what it reads into a wiki of markdown pages, then answer from the wiki.

I ran that pattern in my own knowledge base, `brain`, for a long time. It works.
It just does not work *well*. With nothing but a prompt describing the job, the
agent writes each page in whatever shape it feels like that day — and a wiki
where every page is shaped differently is a pile, not a wiki.

Then I found
[TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory).
It is the same LLM-wiki idea, but with real constraints around it: a fixed page
format, an actual tokenizer, a link graph. With the constraints in place the
results got a lot better.

It is also heavy — an LLM client, an HTTP API, a control panel, multi-tenant
storage, a SQLite index. Sometimes you just want a small wiki to help the agent
you already have. So easymem lifts out the `MemoryKnowledge` engine — the mixed
Chinese/English tokenizer, the multi-hop graph search, the page format — and
puts it behind an MCP interface. Nothing else.

MIT. TencentDB-Agent-Memory is MIT too.
