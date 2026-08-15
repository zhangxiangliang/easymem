/**
 * Jest, running native ESM.
 *
 * easywiki is a `"type": "module"` package, so three things are not optional:
 *   - `extensionsToTreatAsEsm` — .ts files are ESM, not CommonJS.
 *   - `moduleNameMapper` — source files import `./slug.js` (required for a tsc
 *     ESM build); at test time that specifier has to resolve back to slug.ts.
 *   - `NODE_OPTIONS=--experimental-vm-modules` in the test script — Jest cannot
 *     load ES modules without it.
 *
 * @type {import("jest").Config}
 */
export default {
  verbose: true,
  testTimeout: 15000,
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: "tsconfig.test.json" }],
  },
  testMatch: ["<rootDir>/test/unit/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  moduleFileExtensions: ["ts", "js", "json", "node"],
  collectCoverageFrom: ["src/**/*.ts", "!src/cli.ts"],
};
