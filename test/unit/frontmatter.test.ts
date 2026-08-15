import {
  parseFrontmatter,
  buildPage,
  isLocked,
  readSources,
} from "../../src/wiki/frontmatter.js";

const PAGE = `---
type: entity
title: Order Service
sources:
  - src/order/service.ts
---

Body text.
`;

describe("parseFrontmatter", () => {
  it("splits a well-formed page into frontmatter and body", () => {
    const { frontmatter, body, hasFrontmatter } = parseFrontmatter(PAGE);
    expect(hasFrontmatter).toBe(true);
    expect(frontmatter.type).toBe("entity");
    expect(frontmatter.title).toBe("Order Service");
    expect(frontmatter.sources).toEqual(["src/order/service.ts"]);
    expect(body.trim()).toBe("Body text.");
  });

  it("accepts CRLF line endings", () => {
    const { frontmatter, hasFrontmatter } = parseFrontmatter(PAGE.replace(/\n/g, "\r\n"));
    expect(hasFrontmatter).toBe(true);
    expect(frontmatter.type).toBe("entity");
  });

  it("degrades to type:other instead of throwing on broken YAML", () => {
    // A page with a bad block is still a page a human can read and fix. Throwing
    // here would take down the whole directory scan for one bad file.
    const { frontmatter, hasFrontmatter } = parseFrontmatter("---\ntype: [unclosed\n---\n\nBody\n");
    expect(hasFrontmatter).toBe(false);
    expect(frontmatter.type).toBe("other");
  });

  it("treats a page with no frontmatter as all body", () => {
    const { frontmatter, body, hasFrontmatter } = parseFrontmatter("# Just a heading\n");
    expect(hasFrontmatter).toBe(false);
    expect(frontmatter.type).toBe("other");
    expect(body).toBe("# Just a heading\n");
  });

  it("fills in a missing or blank type", () => {
    expect(parseFrontmatter("---\ntitle: X\n---\n\nB\n").frontmatter.type).toBe("other");
    expect(parseFrontmatter("---\ntype: '   '\n---\n\nB\n").frontmatter.type).toBe("other");
  });

  it("keeps unknown keys", () => {
    const { frontmatter } = parseFrontmatter("---\ntype: entity\nowner: platform\n---\n\nB\n");
    expect(frontmatter.owner).toBe("platform");
  });
});

describe("isLocked", () => {
  it("is true only for an explicit locked: true", () => {
    expect(isLocked("---\ntype: entity\nlocked: true\n---\n\nB\n")).toBe(true);
    expect(isLocked("---\ntype: entity\nlocked: false\n---\n\nB\n")).toBe(false);
    expect(isLocked(PAGE)).toBe(false);
  });
});

describe("readSources", () => {
  it("returns the declared source paths", () => {
    expect(readSources(PAGE)).toEqual(["src/order/service.ts"]);
  });

  it("returns an empty list when sources is missing or not a list of strings", () => {
    expect(readSources("---\ntype: entity\n---\n\nB\n")).toEqual([]);
    expect(readSources("---\ntype: entity\nsources: nope\n---\n\nB\n")).toEqual([]);
  });

  it("drops non-string entries rather than passing them through", () => {
    expect(readSources("---\ntype: entity\nsources:\n  - a.ts\n  - 42\n---\n\nB\n")).toEqual(["a.ts"]);
  });
});

describe("buildPage", () => {
  it("writes the known keys in a fixed order so rewrites diff small", () => {
    const out = buildPage(
      { type: "entity", timestamp: "2026-01-01", title: "T", description: "D" },
      "Body",
    );
    const keys = out
      .split("---")[1]!
      .trim()
      .split("\n")
      .map((line) => line.split(":")[0]);
    expect(keys).toEqual(["type", "title", "description", "timestamp"]);
  });

  it("never writes locked — that mark belongs to the human", () => {
    const out = buildPage({ type: "entity", locked: true }, "Body");
    expect(out).not.toContain("locked");
  });

  it("passes custom keys through", () => {
    expect(buildPage({ type: "entity", owner: "platform" }, "Body")).toContain("owner: platform");
  });

  it("defaults a missing type to other", () => {
    expect(buildPage({} as never, "Body")).toContain("type: other");
  });

  it("round-trips through parseFrontmatter", () => {
    const built = buildPage(
      { type: "concept", title: "结算流程", sources: ["docs/a.md"] },
      "  Body with padding  ",
    );
    const { frontmatter, body } = parseFrontmatter(built);
    expect(frontmatter.type).toBe("concept");
    expect(frontmatter.title).toBe("结算流程");
    expect(frontmatter.sources).toEqual(["docs/a.md"]);
    expect(body.trim()).toBe("Body with padding");
  });
});
