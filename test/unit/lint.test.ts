import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { lint } from "../../src/wiki/lint.js";
import { pageRelPath, slugify } from "../../src/wiki/slug.js";
import { sha256, type SourceMap } from "../../src/wiki/sources.js";
import type { WikiPage } from "../../src/wiki/types.js";

/**
 * A page as the manager would have scanned it. Paths come from the real
 * pageRelPath, so the fixture cannot drift from where a page actually lands.
 */
function page(
  title: string,
  body: string,
  extra: Partial<Pick<WikiPage, "type" | "sources" | "links">> = {},
): WikiPage {
  const type = extra.type ?? "entity";
  const relPath = pageRelPath(type, title);
  return {
    id: `${type}/${slugify(title)}`,
    title,
    type,
    path: `/tmp/${relPath}`,
    relPath,
    content: body,
    sources: extra.sources ?? [],
    links: extra.links ?? [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!),
  };
}

const NO_SOURCES: SourceMap = {};

describe("links", () => {
  it("reports a [[link]] with no page behind it", () => {
    const r = lint([page("Alpha", "See [[Ghost]].", { sources: ["a.ts"] })], NO_SOURCES, "/nope");
    expect(r.danglingLinks).toEqual([{ page: "wiki/entities/alpha.md", target: "Ghost" }]);
  });

  it("matches a link target whatever its case or padding", () => {
    const pages = [
      page("Alpha", "See [[ beta ]].", { sources: ["a.ts"] }),
      page("Beta", "See [[ALPHA]].", { sources: ["b.ts"] }),
    ];
    expect(lint(pages, NO_SOURCES, "/nope").danglingLinks).toEqual([]);
  });

  it("reports a page nothing links to", () => {
    const pages = [
      page("Alpha", "Goes to [[Beta]].", { sources: ["a.ts"] }),
      page("Beta", "Ends here.", { sources: ["b.ts"] }),
    ];
    expect(lint(pages, NO_SOURCES, "/nope").orphans).toEqual(["wiki/entities/alpha.md"]);
  });

  it("never calls the generated index an orphan", () => {
    const pages = [page("Index", "# Index", { type: "index" })];
    const r = lint(pages, NO_SOURCES, "/nope");
    expect(r.orphans).toEqual([]);
    expect(r.missingSources).toEqual([]);
  });

  it("reports prose that names a page without linking it", () => {
    const pages = [
      page("Alpha", "This leans on Payment Gateway throughout.", { sources: ["a.ts"] }),
      page("Payment Gateway", "Linked from [[Alpha]].", { sources: ["b.ts"] }),
    ];
    expect(lint(pages, NO_SOURCES, "/nope").missingLinks).toEqual([
      { page: "wiki/entities/alpha.md", shouldLink: "Payment Gateway" },
    ]);
  });

  it("does not flag a mention that is already a link", () => {
    const pages = [
      page("Alpha", "Handled by [[Payment Gateway]].", { sources: ["a.ts"] }),
      page("Payment Gateway", "See [[Alpha]].", { sources: ["b.ts"] }),
    ];
    expect(lint(pages, NO_SOURCES, "/nope").missingLinks).toEqual([]);
  });

  it("does not read a mention inside code as prose", () => {
    // A page about the page format quotes `sources` and `index.md` constantly.
    // Counting those as prose asked it to link a page for every quoted word.
    const pages = [
      page("Alpha", "The frontmatter key is `Payment Gateway` in code, not prose.", {
        sources: ["a.ts"],
      }),
      page("Payment Gateway", "See [[Alpha]].", { sources: ["b.ts"] }),
    ];
    expect(lint(pages, NO_SOURCES, "/nope").missingLinks).toEqual([]);
  });

  it("does not suggest linking a structural page", () => {
    const pages = [
      page("Alpha", "Rebuilding the index is cheap. [[Beta]] agrees.", { sources: ["a.ts"] }),
      page("Beta", "See [[Alpha]].", { sources: ["b.ts"] }),
      page("Index", "# Index", { type: "index" }),
    ];
    expect(lint(pages, NO_SOURCES, "/nope").missingLinks).toEqual([]);
  });

  it("ignores titles too short to mean anything", () => {
    const pages = [
      page("Alpha", "The id is everywhere in this text.", { sources: ["a.ts"] }),
      page("id", "See [[Alpha]].", { sources: ["b.ts"] }),
    ];
    expect(lint(pages, NO_SOURCES, "/nope").missingLinks).toEqual([]);
  });
});

