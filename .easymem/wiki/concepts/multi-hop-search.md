---
type: concept
title: Multi-Hop Search
description: BM25 seeds expanded along wikilinks, so a page that never mentions
  the query still surfaces.
sources:
  - src/wiki/graph-search.ts
  - src/wiki/manager.ts
timestamp: 2026-08-15T07:40:20.883Z
---

Search runs in two stages, and the second one is why the graph exists.

1. BM25 over every page produces seed hits, scored. See [[BM25 Index]].
2. Those seeds expand outward along `[[wikilinks]]` for `hop` levels, and each
   hop multiplies the score by a decay factor.

The result is that **a page containing none of the query words still comes
back**, if a page that does match links to it. Asking about refunds returns the
refund policy and the payment code it depends on, even though the code never
says "refund". Full-text search alone cannot do this, and it is the reason
linking pages is not decoration.

Rules the expansion follows:

- A seed keeps its BM25 score and stays at hop 0, even when another seed links
  to it. A real text match is never demoted to a derived one.
- A page reached by several paths keeps the highest score. Layer-by-layer
  traversal means the first arrival already fixed the minimum hop count.
- `via` records which page the hit was reached through, so an irrelevant `via`
  points at a wrong link rather than a wrong result.
- Visited nodes are capped, so a dense graph cannot make one query walk
  everything.

Implemented in `graphMultiHopSearch`. Depends on the graph that
[[Wiki Manager]] builds while scanning.
