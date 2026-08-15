---
name: easymem
description: Look things up in the project wiki before reading source files, and file what you learn back into it. Use it when you need to know what this project already knows — how a service works, why a decision was made, what a term means — or when you have just worked something out that the next session should not have to work out again.
---

# easymem

The project has a wiki, served over MCP by `easymem`. It is compiled knowledge:
pages an agent wrote after reading the sources, so you do not have to read them
again.

## Read before you search the code

`wiki_search` first, `grep` second. Search is BM25 over every page and then one
hop along `[[wikilinks]]`, so a page that never uses your words still surfaces
when a matching page links to it. A hit gives you the answer and the source
paths it came from; a miss costs milliseconds.

Use `wiki_read` to open a page, `wiki_list` to see everything, `wiki_graph` to
find the hubs (start here) and the orphans (probably stale).

## Write when you learn something durable

Durable means: true next month, and expensive to work out again. An architecture,
a data flow, a gotcha, why an obvious approach does not work. Not: today's bug,
today's diff.

Do not write pages from memory of this conversation. Call **`wiki_guide`** and
follow what it returns — the page format, the type list, the linking rules and
the update protocol all live there, and they are what make the wiki searchable
instead of a pile of notes. This file tells you *when* to reach for the wiki;
`wiki_guide` tells you *how* to write in it.

The short version of the loop: `wiki_pending` → read only what changed →
`wiki_write` once per subject → `wiki_reindex` at the end. Search results do not
change until you reindex.

## Do not

- Do not re-read source files that `wiki_pending` reports as `skipped`.
- Do not translate. Keep the language the source is written in.
- Do not write anything the source does not say.
