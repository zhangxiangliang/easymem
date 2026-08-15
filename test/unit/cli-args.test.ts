import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMANDS, commaList, help, parse, type Flags } from "../../src/cli-args.js";
import { toolCatalog } from "../../src/mcp.js";

/** Build the tool arguments a subcommand would send, straight from argv. */
function argsFor(argv: string[]): Record<string, unknown> {
  const { positional, flags } = parse(argv);
  const command = COMMANDS.find((c) => c.name === positional[0]);
  if (!command) throw new Error(`no such command: ${positional[0]}`);
  return command.args(positional.slice(1), flags);
}

describe("parse", () => {
  it("separates words from --flag value pairs", () => {
    const { positional, flags } = parse(["search", "checkout", "flow", "--limit", "5"]);
    expect(positional).toEqual(["search", "checkout", "flow"]);
    expect(flags.get("limit")).toBe("5");
  });

  it("treats a flag with no value as a boolean", () => {
    expect(parse(["list", "--verbose"]).flags.get("verbose")).toBe("true");
    expect(parse(["list", "--verbose", "--type", "entity"]).flags.get("verbose")).toBe("true");
  });

  it("accepts flags before the subcommand", () => {
    const { positional, flags } = parse(["--dir", "./somewhere", "list"]);
    expect(positional).toEqual(["list"]);
    expect(flags.get("dir")).toBe("./somewhere");
  });

  it("returns nothing for an empty argv", () => {
    const { positional, flags } = parse([]);
    expect(positional).toEqual([]);
    expect(flags.size).toBe(0);
  });
});

describe("commaList", () => {
  it("splits, trims and drops the empties", () => {
    expect(commaList("a.ts, b.ts ,,c.ts")).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("is empty for nothing at all", () => {
    expect(commaList(undefined)).toEqual([]);
    expect(commaList("")).toEqual([]);
    expect(commaList(" , ")).toEqual([]);
  });
});

describe("every subcommand maps to a real tool", () => {
  // The CLI and the MCP server must expose the same behaviour; a subcommand
  // pointing at a tool that does not exist would only fail at run time. The
  // list comes from the server itself rather than a copy here, so adding a tool
  // cannot leave this check quietly out of date.
  const toolNames = new Set(toolCatalog().map((t) => t.name));

  it.each(COMMANDS.filter((c) => c.tool).map((c) => [c.name, c.tool]))(
    "%s → %s",
    (_name, tool) => {
      expect(toolNames.has(tool as string)).toBe(true);
    },
  );

  it("gives a command without a tool something to print instead", () => {
    for (const command of COMMANDS.filter((c) => !c.tool)) {
      expect(typeof command.print).toBe("function");
    }
  });

  it("prints a skill file with the frontmatter an agent needs", () => {
    const skill = COMMANDS.find((c) => c.name === "skill")!.print!();
    // The name is what `skills find` matches on, so it carries the words
    // someone would search for. `easymem` matched neither "wiki" nor "llm".
    expect(skill).toMatch(/^---\nname: easy-llm-wiki\n/);
    expect(skill).toContain("description:");
  });

  it("has no duplicate names", () => {
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("search", () => {
  it("joins the words after the subcommand into one query", () => {
    expect(argsFor(["search", "how", "are", "refunds", "handled"])).toMatchObject({
      query: "how are refunds handled",
    });
  });

  it("passes limit and hop through as numbers", () => {
    expect(argsFor(["search", "x", "--limit", "3", "--hop", "2"])).toMatchObject({
      limit: 3,
      hop: 2,
    });
  });

  it("leaves limit and hop undefined so the tool defaults apply", () => {
    expect(argsFor(["search", "x"])).toEqual({ query: "x", limit: undefined, hop: undefined });
  });

  it("refuses an empty query rather than searching for nothing", () => {
    expect(() => argsFor(["search"])).toThrow(/needs a query/);
  });
});

describe("read and delete", () => {
  it("take the path as the first word", () => {
    expect(argsFor(["read", "wiki/concepts/x.md"])).toEqual({ path: "wiki/concepts/x.md" });
    expect(argsFor(["delete", "wiki/concepts/x.md"])).toEqual({ path: "wiki/concepts/x.md" });
  });

  it("refuse to run with no path", () => {
    expect(() => argsFor(["read"])).toThrow(/needs a page path/);
    expect(() => argsFor(["delete"])).toThrow(/needs a page path/);
  });
});

describe("pending", () => {
  it("takes paths as words", () => {
    expect(argsFor(["pending", "a.ts", "b.ts"])).toEqual({ paths: ["a.ts", "b.ts"] });
  });

  it("also accepts a comma list", () => {
    expect(argsFor(["pending", "--paths", "a.ts,b.ts"])).toEqual({ paths: ["a.ts", "b.ts"] });
  });

  it("refuses to run with no paths", () => {
    expect(() => argsFor(["pending"])).toThrow(/at least one path/);
  });
});

describe("reindex", () => {
  it("splits both lists", () => {
    expect(argsFor(["reindex", "--ingested", "a.ts,b.ts", "--removed", "c.ts"])).toEqual({
      ingested: ["a.ts", "b.ts"],
      removed: ["c.ts"],
    });
  });

  it("runs with nothing, to rebuild after a hand edit", () => {
    expect(argsFor(["reindex"])).toEqual({ ingested: [], removed: [] });
  });
});

describe("write", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "easymem-cli-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("takes the body inline", () => {
    expect(
      argsFor(["write", "--type", "concept", "--title", "Checkout Flow", "--body", "Body text"]),
    ).toMatchObject({ type: "concept", title: "Checkout Flow", body: "Body text" });
  });

  it("reads the body from a file, which is how a real page arrives", () => {
    const file = join(dir, "body.md");
    writeFileSync(file, "Line one\n\nLine two\n");
    expect(
      argsFor(["write", "--type", "entity", "--title", "T", "--body-file", file]),
    ).toMatchObject({ body: "Line one\n\nLine two\n" });
  });

  it("splits sources on commas", () => {
    expect(
      argsFor(["write", "--type", "entity", "--title", "T", "--body", "b",
        "--sources", "src/a.ts, src/b.ts"]),
    ).toMatchObject({ sources: ["src/a.ts", "src/b.ts"] });
  });

  it("defaults sources to an empty list rather than undefined", () => {
    expect(argsFor(["write", "--type", "entity", "--title", "T", "--body", "b"])).toMatchObject({
      sources: [],
    });
  });

  it("names the missing flag instead of failing vaguely", () => {
    expect(() => argsFor(["write", "--title", "T", "--body", "b"])).toThrow(/--type/);
    expect(() => argsFor(["write", "--type", "entity", "--body", "b"])).toThrow(/--title/);
  });
});

describe("help", () => {
  it("lists every subcommand, so nothing is undiscoverable", () => {
    const text = help();
    for (const command of COMMANDS) expect(text).toContain(`easymem ${command.usage.split("\n")[0]}`);
  });

  it("says how to reach both front ends", () => {
    expect(help()).toContain("MCP");
    expect(help()).toMatch(/--dir/);
  });
});

// Referenced so the Flags type stays exported and used.
export type _Flags = Flags;
