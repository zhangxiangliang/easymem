import { slugify, dirForType, pageRelPath } from "../../src/wiki/slug.js";

describe("slugify", () => {
  it("lowercases a latin title and joins words with hyphens", () => {
    expect(slugify("Checkout Flow")).toBe("checkout-flow");
    expect(slugify("MCP Server")).toBe("mcp-server");
  });

  it("treats punctuation as a run boundary, never as a character", () => {
    expect(slugify("Payment / Refund!")).toBe("payment-refund");
    expect(slugify("v1.0 — release")).toBe("v1-0-release");
  });

  it("collapses repeated separators and trims the edges", () => {
    expect(slugify("  ---Order  Service---  ")).toBe("order-service");
  });

  it("keeps CJK characters instead of romanising or dropping them", () => {
    // Dropping them would slug an all-CJK title to the empty string; romanising
    // would collide two titles that are different words with the same pinyin.
    expect(slugify("结算流程")).toBe("结算流程");
    expect(slugify("订单 服务")).toBe("订单-服务");
  });

  it("splits a mixed run at the script boundary", () => {
    expect(slugify("MySQL 索引")).toBe("mysql-索引");
    expect(slugify("索引MySQL")).toBe("索引-mysql");
  });

  it("is stable — the same title always produces the same slug", () => {
    // This is the whole point: an unstable slug means the second wiki_write
    // creates a near-duplicate page instead of updating the first one.
    const title = "Checkout Flow 结算流程 v2";
    expect(slugify(title)).toBe(slugify(title));
    expect(slugify(title)).toBe("checkout-flow-结算流程-v2");
  });

  it("returns an empty string for blank input", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
  });
});

describe("dirForType", () => {
  it("maps the known page types to their directories", () => {
    expect(dirForType("entity")).toBe("entities");
    expect(dirForType("concept")).toBe("concepts");
    expect(dirForType("source")).toBe("sources");
    expect(dirForType("comparison")).toBe("comparisons");
    expect(dirForType("synthesis")).toBe("synthesis");
  });

  it("folds the legacy aliases onto the same five directories", () => {
    expect(dirForType("thesis")).toBe("synthesis");
    expect(dirForType("finding")).toBe("synthesis");
    expect(dirForType("methodology")).toBe("concepts");
  });

  it("ignores case and surrounding space", () => {
    expect(dirForType("  Entity  ")).toBe("entities");
  });

  it("gives an unknown type a directory of its own name", () => {
    expect(dirForType("glossary")).toBe("glossary");
    expect(dirForType("")).toBe("other");
  });
});

describe("pageRelPath", () => {
  it("builds a wiki-relative path from the type and the title", () => {
    expect(pageRelPath("entity", "Order Service")).toBe("wiki/entities/order-service.md");
    expect(pageRelPath("concept", "结算流程")).toBe("wiki/concepts/结算流程.md");
  });

  it("sends an unknown type to its own directory", () => {
    expect(pageRelPath("glossary", "BM25")).toBe("wiki/glossary/bm25.md");
  });
});
