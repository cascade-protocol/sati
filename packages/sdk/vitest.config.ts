import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["verbose"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/generated/**", // Codama-generated code
        "src/index.ts", // Re-exports only
      ],
      thresholds: {
        statements: 40,
        branches: 25,
        functions: 25,
        lines: 40,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          globalSetup: ["./tests/helpers/global-setup.ts"],
          testTimeout: 60000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});
