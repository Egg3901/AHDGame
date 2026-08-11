import { defineConfig } from "vitest/config";
import path from "path";
// TODO: Consider adding E2E test configuration support in future iterations

export default defineConfig({
  test: {
    // Dynamic route imports can exceed 5s under parallel load on slower machines/CI.
    testTimeout: 15_000,
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/*.spec.ts",
      "shared/**/*.test.ts",
      "tests/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/lib/**/*.{ts,tsx}"],
      exclude: ["**/*.test.ts", "**/test-utils/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
});
