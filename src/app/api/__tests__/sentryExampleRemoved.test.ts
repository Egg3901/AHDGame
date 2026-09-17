/**
 * Regression test for issue #1675.
 * The Sentry example API route always threw and was publicly reachable, and
 * the demo page wired to it, letting anyone burn Sentry quota anonymously.
 * Both were removed; this test pins them as gone so the scaffold cannot
 * silently return on a future Sentry wizard re-run.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..", "..", "..", "..");

const removedPaths = [
  "src/app/api/sentry-example-api/route.ts",
  "src/app/sentry-example-page/page.tsx",
];

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx|js|jsx|json|mdx?)$/.test(entry)) {
      out.push(full);
    }
  }
}

describe("Sentry example scaffold removal (#1675)", () => {
  it.each(removedPaths)("does not ship %s", (relPath) => {
    expect(existsSync(join(repoRoot, relPath))).toBe(false);
  });

  it("leaves no references to the example route under src", () => {
    const files: string[] = [];
    collectSourceFiles(join(repoRoot, "src"), files);
    const hits = files.filter(
      (file) =>
        !file.endsWith("sentryExampleRemoved.test.ts") &&
        readFileSync(file, "utf8").includes("sentry-example-api")
    );
    expect(hits).toEqual([]);
  });
});
