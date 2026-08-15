---
type: entity
title: Wiki Manager
description: Scans the pages, holds the index and the graph, answers search.
sources:
  - src/wiki/manager.ts
timestamp: 2026-08-15T07:43:34.647Z
---

Owns the wiki on disk: scanning `wiki/` for pages, holding the read model, and
answering search.

On scan it walks the directory, parses each page's frontmatter (see [[Page Format]]),
extracts its outbound `[[wikilinks]]` from prose with code spans stripped, and builds two things from what it found — the
[[BM25 Index]] and an undirected graphology graph with one node per page and one
edge per link. Both live in memory and both are thrown away and rebuilt when the
pages change. A `media` directory is skipped.

`search` runs BM25 for seeds, hands them to [[Multi-Hop Search]] for expansion,
and decorates each hit with a precomputed snippet, its page type, and its graph
neighbours. The snippet is the page's frontmatter description, so a caller can
decide whether to open the page without fetching it.

`readPage` refuses any path that resolves outside `wiki/`, and tries the path as
given before appending `.md`.

State is a registry of one wiki keyed by name, persisted to
`.state/wiki-sources.json`. A wiki left mid-scan by a crash comes back marked
`error` rather than `scanning`, so a restart cannot leave it stuck. The registry
is a leftover from a multi-wiki design and now always holds exactly one entry.
