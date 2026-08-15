#!/usr/bin/env node
/**
 * Command-line entry for easymem. The whole CLI is "start the MCP server on
 * stdio" — there are no subcommands, because the agent on the other end drives
 * everything through tool calls.
 *
 *   easymem [--dir <path>]        # or EASYMEM_DIR
 */

import { main } from "./mcp.js";

main().catch((err: unknown) => {
  console.error("easymem failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
