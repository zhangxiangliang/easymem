import { defineConfig } from "tsdown";
import packageJson from "./package.json" with { type: "json" };

function collectExternalDependencies(): string[] {
  return [...Object.keys(packageJson.dependencies ?? {})];
}

export default defineConfig({
  entry: ["./src/mcp.ts"],
  outDir: "./dist",
  format: "esm",
  platform: "node",
  clean: true,
  fixedExtension: false,
  dts: false,
  sourcemap: false,
  deps: {
    neverBundle: (id) => {
      if (id.startsWith("node:")) return true;
      for (const dep of collectExternalDependencies()) {
        if (id === dep || id.startsWith(`${dep}/`)) return true;
      }
      return false;
    },
  },
});
