import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    tailwindcss(),
    cloudflare(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/react-app"),
    },
  },
  environments: {
    client: {
      optimizeDeps: {
        // Exclude Light Protocol from client optimization - it has Node.js dependencies.
        // The SDK uses dynamic import() for Light Protocol, but Vite's pre-bundler still
        // analyzes it. The dashboard never calls Light Protocol methods (listFeedbacks,
        // listValidations), so these are never actually loaded at runtime.
        exclude: ["@lightprotocol/stateless.js", "@solana/web3.js"],
      },
    },
  },
});
