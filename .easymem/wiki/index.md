---
type: index
title: Index
---

# Index

## Entities

* [BM25 Index](entities/bm25-index.md) - In-memory full-text index with a mixed Chinese and English tokenizer.
* [Index File](entities/index-file.md) - The generated wiki/index.md, and the two mistakes it avoids.
* [Wiki Manager](entities/wiki-manager.md) - Scans the pages, holds the index and the graph, answers search.

## Concepts

* [Compiled Knowledge](concepts/compiled-knowledge.md) - Why easymem searches written pages instead of the sources they came from.
* [Drift](concepts/drift.md) - Why a wiki rots quietly, and the eight checks that find it.
* [Incremental Ingest](concepts/incremental-ingest.md) - Content hashing, so an unchanged source file costs nothing to skip.
* [Multi-Hop Search](concepts/multi-hop-search.md) - BM25 seeds expanded along wikilinks, so a page that never mentions the query still surfaces.
* [Page Format](concepts/page-format.md) - Frontmatter keys, the slug rules, and why both are stable on purpose.
* [Two Front Ends](concepts/two-front-ends.md) - One tool table behind both the shell and MCP, so they cannot disagree.
