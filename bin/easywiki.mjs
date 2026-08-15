#!/usr/bin/env node
import { main } from "../dist/mcp.js";

main().catch((err) => {
  console.error("easywiki failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
