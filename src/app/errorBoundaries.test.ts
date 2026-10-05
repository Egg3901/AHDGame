import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(__dirname);

function errorBoundaries(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "api") continue;
    const p = join(dir, entry.name);
    if (existsSync(join(p, "error.tsx"))) out.push(join(p, "error.tsx"));
    errorBoundaries(p, out);
  }
  return out;
}

describe("app router error boundaries", () => {
  it("every segment boundary renders through the shared coded error content", () => {
    const files = errorBoundaries(APP);
    expect(files.length).toBeGreaterThan(30);
    const offenders = files.filter((f) => !readFileSync(f, "utf8").includes("ErrorPageContent"));
    expect(offenders).toEqual([]);
  });

  it("root, global and not-found screens expose an error code", () => {
    for (const f of ["error.tsx", "global-error.tsx", "not-found.tsx"]) {
      const src = readFileSync(join(APP, f), "utf8");
      expect(src).toMatch(/ErrorPageContent|useReportedError|error-code/);
    }
  });
});
