---
type: entity
title: Index File
description: The generated wiki/index.md, and the two mistakes it avoids.
sources:
  - src/wiki/index-builder.ts
timestamp: 2026-08-15T07:41:27.734Z
---

`wiki/index.md` is the human entry point: every page grouped by type, as
`* [title](path) - description`.

Regenerated whole on every reindex, never patched, so it cannot drift from the
pages it lists. Group order is fixed and titles sort inside a group, so
rebuilding an unchanged wiki produces an identical file and an empty diff.

Two details that are easy to get wrong:

- Links are **relative**. index.md sits inside `wiki/`, so a leading slash would
  resolve against the repository root and every link would be dead on GitHub and
  in an editor alike.
- Links are plain markdown, not `[[wikilinks]]`. A wikilink here would add an
  edge from the index to every page and turn it into an artificial hub that
  [[Multi-Hop Search]] would walk on every query.

It carries `type: index` in its own frontmatter, which keeps it out of search,
out of the graph, out of `wiki_list`, and out of the orphan report in [[Drift]].

A page that cannot be read or has no frontmatter is skipped rather than
failing the rebuild.
