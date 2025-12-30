import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  // Mark dependencies as external to avoid bundling Node.js-only code
  // - Light Protocol: only used by ./light entry point (server-side)
  // - tweetnacl: has CommonJS Node.js fallbacks that break browser builds
  external: ["@lightprotocol/stateless.js", "tweetnacl"],
});
