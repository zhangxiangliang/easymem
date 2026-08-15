---
type: concept
title: Drift
description: Why a wiki rots quietly, and the eight checks that find it.
sources:
  - src/wiki/lint.ts
timestamp: 2026-08-15T07:43:34.565Z
---

Drift is the price of [[Compiled Knowledge]]. The wiki is derived data. The risk is not that it duplicates the sources — it is
that it stops matching them, and nothing about a stale page looks stale. It
reads as confident and current while the file it describes has moved on.

`wiki_lint` reports eight kinds of rot, all mechanical:

| Check | Meaning |
| --- | --- |
| `danglingLinks` | A `[[link]]` with no page behind it |
| `orphans` | Nothing links here, so almost nothing reaches it |
| `missingSources` | The page declares nothing, so no claim can be checked |
| `staleSources` | A declared source is gone from disk |
| `outdated` | A declared source changed content since the page was written |
| `untracked` | A declared source was never ingested, so nothing watches it |
| `missingLinks` | The page names another page in prose without linking it |
| `reviewForContradiction` | Pages built from the same source |

`outdated` compares the sha256 stored by [[Incremental Ingest]] against the file
on disk. Comparing timestamps instead would report every page citing a file
somebody reformatted, and a check that cries wolf is a check people turn off.

`reviewForContradiction` returns candidates and never a verdict. Two pages can
describe one file from different angles without disagreeing, and deciding that
is a judgement — which is what the agent on the other end is for. A false
contradiction is worse than a missed one, because the page that gets rewritten
was never wrong.

Two sources of noise are excluded rather than reported. Links and mentions
are read from prose with code stripped first, so a page documenting the link
syntax does not link to it and a page quoting a filename is not told to link
to a page of that name. And structural pages are never suggested as a link
target, or every page saying "the index" would be told to link the generated
index.

Structural pages (`index`, `purpose`, `schema`) are exempt as subjects too: the generated
[[Index File]] has no sources and nothing links to it, and reporting that every
run would be noise.
