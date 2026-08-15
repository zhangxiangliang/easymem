---
type: concept
title: Compiled Knowledge
description: Why easymem searches written pages instead of the sources they came from.
sources:
  - src/wiki/guide.ts
  - README.md
timestamp: 2026-08-15T07:40:20.807Z
---

easymem does not search the sources. It searches pages an agent wrote after
reading the sources, and it answers from those.

The difference is where the work happens. Retrieval over raw files repeats the
same reading on every question. Compiling does the reading once and leaves
behind something a later question can be answered from directly — the sources
stay where they are, and the pages become the thing that gets searched.

What follows from that:

- A page is a subject someone would look up by name, not a chunk of a file.
- Every page lists the source paths it came from, so a claim can be checked.
- The pages are the only source of truth easymem keeps. The [[BM25 Index]] and
  the link graph are rebuilt from them at startup and never persisted.
- The pages are plain markdown. Delete easymem and a readable folder remains.

There is no model inside easymem. The agent on the other end of the pipe reads
the files, decides what a page should say, and calls `wiki_write`. easymem does
the parts a model is bad at: [[Multi-Hop Search]], the link graph, and
[[Incremental Ingest]].

Compiling buys speed at the cost of a second copy that can go stale. See
[[Drift]] for what is done about that.