describe("sources", () => {
  let root: string;

  const write = (name: string, content: string) => {
    writeFileSync(join(root, name), content);
    return content;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "easymem-lint-"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reports a page that declares no sources at all", () => {
    expect(lint([page("Alpha", "Body.")], NO_SOURCES, root).missingSources)
      .toEqual(["wiki/entities/alpha.md"]);
  });

  it("reports a declared source that is gone from disk", () => {
    const r = lint([page("Alpha", "Body.", { sources: ["gone.ts"] })], NO_SOURCES, root);
    expect(r.staleSources).toEqual([{ page: "wiki/entities/alpha.md", missing: ["gone.ts"] }]);
  });

  it("reports a source whose content changed since it was ingested", () => {
    // The point of hashing rather than timestamping: this fires on a real edit.
    const before = write("a.ts", "export const a = 1;\n");
    const known: SourceMap = {
      "a.ts": { sha256: sha256(before), size: before.length, ingestedAt: "2026-01-01" },
    };
    write("a.ts", "export const a = 999;\n");

    const r = lint([page("Alpha", "Body.", { sources: ["a.ts"] })], known, root);
    expect(r.outdated).toEqual([{ page: "wiki/entities/alpha.md", changed: ["a.ts"] }]);
  });

  it("stays quiet when the source is byte-for-byte what was ingested", () => {
    const content = write("a.ts", "export const a = 1;\n");
    const known: SourceMap = {
      "a.ts": { sha256: sha256(content), size: content.length, ingestedAt: "2026-01-01" },
    };
    const r = lint([page("Alpha", "Body.", { sources: ["a.ts"] })], known, root);
    expect(r.outdated).toEqual([]);
    expect(r.untracked).toEqual([]);
  });

  it("reports a source that was never ingested, because nothing watches it", () => {
    write("a.ts", "export const a = 1;\n");
    const r = lint([page("Alpha", "Body.", { sources: ["a.ts"] })], NO_SOURCES, root);
    expect(r.untracked).toEqual([{ page: "wiki/entities/alpha.md", sources: ["a.ts"] }]);
    expect(r.outdated).toEqual([]);
  });

  it("separates gone from changed on one page", () => {
    const content = write("here.ts", "x\n");
    const known: SourceMap = {
      "here.ts": { sha256: "stale-hash", size: 1, ingestedAt: "2026-01-01" },
    };
    expect(content).toBeTruthy();
    const r = lint(
      [page("Alpha", "Body.", { sources: ["here.ts", "gone.ts"] })],
      known,
      root,
    );
    expect(r.staleSources[0]!.missing).toEqual(["gone.ts"]);
    expect(r.outdated[0]!.changed).toEqual(["here.ts"]);
  });

  it("hashes a shared source once, however many pages cite it", () => {
    const content = write("a.ts", "x\n");
    const known: SourceMap = {
      "a.ts": { sha256: sha256(content), size: 1, ingestedAt: "2026-01-01" },
    };
    const pages = [
      page("Alpha", "[[Beta]]", { sources: ["a.ts"] }),
      page("Beta", "[[Alpha]]", { sources: ["a.ts"] }),
    ];
    expect(lint(pages, known, root).outdated).toEqual([]);
  });
});

describe("contradiction candidates", () => {
  it("pairs pages built from the same source", () => {
    const pages = [
      page("One", "[[Two]]", { sources: ["shared.md", "extra.md"] }),
      page("Two", "[[One]]", { sources: ["shared.md"] }),
    ];
    expect(lint(pages, NO_SOURCES, "/nope").reviewForContradiction).toEqual([
      { pages: ["wiki/entities/one.md", "wiki/entities/two.md"], sharedSources: ["shared.md"] },
    ]);
  });

  it("leaves pages that share nothing alone", () => {
    const pages = [
      page("One", "[[Two]]", { sources: ["a.md"] }),
      page("Two", "[[One]]", { sources: ["b.md"] }),
    ];
    expect(lint(pages, NO_SOURCES, "/nope").reviewForContradiction).toEqual([]);
  });
});

describe("the report itself", () => {
  it("counts every finding, so a caller can skip reading the detail", () => {
    const r = lint([page("Alpha", "See [[Ghost]].")], NO_SOURCES, "/nope");
    expect(r.summary.danglingLinks).toBe(1);
    expect(r.summary.missingSources).toBe(1);
    expect(r.summary.orphans).toBe(1);
    expect(r.summary.outdated).toBe(0);
  });

  it("is entirely empty for a healthy wiki", () => {
    const pages = [
      page("Alpha", "Goes to [[Beta]].", { sources: ["a.ts"] }),
      page("Beta", "Goes to [[Alpha]].", { sources: ["b.ts"] }),
    ];
    // Sources are unreadable here, so only the link checks can pass — which is
    // exactly what this asserts: no check invents a finding out of nothing.
    const r = lint(pages, NO_SOURCES, "/nope");
    expect(r.danglingLinks).toEqual([]);
    expect(r.orphans).toEqual([]);
    expect(r.missingLinks).toEqual([]);
    expect(r.reviewForContradiction).toEqual([]);
  });

  it("survives an empty wiki", () => {
    const r = lint([], NO_SOURCES, "/nope");
    expect(Object.values(r.summary).every((n) => n === 0)).toBe(true);
  });
});
