import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/helpers/global-setup.ts"],
    testTimeout: 60000, // 60s for e2e tests with Light Protocol
    hookTimeout: 30000, // 30s for beforeAll/afterAll hooks
    reporters: ["verbose"],
    // Test file patterns for granular running
    // pnpm test:unit    - tests/unit/**
    // pnpm test:integration - tests/integration/**
    // pnpm test:e2e     - tests/e2e/**
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/generated/**", // Codama-generated code
        "src/index.ts", // Re-exports only
      ],
      // Coverage thresholds (baseline - increase as coverage grows)
      // Current: ~45% statements, ~33% branches, ~26% functions, ~45% lines
      thresholds: {
        statements: 40,
        branches: 25,
        functions: 25,
        lines: 40,
      },
    },
  },
});
