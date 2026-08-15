---
type: concept
title: Page Format
description: Frontmatter keys, the slug rules, and why both are stable on purpose.
sources:
  - src/wiki/frontmatter.ts
  - src/wiki/slug.ts
timestamp: 2026-08-15T07:41:27.656Z
---

A page is markdown with YAML frontmatter, and both halves are load-bearing.

Frontmatter keys, written in a fixed order so rewriting a page produces a small
diff: `type`, `title`, `description`, `sources`, `tags`, `timestamp`. Unknown
keys survive a round trip rather than being silently dropped.

- `type` decides the directory. Required; a missing or blank one becomes
  `other`.
- `sources` is what makes a claim checkable, and what [[Drift]] compares against.
- `locked: true` is a human pinning the page. `wiki_write` returns
  `skipped-locked` and leaves the file alone. easymem never writes the key
  itself — it is a mark for people, not for the tool.

Parsing is deliberately forgiving. A page with broken YAML comes back as
`{type: "other"}` instead of throwing, because one bad file must not take down
the scan of a whole directory.

The filename comes from the title through `slugify`, and stability is the whole
point: writing the same title twice has to land on the same file, or the second
write creates a near-duplicate page instead of updating the first. Latin runs
lowercase and join with hyphens; CJK characters are kept as they are, because
romanising would collide two different titles and dropping would slug an
all-CJK title to nothing. Punctuation is a separator, never a character — which
also means a title cannot climb out of the wiki directory.

The page *type* can, which is why the write path checks the resolved path
before writing.
