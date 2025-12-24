import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "light/index": "src/light/index.ts",
    "web3-compat/index": "src/web3-compat/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  // Mark Light Protocol dependencies as external to avoid bundling Node.js-only code
  // These are only used by the ./light entry point which should only be imported server-side
  external: ["@lightprotocol/stateless.js", "@solana/web3.js"],
});
