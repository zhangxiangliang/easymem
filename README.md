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

easymem turns what your coding agent reads into a local wiki of markdown pages,
so the next session searches the wiki instead of reading the files again.

Search is BM25 over every page, then one hop along `[[links]]` — a page that
never mentions your words still comes back when a page that matches links to it.
Everything lands in plain markdown you can read, edit and commit. There is no
model inside easymem and no database: the agent writes, easymem stores, searches
and links.

## Quick start

### With your AI

```bash
npx skills add zhangxiangliang/easymem
```

That installs the skill into Claude Code, Cursor, Codex and other agents. From
then on the AI writes down what it reads and searches the wiki first, instead of
reading your files again.

No CLI? Hand your AI this line instead, and it does the rest:

> Read and follow https://github.com/zhangxiangliang/easymem/blob/main/SKILL.md

### On the command line

No install needed. `npx` gets the package on first run.

```bash
npx easymem search "how does checkout work"
npx easymem --help
```

### As an MCP server

The index stays warm between calls. Add this and restart:

```json
{
  "mcpServers": {
    "easymem": { "command": "npx", "args": ["-y", "easymem"] }
  }
}
```

Pages land in `.easymem/wiki/`. Commit those; add `.easymem/.state/` to
`.gitignore`.

## Docs

- [Reference](docs/reference.md) — every command, what search returns, what
  `lint` checks, what is on disk, and what easymem does not do.

## Where this comes from

The idea is Andrej Karpathy's
[LLM wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f):
stop running RAG over raw sources on every question — have the agent *compile*
what it reads into a wiki, then answer from the wiki. I ran that pattern in my
own knowledge base for a long time. It works, it just does not work *well*: with
nothing but a prompt, the agent writes each page in whatever shape it feels like
that day, and a wiki where every page is shaped differently is a pile.

[TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
is the same idea with real constraints around it, and the results are a lot
better. It is also heavy — an LLM client, an HTTP API, a control panel,
multi-tenant storage, a SQLite index. easymem lifts out its `MemoryKnowledge`
engine — the mixed Chinese/English tokenizer, the multi-hop graph search, the
page format — and puts it behind a shell command. Nothing else.

## License

MIT. TencentDB-Agent-Memory is MIT too.
