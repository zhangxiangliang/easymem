# easymem

English · [简体中文](./README.zh.md)

A local wiki for your codebase. Use it from a shell with `npx`, or connect it as an **MCP server**. No API key, no cloud, no second model.

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

There is nothing to install. Point it at a project and ask:

```bash
npx easymem search "how does checkout work"
npx easymem list
npx easymem guide          # the rules an agent follows when writing pages
npx easymem --help
```

Every subcommand prints JSON, so it composes with anything. An agent that can
run a shell command can use the whole wiki, with no configuration at all.

**Or connect it over MCP.** The tools are the same either way; a server keeps
the index warm between calls, which is worth it for a long session over a large
wiki. `npx` rebuilds it each run — about 200 ms for a thousand pages.

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
changed — easymem hashes each source file, so a file that stayed the same
costs nothing.

## Tools

| Shell | MCP tool | What it does |
| --- | --- | --- |
| `easymem search` | `wiki_search` | Full-text search, then follows `[[links]]` so related pages surface too |
| `easymem read` | `wiki_read` | Read one page |
| `easymem list` | `wiki_list` | Every page: id, title, type, path |
| `easymem graph` | `wiki_graph` | The whole link graph — find hubs and orphans |
| `easymem lint` | `wiki_lint` | Find where the wiki has stopped being true |
| `easymem guide` | `wiki_guide` | The writing rules, handed to the agent at run time |
| `easymem pending` | `wiki_pending` | Which source files are new or changed since last time |
| `easymem write` | `wiki_write` | Write one page |
| `easymem delete` | `wiki_delete` | Delete one page |
| `easymem reindex` | `wiki_reindex` | Rebuild the index, the graph and `index.md` |

Each row is one implementation with two front ends, so the shell and MCP cannot
answer differently.

`wiki_guide` is why the wiki comes out the same shape in every client: the
writing rules ride in a tool result, not in a config file each tool spells
differently. The package does ship a `SKILL.md`, and it is thin on purpose —
it says *when* to reach for the wiki and hands the *how* straight back to
`wiki_guide`.

## Keeping it true

A wiki is derived data, and the risk is not that it duplicates the sources — it
is that it drifts from them. Nothing about a stale page looks stale: it reads as
confident and current while the file it describes has moved on.

```bash
npx easymem lint
```

| Check | What it means |
| --- | --- |
| `danglingLinks` | A `[[link]]` with no page behind it — a typo, or a page worth writing |
| `orphans` | Nothing links here. Usually a missing link elsewhere, not a bad page |
| `missingSources` | The page declares nothing, so no claim on it can be checked |
| `staleSources` | A declared source is gone; the page may describe nothing |
| `outdated` | A declared source **changed content** since the page was written |
| `untracked` | A declared source was never ingested, so nothing watches it |
| `missingLinks` | The page names another page in prose but never links it |
| `reviewForContradiction` | Pages built from the same source, worth reading together |

`outdated` is the one worth having. Most tools that try this compare
timestamps, so reformatting a file reports every page that cites it. easymem
already stores a sha256 per ingested source, so it asks the exact question: did
the content change?

`reviewForContradiction` returns **candidates, not findings**. Two pages can
describe one file from different angles without disagreeing, and deciding that
is a judgement — which is what the agent on the other end is for. Reporting a
false contradiction is worse than reporting none, because the page that gets
rewritten was never wrong.

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
    └── wiki-sources.json     notes on the last scan
```

That is everything. There is no database.

The search index and the link graph are built in memory from the markdown when
the server starts, and built again on `wiki_reindex`. Nothing is kept between
runs, because nothing needs to be: the pages **are** the source of truth, and
building them again takes about 120 ms for 1,000 pages, 230 ms for 5,000. A
search takes a few milliseconds.

Nothing outside `wiki/` is a source of truth. `.state/` holds the content hashes
that let `wiki_pending` skip files it has already done — the one fact you cannot
derive from the pages — plus a few notes on the last scan. Delete `.state/` and
the next run reads every source again; nothing is lost but time.

Pages are plain markdown with YAML frontmatter. Nothing is locked in — delete
easymem and you still have a folder of notes anyone can read.

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
