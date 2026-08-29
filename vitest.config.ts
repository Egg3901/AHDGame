import { defineConfig } from "vitest/config";
import path from "path";
// TODO: Consider adding E2E test configuration support in future iterations

export default defineConfig({
  test: {
    // Dynamic route imports can exceed 5s under parallel load on slower machines/CI.
    testTimeout: 15_000,
    environment: "node",
    // Worker threads rather than vitest's default child-process forks.
    //
    // 71% of this suite's runtime is per-file module loading, not test bodies,
    // and threads pay that setup cost far more cheaply: measured over the full
    // 33,441-test suite, 215.01s -> 173.96s wall, with import down 26%,
    // transform 45% and setup 38% while test execution barely moved.
    //
    // It also matters for memory on CI. Forks give every worker its own heap,
    // so the workflow's --max-old-space-size=6144 grants 6GB per process on a
    // runner with roughly 7GB total; threads share one heap instead.
    //
    // `isolate` stays on. Turning it off runs the suite in about a quarter of
    // the time, but src/lib alone holds roughly 128 module-level mutable
    // registries and caches against 8 declared test resetters, and 1,132 files
    // use `vi.mock`, which vitest hoists per file and cannot scope to a shared
    // module graph. Sharing the graph leaks that state between files, and which
    // suites break shifts from run to run with worker scheduling.
    pool: "threads",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/**/*.spec.ts",
      "shared/**/*.test.ts",
      "tests/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
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
