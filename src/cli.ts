#!/usr/bin/env node
/**
 * Command-line entry for easywiki. The whole CLI is "start the MCP server on
 * stdio" — there are no subcommands, because the agent on the other end drives
 * everything through tool calls.
 *
 *   easywiki [--dir <path>]        # or EASYWIKI_DIR
 */

import { main } from "./mcp.js";

main().catch((err: unknown) => {
  console.error("easywiki failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
