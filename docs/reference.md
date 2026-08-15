# easymem reference

[English](reference.md) · [简体中文](reference.zh.md) · [← README](../README.md)

## Commands

| Shell | MCP tool | What it does |
| --- | --- | --- |
| `easymem search <query>` | `wiki_search` | Full-text search, then follows `[[links]]` |
| `easymem read <path>` | `wiki_read` | Read one page |
| `easymem list` | `wiki_list` | Every page: id, title, type, path |
| `easymem graph` | `wiki_graph` | The link graph — hubs and orphans |
| `easymem lint` | `wiki_lint` | Dead links, orphans, pages their sources outgrew |
| `easymem guide` | `wiki_guide` | The rules an agent follows when writing pages |
| `easymem pending <path>...` | `wiki_pending` | Which sources are new or changed |
| `easymem write` | `wiki_write` | Write one page |
| `easymem delete <path>` | `wiki_delete` | Delete one page |
| `easymem reindex` | `wiki_reindex` | Rebuild the index, the graph and `index.md` |
| `easymem skill` | — | Print the skill file |

Each row is one implementation behind both front ends, so the shell and MCP
cannot answer differently. `skill` is the exception: installing a skill is
something you do to your agent, not something an agent asks a wiki for.

Global options: `--dir <path>` (default `.easymem`, or `EASYMEM_DIR`), `--help`,
`--version`.

Running `easymem` with no subcommand starts the MCP server on stdio. At a
prompt, with nothing piped in, it prints help instead.

### search

```bash
easymem search "how are refunds handled" --limit 10 --hop 1
```

`--hop 2` gets the context around an answer rather than the answer; `--hop 0`
returns direct text matches only.

### write

```bash
easymem write --type concept --title "Checkout Flow" \
  --description "Why money moves at shipment." \
  --sources docs/checkout.md,src/payment.ts \
  --body-file page.md
```

`--body-file` is usually easier than `--body`: a page is multi-line markdown and
quoting it inline goes wrong. Piping the body in works too.

Writing the same type and title again overwrites that page. A page whose
frontmatter says `locked: true` is never overwritten — the call returns
`skipped-locked`.

### The ingest loop

```bash
easymem pending src/**/*.ts docs/*.md    # what actually needs reading
# read each path in to_ingest, then write one page per subject
easymem reindex --ingested src/a.ts,docs/b.md
```

Search results do not change until `reindex` runs.

## What search returns

| Field | What to do with it |
| --- | --- |
| `hop: 0` | A direct text match. Trust it as the answer. |
| `hop: 1`+ | Reached by a link. Context — read it, but it may not answer the question. |
| `via` | Which page it came through. An irrelevant `via` means a wrong link. |
| `score` | Comparable within one result set only. There is no threshold. |
| `snippet` | Enough to decide whether to open the page, never enough to answer from. |
| `related` | Neighbours in the graph. Cheap next reads. |

Search does not return the source files a page came from. `read` the page — they
are in its frontmatter — or `list` for every page at once.

## What lint checks

A wiki is derived data, and the risk is not the duplication — it is drift.
Nothing about a stale page looks stale.

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

`summary` counts each category, so you can tell at a glance whether anything is
worth reading.

`outdated` compares a sha256 rather than a timestamp, so reformatting a file
does not report every page that cites it.

`reviewForContradiction` returns **candidates, not findings**. Two pages can
describe one file from different angles without disagreeing, and rewriting a
page that was never wrong costs more than leaving it. Read both before changing
either.

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
└── .state/                   content hashes — add this to .gitignore
```

There is no database. The search index and the link graph are built in memory
from the markdown at startup and again on `reindex` — about 120 ms for 1,000
pages, 230 ms for 5,000. Nothing is cached because nothing needs to be: the
pages **are** the source of truth.

Delete `.state/` and the next run reads every source again; nothing is lost but
time. Delete easymem and you still have a folder of notes anyone can read.

This repository keeps its own wiki in [`.easymem/wiki/`](../.easymem/wiki),
written by an agent from this source.

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
