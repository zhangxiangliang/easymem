/**
 * The ingest guide handed to the calling agent.
 *
 * easymem has no model of its own. The agent that connects over MCP is the
 * model — it reads the source files, decides what a page should say, and calls
 * `wiki_write`. This text is the whole contract for that job, returned by the
 * `wiki_guide` tool so it works the same in Claude Code, Codex and opencode
 * without any per-client config file.
 */

export const INGEST_GUIDE = `# easymem — how to build the wiki

You are the writer. easymem only stores, indexes and links what you write.

## Workflow

1. Collect the source files you want in the wiki (glob, find, git ls-files — your own tools).
2. Call \`wiki_pending\` with those paths. It returns:
   - \`to_ingest\` — new or changed since last time. Work on these.
   - \`skipped\` — unchanged and already ingested. Do not re-read them.
   - \`deleted\` — recorded before and missing now. **Only filled in when you pass
     \`complete: true\` with the full source list**; a partial list cannot tell a
     file that is gone from one you simply did not mention, and deleting pages on
     that guess destroys good work.
3. For each path in \`to_ingest\`: read the file, then call \`wiki_write\` once per
   distinct thing worth its own page. One source file often makes several pages.
4. Call \`wiki_reindex\` once at the end, passing every path you finished.
   Search results do not change until you do this.

## What makes a page

One page = one subject that someone would look up by name. Split a source file
into pages by subject, not by heading or by length.

Page types:
- \`entity\` — a concrete thing in the system: a service, a module, a table, a role.
- \`concept\` — an idea that spans things: an architecture, a data flow, a policy.
- \`source\` — one summary page per source document, so a reader can find the original.
- \`comparison\`, \`synthesis\` — use when they genuinely fit; do not force them.

## Writing rules

- Write the page for someone who has not read the source. Do not write "as mentioned above".
- Link related pages with \`[[Page Title]]\`. Links build the graph, and the graph is
  what makes multi-hop search work. A page with no links is nearly invisible.
- A link to a page that does not exist yet is fine — it marks the gap.
- Keep the language of the source. Do not translate.
- Facts only. If the source does not say it, do not write it.
- Every page must list the source paths it came from, so a reader can verify.

## Updating

\`wiki_write\` on an existing title overwrites that page. Read it first with
\`wiki_read\` and merge — do not silently drop what is already there.
`;
