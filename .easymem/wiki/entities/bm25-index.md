---
type: entity
title: BM25 Index
description: In-memory full-text index with a mixed Chinese and English tokenizer.
sources:
  - src/wiki/bm25.ts
timestamp: 2026-08-15T07:40:53.860Z
---

An in-memory BM25 index over every page, rebuilt from the markdown whenever the
pages change. Nothing is persisted: the pages are the source of truth, and
rebuilding a thousand of them takes about 120 ms.

Two fields per page, title weighted five times the body, so a page named after
what you asked for outranks one that merely mentions it.

The tokenizer handles Chinese and English in one pass:

- Latin runs split on whitespace and punctuation, ASCII and full-width alike.
  Full-width punctuation matters — real Chinese text uses it, and without those
  separators a whole clause arrives as one token.
- CJK runs emit every adjacent bigram plus the whole run, because Chinese has no
  spaces and a two-character query has to match something.
- A run that switches script with no separator between (`mysql索引`) splits at
  the boundary, and each side is tokenized by its own rule.
- Stop words are dropped in both languages.

Query tokens match indexed terms by prefix, capped so a short prefix cannot
expand to the whole vocabulary. When one query token matches several terms in
the same page, only its best-scoring term counts, so a broad prefix cannot score
one page twice for one word.

Feeds the seed hits that [[Multi-Hop Search]] expands.
