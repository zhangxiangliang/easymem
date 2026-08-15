<div align="center">

# easymem

An LLM wiki your coding agent writes — agent memory you can open and read.

[English](README.md) · [简体中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/easymem.svg)](https://www.npmjs.com/package/easymem)
[![downloads](https://img.shields.io/npm/dm/easymem.svg)](https://www.npmjs.com/package/easymem)
[![license](https://img.shields.io/npm/l/easymem.svg)](https://github.com/zhangxiangliang/easymem/blob/main/LICENSE)
[![typescript](https://img.shields.io/badge/language-typescript-blue.svg)](https://www.typescriptlang.org)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

</div>

Your agent reads the same files every session, works something out, and forgets
it. easymem gives it somewhere to put what it learned: a wiki of markdown pages
it writes itself, then searches instead of reading the files again.

There is no model inside easymem. The agent on the other end is the model — it
reads, it decides what a page should say, it writes. easymem does the parts a
model is bad at: full-text search, a link graph, and knowing which files changed
since last time.

## See it work

Two pages an agent wrote about a checkout system:

```markdown
# Checkout Flow
Payment is authorized at checkout and captured only when the parcel ships.
- A refund before shipment is free, because nothing was captured.
Driven by [[Order Service]].
```

```markdown
# Order Service
`OrderService.createOrder` owns the cart to order transition.
- Rejects an empty cart before touching the database.
```

Now ask about refunds. **The word "refund" appears in the first page only:**

```bash
npx easymem search "refund"
```

```json
{
  "results": [
    {
      "title": "Checkout Flow",
      "snippet": "Money moves at shipment.",
      "hop": 0,
      "score": 0.96
    },
    {
      "title": "Order Service",
      "snippet": "Cart to order.",
      "hop": 1,
      "via": "Checkout Flow",
      "score": 0.48
    }
  ]
}
```

The second hit never says "refund". It came back because the first one links to
it — `hop: 1`, reached `via` Checkout Flow.

That is the whole idea. You asked a question about policy and got the policy
**and the code it depends on**. `grep` cannot do that, and neither can plain
full-text search: the connection lives in a link an agent wrote, not in the
words.

Read `hop` before you trust a hit — `0` is a text match, anything higher is
context reached by a link, and `via` names the link it came through.

## Quick start

Nothing to install.

### With your AI

Add the skill, or just tell it what to do — every subcommand below is a shell
command an agent can run.

> Read everything under `src/` and `docs/`, and build the wiki.

> What do we already know about the checkout flow?

> Lint the wiki and tell me what has rotted.

### On the command line

```bash
npx easymem search "how does checkout work"   # search, then follow links
npx easymem list                              # every page
npx easymem guide                             # the rules for writing pages
npx easymem lint                              # what has gone stale
npx easymem --help
```

### As an MCP server

Same tools, but the index stays warm between calls — worth it for a long
session over a large wiki. Add this and restart:

```json
{
  "mcpServers": {
    "easymem": { "command": "npx", "args": ["-y", "easymem"] }
  }
}
```

For Codex use `~/.codex/config.toml`, for opencode `opencode.json`; the command
and args are the same.

## Tools

| Shell | MCP tool | What it does |
| --- | --- | --- |
| `easymem search` | `wiki_search` | Full-text search, then follows `[[links]]` |
| `easymem read` | `wiki_read` | Read one page |
| `easymem list` | `wiki_list` | Every page: id, title, type, path |
| `easymem graph` | `wiki_graph` | The link graph — hubs and orphans |
| `easymem lint` | `wiki_lint` | What has stopped being true |
| `easymem guide` | `wiki_guide` | The writing rules, handed over at run time |
| `easymem pending` | `wiki_pending` | Which sources are new or changed |
| `easymem write` | `wiki_write` | Write one page |
| `easymem delete` | `wiki_delete` | Delete one page |
| `easymem reindex` | `wiki_reindex` | Rebuild the index, the graph and `index.md` |

Each row is one implementation with two front ends, so the shell and MCP cannot
answer differently.

## Keeping it true

A wiki is derived data, and the risk is not the duplication — it is drift.
Nothing about a stale page looks stale.

```bash
npx easymem lint
```

| Check | Meaning |
| --- | --- |
| `outdated` | A source **changed content** since the page was written |
| `staleSources` | A source is gone; the page may describe nothing |
| `untracked` | A source was never ingested, so nothing watches it |
| `danglingLinks` | A `[[link]]` with no page behind it |
| `orphans` | Nothing links here |
| `missingSources` | The page declares nothing, so no claim can be checked |
| `missingLinks` | It names another page in prose without linking it |
| `reviewForContradiction` | Pages built from one source, worth reading together |

`outdated` compares a sha256 rather than a timestamp, so reformatting a file
does not report every page that cites it. `reviewForContradiction` returns
**candidates, not findings** — two pages can describe one file from different
angles without disagreeing, and rewriting a page that was never wrong costs more
than leaving it.

## What it does not do

- **It does not translate.** The tokenizer handles Chinese and English in one
  index, so a Chinese wiki is searchable in Chinese. It does not answer a
  Chinese question from an English wiki.
- **It does not read your files by itself.** The agent does that. easymem never
  opens a source file except to hash it.
- **It does not decide what is true.** `lint` reports; you and the agent judge.
- **It is not worth it for a small project.** Twenty tidy files are faster to
  grep. This earns its keep when the sources are large, scattered, or expensive
  to read.

## On disk

```
.easymem/
├── wiki/                     markdown pages — commit these
│   ├── index.md              regenerated on every reindex
│   ├── entities/             one concrete thing: a service, a table, a role
│   ├── concepts/             an idea across things: a flow, a policy
│   ├── sources/              one page per source document
│   ├── comparisons/          X versus Y
│   └── synthesis/            a conclusion drawn from several pages
└── .state/                   content hashes — add this to .gitignore
```

There is no database. The search index and the link graph are built in memory
from the markdown at startup and again on `wiki_reindex` — about 120 ms for
1,000 pages, 230 ms for 5,000. Nothing is cached because nothing needs to be:
the pages **are** the source of truth.

Delete `.state/` and the next run reads every source again; nothing is lost but
time. Delete easymem and you still have a folder of notes anyone can read.

This repository keeps its own wiki in [`.easymem/wiki/`](.easymem/wiki), written
by an agent from this source.

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
Same idea, but with real constraints around it: a fixed page format, an actual
tokenizer, a link graph. With the constraints in place the results got a lot
better.

It is also heavy — an LLM client, an HTTP API, a control panel, multi-tenant
storage, a SQLite index. Sometimes you just want a small wiki to help the agent
you already have. So easymem lifts out the `MemoryKnowledge` engine — the mixed
Chinese/English tokenizer, the multi-hop graph search, the page format — and
puts it behind a shell command and an MCP interface. Nothing else.

## License

MIT. TencentDB-Agent-Memory is MIT too.
