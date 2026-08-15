---
type: concept
title: Two Front Ends
description: One tool table behind both the shell and MCP, so they cannot disagree.
sources:
  - src/cli.ts
  - src/cli-args.ts
  - src/mcp.ts
timestamp: 2026-08-15T07:40:53.781Z
---

easymem is reachable two ways, and they are the same code.

- `easymem` with nothing piping to it prints help; with a pipe it speaks MCP
  over stdio.
- `easymem search "..."` and the other subcommands run one tool and print the
  result, with no MCP configuration anywhere.

Both go through `runTool(name, args, ctx)` against one array of tool
definitions, so a subcommand and a tool call with the same arguments cannot do
different things. Adding a tool adds it to both at once, and a test asserts that
every subcommand points at a tool the server actually exposes.

The trade is cost. A subcommand builds the [[BM25 Index]] and the link graph on
every invocation — roughly 200 ms for a thousand pages — where the server keeps
them warm across calls. Shells are for trying it and for one-off questions;
MCP is for a long session over a large wiki.

The reason the subcommands exist at all is adoption. Editing `.mcp.json` and
restarting a client stands between someone hearing about easymem and seeing what
it does, and for an agent, a tool it cannot reach is a tool it does not have.

Argument parsing lives apart from the entry point, because the entry point runs
on import and a test must not start a server.
