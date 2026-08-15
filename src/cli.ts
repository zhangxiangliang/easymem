#!/usr/bin/env node
/**
 * Command-line entry for easymem. Two front ends over one wiki:
 *
 *   easymem                 → MCP stdio server, for a client that speaks MCP
 *   easymem search "..."    → a subcommand, for anything that has a shell
 *
 * The subcommands exist because MCP is a setup cost. Editing `.mcp.json` and
 * restarting the client stands between someone hearing about easymem and seeing
 * what it does; `npx easymem search "..."` does not. An agent with a shell can
 * use the whole wiki with nothing configured.
 *
 * Every subcommand calls the same tool the MCP server exposes, with the same
 * arguments, so the two front ends cannot drift apart. The cost is that a
 * subcommand rebuilds the in-memory index on each run — roughly 200 ms for a
 * thousand pages — where the server keeps it warm.
 */

import { COMMANDS, help, parse } from "./cli-args.js";
import { createContext, main as startServer, parseDir, runTool } from "./mcp.js";
import { VERSION } from "./version.js";

async function run(argv: string[]): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(help());
    return 0;
  }
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(VERSION);
    return 0;
  }

  const { positional, flags } = parse(argv);
  const name = positional[0];

  // No subcommand: serve MCP when something is piping to us, otherwise the
  // person is standing at a prompt and wants to know what this thing is. The
  // old behaviour here was to sit silently forever, which reads as a hang.
  if (!name) {
    if (process.stdin.isTTY) {
      console.log(help());
      return 0;
    }
    await startServer(argv);
    return 0;
  }

  const command = COMMANDS.find((c) => c.name === name);
  if (!command) {
    console.error(`unknown command: ${name}\n\nRun \`easymem --help\` for the list.`);
    return 1;
  }

  // A command with no tool prints something and touches no wiki, so it must
  // not create one as a side effect of being run in the wrong directory.
  if (command.print) {
    console.log(command.print());
    return 0;
  }

  const ctx = createContext(parseDir(argv), process.cwd());
  const out = runTool(command.tool!, command.args(positional.slice(1), flags), ctx);
  console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
  return 0;
}

run(process.argv.slice(2))
  .then((code) => {
    if (code !== 0) process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
