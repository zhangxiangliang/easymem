import { tokenize, buildBm25, bm25Search } from "../../src/wiki/bm25.js";

describe("tokenize", () => {
  it("splits latin text and drops stop words", () => {
    expect(tokenize("The checkout flow is a mess")).toEqual(["checkout", "flow", "mess"]);
  });

  it("splits on full-width punctuation, not only ASCII", () => {
    // Real Chinese text uses these forms. Without them a whole clause arrives
    // as one token and matches nothing.
    expect(tokenize("订单，服务。支付")).toEqual(
      expect.arrayContaining(["订单", "服务", "支付"]),
    );
  });

  it("emits CJK bigrams plus the whole run", () => {
    expect(tokenize("结算流程")).toEqual(["结算", "算流", "流程", "结算流程"]);
  });

  it("leaves a single CJK character alone", () => {
    expect(tokenize("的")).toEqual([]); // stop word
    expect(tokenize("表")).toEqual(["表"]);
  });

  it("splits a run that switches script with no separator", () => {
    const out = tokenize("mysql索引");
    expect(out).toContain("mysql");
    expect(out).toContain("索引");
  });

  it("drops CJK stop words", () => {
    expect(tokenize("的 是 了")).toEqual([]);
  });

  it("returns nothing for empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

const DOCS = [
  { id: "a", title: "Checkout Flow", content: "How an order becomes a payment." },
  { id: "b", title: "Order Service", content: "Owns the checkout flow and the cart." },
  { id: "c", title: "结算流程", content: "订单如何变成支付。" },
];

describe("bm25Search", () => {
  it("ranks a title match above a body match for the same term", () => {
    // Title carries 5x the weight, so "Checkout Flow" must beat a page that
    // only mentions checkout in its body.
    const hits = bm25Search(buildBm25(DOCS), "checkout", 10);
    expect(hits[0]!.id).toBe("a");
    expect(hits.map((h) => h.id)).toContain("b");
  });

  it("matches by prefix, so a partial word still finds the page", () => {
    expect(bm25Search(buildBm25(DOCS), "check", 10)[0]!.id).toBe("a");
  });

  it("finds a Chinese page by a two-character query", () => {
    const hits = bm25Search(buildBm25(DOCS), "结算", 10);
    expect(hits[0]!.id).toBe("c");
  });

  it("scores every hit above zero and sorts descending", () => {
    const hits = bm25Search(buildBm25(DOCS), "flow", 10);
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(h.score).toBeGreaterThan(0);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
    }
  });

  it("honours the limit", () => {
    expect(bm25Search(buildBm25(DOCS), "the checkout order flow", 1)).toHaveLength(1);
    expect(bm25Search(buildBm25(DOCS), "checkout", 0)).toHaveLength(0);
  });

  it("returns nothing for an empty query, an all-stop-word query, or an empty index", () => {
    expect(bm25Search(buildBm25(DOCS), "", 10)).toEqual([]);
    expect(bm25Search(buildBm25(DOCS), "the is a", 10)).toEqual([]);
    expect(bm25Search(buildBm25([]), "checkout", 10)).toEqual([]);
  });

  it("counts a query token once per document even when the prefix expands wide", () => {
    // "order" and "orders" are two indexed terms; a document holding both must
    // not be scored twice for the single query token.
    const idx = buildBm25([
      { id: "one", title: "x", content: "order orders ordering" },
      { id: "two", title: "x", content: "order" },
    ]);
    const [top] = bm25Search(idx, "order", 10);
    expect(top!.id).toBe("one");
  });
});

describe("buildBm25", () => {
  it("records one entry per document and averages the field lengths", () => {
    const idx = buildBm25(DOCS);
    expect(idx.ids).toEqual(["a", "b", "c"]);
    expect(idx.lengths).toHaveLength(3);
    expect(idx.avgTitleLen).toBeGreaterThan(0);
    expect(idx.avgContentLen).toBeGreaterThan(0);
  });

  it("keeps the term list sorted, so a prefix query can binary-search it", () => {
    const { terms } = buildBm25(DOCS);
    expect([...terms].sort()).toEqual(terms);
  });

  it("survives an empty document set", () => {
    const idx = buildBm25([]);
    expect(idx.ids).toEqual([]);
    expect(idx.avgTitleLen).toBe(0);
  });
});
