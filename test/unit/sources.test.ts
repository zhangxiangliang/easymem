import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  sha256,
  readSources,
  writeSources,
  classifySources,
  type SourceMap,
} from "../../src/wiki/sources.js";

describe("sha256", () => {
  it("is stable and content-sensitive", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(sha256("hello")).not.toBe(sha256("hello "));
  });
});

describe("classifySources", () => {
  const known: SourceMap = {
    "a.md": { sha256: "aaa", size: 1, ingestedAt: "2026-01-01" },
    "b.md": { sha256: "bbb", size: 1, ingestedAt: "2026-01-01" },
  };

  it("reports a file it has never seen as to-ingest", () => {
    const r = classifySources([{ filename: "new.md", sha256: "zzz" }], known);
    expect(r.toIngest).toEqual(["new.md"]);
  });

  it("reports a file whose hash moved as to-ingest", () => {
    const r = classifySources([{ filename: "a.md", sha256: "changed" }], known);
    expect(r.toIngest).toEqual(["a.md"]);
    expect(r.skipped).toEqual([]);
  });

  it("skips a file whose hash is unchanged", () => {
    const r = classifySources([{ filename: "a.md", sha256: "aaa" }], known);
    expect(r.skipped).toEqual(["a.md"]);
    expect(r.toIngest).toEqual([]);
  });

  it("reports a tracked file missing from disk as deleted", () => {
    const r = classifySources([{ filename: "a.md", sha256: "aaa" }], known);
    expect(r.deleted).toEqual(["b.md"]);
  });

  it("treats everything as new when nothing is known yet", () => {
    const r = classifySources([{ filename: "a.md", sha256: "aaa" }], {});
    expect(r.toIngest).toEqual(["a.md"]);
    expect(r.deleted).toEqual([]);
  });

  it("handles an empty disk list", () => {
    const r = classifySources([], known);
    expect(r.toIngest).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(r.deleted).toEqual(["a.md", "b.md"]);
  });
});

describe("readSources / writeSources", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "easywiki-sources-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty map before anything is written", () => {
    expect(readSources(dir)).toEqual({});
  });

  it("round-trips a map, creating .state on the way", () => {
    const map: SourceMap = { "a.md": { sha256: "aaa", size: 3, ingestedAt: "2026-01-01" } };
    writeSources(dir, map);
    expect(readSources(dir)).toEqual(map);
  });

  it("treats a corrupt store as empty rather than crashing the server", () => {
    // A hand-edited or half-written file must cost a re-ingest, not a startup
    // failure — the pages on disk are the source of truth, this is only a cache.
    mkdirSync(join(dir, ".state"), { recursive: true });
    writeFileSync(join(dir, ".state", "sources.json"), "{ not json", "utf-8");
    expect(readSources(dir)).toEqual({});
  });

  it("treats a non-object store as empty", () => {
    mkdirSync(join(dir, ".state"), { recursive: true });
    writeFileSync(join(dir, ".state", "sources.json"), "42", "utf-8");
    expect(readSources(dir)).toEqual({});
  });
});
