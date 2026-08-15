---
name: easy-llm-wiki
description: Search the project's wiki before reading source files, and write back what you work out. Use it when you need to know what this project already knows — how a service works, why a decision was made, what a term means — or when you have just figured something out that the next session should not have to figure out again. Runs with npx, nothing to install.
---

# easymem

The project can have a wiki: markdown pages an agent wrote after reading the
sources, so nobody has to read them again. Search it with `npx easymem`.

The wiki is **compiled knowledge, not a log**. Every page is a subject someone
would look up by name, and every page says which source files it came from.

## Search before you grep

```bash
npx easymem search "how are refunds handled"
```

A miss costs a second. A hit saves you reading the files.

Search is BM25 over every page, and then it walks one hop along `[[wikilinks]]`.
That second part is the reason to use it: **a page that never contains your
words still comes back, if a matching page links to it.** Asking about refunds
returns the refund policy *and* the payment code it depends on, even though the
code never says "refund".

```bash
npx easymem search "checkout" --limit 5 --hop 2
```

Raise `--hop` to 2 for the context around an answer rather than the answer
itself. Drop it to 0 when you know the exact term and want direct hits only.

If the wiki is empty, `search` returns nothing and `list` returns `[]`. Say so
and offer to build it — see **Building it** below.

## Reading a result

| Field | What to do with it |
| --- | --- |
| `hop: 0` | A direct text match. Trust it as the answer. |
| `hop: 1` or more | Reached by following a link, not by matching your words. Context — read it, but it may not answer the question. |
| `via` | Only above hop 0: the page it came through. If `via` looks irrelevant, the link is probably wrong. |
| `score` | Meaningful only against the other hits in the same result. There is no absolute threshold. |
| `snippet` | The page's one-line description. Enough to decide whether to open it, never enough to answer from. |
| `related` | Neighbours in the graph. Cheap next reads. |

Search does not return the source files a page came from. Open the page for
those:

```bash
npx easymem read wiki/concepts/checkout-flow.md   # prints the page, sources in the frontmatter
npx easymem list                                  # every page with its sources
npx easymem graph                                 # hubs to start from, orphans to fix
```

## When the wiki disagrees with the code

**The code wins.** A page is one agent's reading of the source on one day, and
the source has moved since. When a page and the file it cites disagree, believe
the file, say so, and fix the page.

To find those pages before they mislead someone:

```bash
npx easymem lint
```

- `outdated` — the source changed content since the page was written. Re-read
  and reconcile. This is compared by hash, so it is a real edit, not a reformat.
- `staleSources` — the source is gone. The page may describe nothing.
- `danglingLinks` — a `[[link]]` with no page. A typo, or a page worth writing.
- `orphans` — nothing links here. Usually a missing link elsewhere.
- `missingSources` / `untracked` — the page cannot be checked, or nothing is
  watching what it came from.
- `missingLinks` — it names another page in prose without linking it. Adding the
  link is what makes that page reachable by search.
- `reviewForContradiction` — pages built from the same source. **Candidates, not
  findings.** Read both before changing either: two pages can describe one file
  from different angles without disagreeing, and rewriting a page that was never
  wrong costs more than leaving the pair alone.

Start with `summary` — it counts each category, so you can tell at a glance
whether there is anything worth reading.

## Write when you learn something durable

Durable means: still true next month, and expensive to work out again. An
architecture, a data flow, a gotcha, the reason an obvious approach does not
work. Not today's bug and not today's diff.

**Read the rules first — they are not in this file:**

```bash
npx easymem guide
```

That prints the page format, the type list, the linking convention and the
update protocol. They are what keep the wiki searchable instead of turning it
into a pile of notes. This file says *when* to reach for the wiki; `guide` says
*how* to write in it.

```bash
npx easymem write --type concept --title "Checkout Flow" \
  --description "Why money moves at shipment, not at checkout." \
  --sources docs/checkout.md,src/payment.ts \
  --body-file /tmp/page.md
```

`--body-file` is usually easier than `--body` — a page is multi-line markdown
and quoting it inline goes wrong. Piping the body in works too.

## Building it

```bash
npx easymem pending src/**/*.ts docs/*.md
```

It answers with `to_ingest` (new or changed), `skipped` (already done and
unchanged — **do not read these again**) and `deleted` (gone from disk, so their
pages are stale).

Read each path in `to_ingest`, then `write` once per subject worth its own page.
One source file often makes several pages.

Finish with:

```bash
npx easymem reindex --ingested src/a.ts,docs/b.md
```

**Search results do not change until you do this.** A page you just wrote is
invisible to `search` until the reindex runs.

## Judgement, not rules

- **A gap is a result.** If the wiki did not answer the question and you had to
  read the sources, that is worth a page. Write it before you move on.
- **Merge, do not clobber.** `write` on an existing type and title overwrites
  it, with nothing to stop you — not even a page a human hand-edited. `read` it
  first and fold your new understanding in, or you silently delete what the last
  pass learned.
- **A wiki this small is not worth it.** If the project is twenty tidy files,
  say so — grep is faster and a wiki is overhead. It earns its keep when the
  sources are large, scattered, or expensive to read.

## Where the pages go

`.easymem/wiki/`, next to the code. Plain markdown: commit it, read it, edit it
by hand. `.easymem/.state/` is a cache and belongs in `.gitignore`. Point
somewhere else with `--dir <path>` or `EASYMEM_DIR`.

## If you would rather connect it over MCP

Every subcommand here is the same tool the MCP server exposes. Running as a
server keeps the index warm between calls, which is worth it for a long session
over a large wiki; `npx` rebuilds it each time, about 200 ms for a thousand
pages. To connect it, tell the user to add this to `.mcp.json` and restart:

```json
{
  "mcpServers": {
    "easymem": { "command": "npx", "args": ["-y", "easymem"] }
  }
}
```

Then call the tools `wiki_search`, `wiki_read`, `wiki_write` and the rest
directly instead of shelling out.

## Do not

- Do not re-read files `pending` reported as `skipped`.
- Do not translate. Keep the language the source is written in.
- Do not write anything the source does not say. No page is better than a
  confident wrong one, because the next reader will trust it.
