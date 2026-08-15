import { readFileSync } from "node:fs";

import { VERSION } from "../../src/version.js";

describe("VERSION", () => {
  it("matches package.json", () => {
    // The regression this guards: the version was a literal in mcp.ts, so
    // semantic-release bumped package.json to 0.1.1 while every MCP client was
    // still told 0.1.0. Nothing compared the two, so nothing noticed.
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
    expect(VERSION).toBe(pkg.version);
  });

  it("is a real version, not the unreadable-package fallback", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(VERSION).not.toBe("0.0.0");
  });
});
