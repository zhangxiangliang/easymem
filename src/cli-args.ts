/**
 * Argument parsing and the subcommand table for the easymem CLI.
 *
 * Split out from cli.ts so it can be tested without running the program: cli.ts
 * starts a server or executes a command the moment it is imported, which is
 * exactly what a test must not do.
 */

import { readFileSync } from "node:fs";

import { toolCatalog } from "./mcp.js";
import { VERSION } from "./version.js";

export interface Command {
  /** Subcommand name, as typed. */
  name: string;
  /**
   * The MCP tool it calls, or absent for a command that is not a wiki
   * operation. Only `skill` is in that group: installing a skill file is
   * something a person does to their agent, and putting it in the tool list
   * would offer an MCP client a tool it can never have a use for.
   */
  tool?: string;
  /** For a command with no tool: what to print. */
  print?: () => string;
  /** Usage line shown by --help. */
  usage: string;
  summary: string;
  /** Turn the remaining argv into tool arguments. */
  args: (rest: string[], flags: Flags) => Record<string, unknown>;
}

export type Flags = Map<string, string>;

/** Split argv into positional words and `--flag value` pairs. */
export function parse(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      // A flag followed by another flag, or by nothing, is a boolean.
      if (next === undefined || next.startsWith("--")) flags.set(key, "true");
      else {
        flags.set(key, next);
        i += 1;
      }
    } else positional.push(arg);
  }
  return { positional, flags };
}

/** A comma-separated flag, or an empty list. `--sources a.ts,b.ts` */
export function commaList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * The packaged SKILL.md.
 *
 * Shipping it through the CLI rather than telling people to download it means
 * the file always matches the installed version, works offline, and cannot rot
 * against a URL. `../SKILL.md` resolves to the package root from both
 * dist/cli-args.js and src/ under tsx.
 */
export function readSkill(): string {
  return readFileSync(new URL("../SKILL.md", import.meta.url), "utf-8");
}

/** Body text from --body, --body-file, or piped stdin. */
export function readBody(flags: Flags): string {
  const inline = flags.get("body");
  if (inline !== undefined && inline !== "true") return inline;
  const file = flags.get("body-file");
  if (file) return readFileSync(file, "utf-8");
  if (!process.stdin.isTTY) {
    try {
      return readFileSync(0, "utf-8");
    } catch {
      /* nothing piped */
    }
  }
  throw new Error("no body: pass --body <text>, --body-file <path>, or pipe it in");
}

export const COMMANDS: Command[] = [
  {
    name: "skill",
    usage: "skill",
    summary: "Print the agent skill file, to save into your agent's skills directory.",
    print: readSkill,
    args: () => ({}),
  },
  {
    name: "guide",
    tool: "wiki_guide",
    usage: "guide",
    summary: "Print the writing rules. Read these before writing any page.",
    args: () => ({}),
  },
  {
    name: "search",
    tool: "wiki_search",
    usage: 'search <query> [--limit N] [--hop N]',
    summary: "Full-text search, then one hop along [[links]]. Do this before grep.",
    args: (rest, flags) => {
      const query = rest.join(" ").trim();
      if (!query) throw new Error("search needs a query");
      return {
        query,
        limit: flags.has("limit") ? Number(flags.get("limit")) : undefined,
        hop: flags.has("hop") ? Number(flags.get("hop")) : undefined,
      };
    },
  },
  {
    name: "list",
    tool: "wiki_list",
    usage: "list [--type TYPE]",
    summary: "Every page: id, title, type, path, sources.",
    args: (_rest, flags) => ({ type: flags.get("type") }),
  },
  {
    name: "read",
    tool: "wiki_read",
    usage: "read <path>",
    summary: "Print one page in full.",
    args: (rest) => {
      if (!rest[0]) throw new Error("read needs a page path");
      return { path: rest[0] };
    },
  },
  {
    name: "graph",
    tool: "wiki_graph",
    usage: "graph",
    summary: "The whole link graph — hubs to start from, orphans to fix.",
    args: () => ({}),
  },
  {
    name: "lint",
    tool: "wiki_lint",
    usage: "lint",
    summary: "Find what has rotted: dead links, orphans, and pages their sources have outgrown.",
    args: () => ({}),
  },
  {
    name: "pending",
    tool: "wiki_pending",
    usage: "pending <path>...",
    summary: "Which of these source files are new or changed since last time.",
    args: (rest, flags) => {
      const paths = rest.length ? rest : commaList(flags.get("paths"));
      if (!paths.length) throw new Error("pending needs at least one path");
      return { paths };
    },
  },
  {
    name: "write",
    tool: "wiki_write",
    usage:
      "write --type TYPE --title TITLE [--body TEXT | --body-file PATH | stdin]\n" +
      "                      [--sources a.ts,b.ts] [--description TEXT]",
    summary: "Write one page. Overwrites a page with the same type and title.",
    args: (_rest, flags) => {
      const type = flags.get("type");
      const title = flags.get("title");
      if (!type) throw new Error("write needs --type (see `easymem guide`)");
      if (!title) throw new Error("write needs --title");
      return {
        type,
        title,
        body: readBody(flags),
        sources: commaList(flags.get("sources")),
        description: flags.get("description"),
      };
    },
  },
  {
    name: "delete",
    tool: "wiki_delete",
    usage: "delete <path>",
    summary: "Delete one page.",
    args: (rest) => {
      if (!rest[0]) throw new Error("delete needs a page path");
      return { path: rest[0] };
    },
  },
  {
    name: "reindex",
    tool: "wiki_reindex",
    usage: "reindex [--ingested a.ts,b.ts] [--removed c.ts]",
    summary: "Rebuild the index, the graph and index.md. Search is stale until you do.",
    args: (_rest, flags) => ({
      ingested: commaList(flags.get("ingested")),
      removed: commaList(flags.get("removed")),
    }),
  },
];

export function help(): string {
  const lines = COMMANDS.map((c) => `  easymem ${c.usage}\n      ${c.summary}`);
  return `easymem ${VERSION} — a local wiki your coding agent writes and searches.

Run with no arguments to start the MCP stdio server. Run a subcommand to use the
same wiki from a shell, with no MCP configuration at all.

Usage:
  easymem [--dir <path>]              start the MCP server on stdio
${lines.join("\n\n")}

Options:
  --dir <path>    Where the wiki lives. Default .easymem, or EASYMEM_DIR.
  -h, --help      Show this help
  -v, --version   Show the version

Subcommands print JSON, except \`guide\` and \`read\`, which print text.
Every subcommand rebuilds the index, so a long session is cheaper over MCP.

Tools exposed over MCP: ${toolCatalog().map((t) => t.name).join(", ")}`;
}
