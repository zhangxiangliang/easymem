/**
 * The package version, read from package.json at startup.
 *
 * It must not be a literal in the source. semantic-release bumps package.json
 * and nothing else, so a hardcoded string goes stale the first time a release
 * ships and then tells every connected client the wrong version — quietly,
 * because nothing compares the two.
 *
 * `../package.json` resolves to the package root from both `dist/version.js`
 * and `src/version.ts` under tsx, since both sit one level below it.
 */

import { readFileSync } from "node:fs";

function readVersion(): string {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
    );
    if (parsed && typeof parsed === "object") {
      const { version } = parsed as { version?: unknown };
      if (typeof version === "string" && version) return version;
    }
  } catch {
    // An unreadable package.json is not a reason to refuse to start; the
    // server still works, it just cannot name itself precisely.
  }
  return "0.0.0";
}

export const VERSION = readVersion();
