import Graph from "graphology";

import { graphMultiHopSearch } from "../../src/wiki/graph-search.js";

/** a — b — c — d, plus an isolated node. */
function chain(): Graph {
  const g = new Graph({ type: "undirected" });
  for (const [id, label] of [
    ["a", "A"],
    ["b", "B"],
    ["c", "C"],
    ["d", "D"],
    ["lonely", "Lonely"],
  ]) {
    g.addNode(id, { label });
  }
  g.addEdge("a", "b");
  g.addEdge("b", "c");
  g.addEdge("c", "d");
  return g;
}

const OPTS = { hop: 2, decay: 0.5, minScore: 0.01 };

describe("graphMultiHopSearch", () => {
  it("keeps a seed at hop 0 with its original BM25 score", () => {
    const hits = graphMultiHopSearch(chain(), [{ id: "a", score: 10 }], OPTS);
    const a = hits.find((h) => h.id === "a")!;
    expect(a.hop).toBe(0);
    expect(a.score).toBe(10);
    expect(a.via).toBeUndefined();
  });

  it("decays the score once per hop", () => {
    const hits = graphMultiHopSearch(chain(), [{ id: "a", score: 10 }], OPTS);
    expect(hits.find((h) => h.id === "b")).toMatchObject({ hop: 1, score: 5 });
    expect(hits.find((h) => h.id === "c")).toMatchObject({ hop: 2, score: 2.5 });
  });

  it("stops at the hop limit", () => {
    const hits = graphMultiHopSearch(chain(), [{ id: "a", score: 10 }], OPTS);
    expect(hits.find((h) => h.id === "d")).toBeUndefined();
  });

  it("records which page it arrived through", () => {
    const hits = graphMultiHopSearch(chain(), [{ id: "a", score: 10 }], OPTS);
    expect(hits.find((h) => h.id === "b")!.via).toBe("A");
    expect(hits.find((h) => h.id === "c")!.via).toBe("B");
  });

  it("never demotes a seed reached from another seed", () => {
    // b is a seed with a low score and also one hop from a. It stays hop 0 with
    // its own score — a decayed path must not overwrite a real BM25 hit.
    const hits = graphMultiHopSearch(
      chain(),
      [
        { id: "a", score: 10 },
        { id: "b", score: 1 },
      ],
      OPTS,
    );
    expect(hits.find((h) => h.id === "b")).toMatchObject({ hop: 0, score: 1 });
  });

  it("drops nodes that decay below minScore", () => {
    const hits = graphMultiHopSearch(chain(), [{ id: "a", score: 10 }], {
      ...OPTS,
      minScore: 6,
    });
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });

  it("returns only the seeds when hop is 0", () => {
    const hits = graphMultiHopSearch(chain(), [{ id: "a", score: 10 }], { ...OPTS, hop: 0 });
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });

  it("ignores a seed that is not in the graph", () => {
    expect(graphMultiHopSearch(chain(), [{ id: "ghost", score: 10 }], OPTS)).toEqual([]);
  });

  it("never reaches an unlinked page", () => {
    const hits = graphMultiHopSearch(chain(), [{ id: "a", score: 10 }], { ...OPTS, hop: 5 });
    expect(hits.map((h) => h.id)).not.toContain("lonely");
  });

  it("sorts by score, highest first", () => {
    const hits = graphMultiHopSearch(chain(), [{ id: "a", score: 10 }], OPTS);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
    }
  });

  it("stops expanding once maxNodes is reached", () => {
    const hits = graphMultiHopSearch(chain(), [{ id: "a", score: 10 }], {
      ...OPTS,
      hop: 5,
      maxNodes: 2,
    });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("returns nothing for no seeds", () => {
    expect(graphMultiHopSearch(chain(), [], OPTS)).toEqual([]);
  });
});
