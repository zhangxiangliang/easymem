import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderIndex, rebuildIndexFile, type IndexEntry } from "../../src/wiki/index-builder.js";

function entry(title: string, type: string, relPath = `${type}s/${title.toLowerCase()}.md`, description = ""): IndexEntry {
  return { title, type, relPath, description };
}

describe("renderIndex", () => {
  it("links relatively, because index.md sits in the same directory", () => {
    // The regression: paths used to be written with a leading slash, which a
    // markdown renderer resolves against the repository root. Every link in the
    // generated index was dead — on GitHub, in an editor, everywhere.
    const out = renderIndex([entry("Order Service", "entity", "entities/order-service.md")]);
    expect(out).toContain("[Order Service](entities/order-service.md)");
    expect(out).not.toContain("](/");
  });

  it("carries type: index so the file stays out of search and the graph", () => {
    expect(renderIndex([])).toContain("type: index");
  });

  it("groups by type in a fixed order", () => {
    const out = renderIndex([
      entry("C", "concept"),
      entry("S", "source"),
      entry("E", "entity"),
    ]);
    expect(out.indexOf("## Sources")).toBeLessThan(out.indexOf("## Entities"));
    expect(out.indexOf("## Entities")).toBeLessThan(out.indexOf("## Concepts"));
  });

  it("sorts titles inside a group, so rewriting an unchanged wiki diffs empty", () => {
    const out = renderIndex([entry("Zebra", "entity"), entry("Alpha", "entity")]);
    expect(out.indexOf("Alpha")).toBeLessThan(out.indexOf("Zebra"));
  });

  it("appends the description only when there is one", () => {
    const withDesc = renderIndex([entry("A", "entity", "entities/a.md", "Does a thing.")]);
    expect(withDesc).toContain("[A](entities/a.md) - Does a thing.");
    expect(renderIndex([entry("B", "entity", "entities/b.md")])).toContain("[B](entities/b.md)\n");
  });

  it("gives an unrecognised type its own section rather than dropping the page", () => {
    const out = renderIndex([entry("G", "glossary", "glossary/g.md")]);
    expect(out).toContain("## Glossary");
    expect(out).toContain("[G](glossary/g.md)");
  });

  it("renders an empty wiki without crashing", () => {
    const out = renderIndex([]);
    expect(out).toContain("# Index");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("uses plain links, never wikilinks, so the index is not a graph hub", () => {
    expect(renderIndex([entry("A", "entity")])).not.toContain("[[");
  });
});

describe("rebuildIndexFile", () => {
  let root: string;
  let wiki: string;

  const page = (rel: string, frontmatter: string, body = "Body") => {
    const full = join(wiki, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, `---\n${frontmatter}\n---\n\n${body}\n`);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "easymem-index-"));
    wiki = join(root, "wiki");
    mkdirSync(wiki, { recursive: true });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("writes index.md and counts the pages it listed", () => {
    page("entities/a.md", "type: entity\ntitle: Alpha\ndescription: First.");
    page("concepts/b.md", "type: concept\ntitle: Beta");

    expect(rebuildIndexFile(root)).toBe(2);

    const index = readFileSync(join(wiki, "index.md"), "utf-8");
    expect(index).toContain("[Alpha](entities/a.md) - First.");
    expect(index).toContain("[Beta](concepts/b.md)");
  });

  it("leaves itself and the other scaffolding out of the listing", () => {
    page("entities/a.md", "type: entity\ntitle: Alpha");
    page("index.md", "type: index\ntitle: Index");
    page("schema.md", "type: schema\ntitle: Schema");

    expect(rebuildIndexFile(root)).toBe(1);
    expect(readFileSync(join(wiki, "index.md"), "utf-8")).not.toContain("Schema");
  });

  it("falls back to the filename when a page has no title", () => {
    page("entities/no-title.md", "type: entity");
    rebuildIndexFile(root);
    expect(readFileSync(join(wiki, "index.md"), "utf-8")).toContain("[no-title](entities/no-title.md)");
  });

  it("skips the media directory and non-markdown files", () => {
    page("entities/a.md", "type: entity\ntitle: Alpha");
    mkdirSync(join(wiki, "media"), { recursive: true });
    writeFileSync(join(wiki, "media", "note.md"), "---\ntype: entity\ntitle: Hidden\n---\n\nx\n");
    writeFileSync(join(wiki, "entities", "notes.txt"), "not markdown");

    expect(rebuildIndexFile(root)).toBe(1);
    expect(readFileSync(join(wiki, "index.md"), "utf-8")).not.toContain("Hidden");
  });

  it("keeps a page with broken frontmatter instead of losing it silently", () => {
    page("entities/broken.md", "type: [unclosed");
    expect(rebuildIndexFile(root)).toBe(1);
    // parseFrontmatter degrades to type "other", so it lands in its own section.
    expect(readFileSync(join(wiki, "index.md"), "utf-8")).toContain("broken");
  });

  it("does nothing when there is no wiki directory yet", () => {
    const empty = mkdtempSync(join(tmpdir(), "easymem-empty-"));
    expect(rebuildIndexFile(empty)).toBe(0);
    rmSync(empty, { recursive: true, force: true });
  });

  it("is idempotent — running it twice produces the same file", () => {
    page("entities/a.md", "type: entity\ntitle: Alpha");
    rebuildIndexFile(root);
    const first = readFileSync(join(wiki, "index.md"), "utf-8");
    rebuildIndexFile(root);
    expect(readFileSync(join(wiki, "index.md"), "utf-8")).toBe(first);
  });
});
