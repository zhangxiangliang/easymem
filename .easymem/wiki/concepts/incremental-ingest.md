---
type: concept
title: Incremental Ingest
description: Content hashing, so an unchanged source file costs nothing to skip.
sources:
  - src/wiki/sources.ts
  - src/mcp.ts
timestamp: 2026-08-15T07:43:34.731Z
---

Re-reading a file that has not changed costs tokens and produces the same page.
`wiki_pending` exists to make that skippable.

Given a list of paths, it hashes each file with sha256 and compares against the
record written by the last `wiki_reindex`:

- `to_ingest` — never seen, or the hash moved. Work on these.
- `skipped` — recorded and unchanged. Do not read them again.
- `deleted` — recorded before, absent from the list now. Their pages are stale.
- `unreadable` — the path could not be read at all, kept separate from "new".

The record lives in `.state/sources.json` as `path → { sha256, size,
ingestedAt }`. It is the one fact that cannot be derived from the pages
themselves, which is why it is the one thing besides the pages that gets
written. Deleting it costs a full re-read and nothing else.

`wiki_pending` and `wiki_reindex` are reachable from a shell and over MCP
alike — see [[Two Front Ends]].

The same hashes are what let [[Drift]] detection compare content rather than
timestamps.
