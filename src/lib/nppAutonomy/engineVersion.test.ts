import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { NPP_ENGINE_LEVEL, NPP_ENGINE_VERSION } from "./engineVersion";
import { NPP_AUTONOMY_LEVELS } from "./levels";

const changelog = readFileSync(
  join(__dirname, "..", "..", "..", "content", "changelog", "npp", "NPP_CHANGELOG.md"),
  "utf8"
);

/** Version headings (`## 6.0.0 (...)`), newest first. Roadmap headings are `###`. */
const releasedHeadings = [...changelog.matchAll(/^## (\d+\.\d+(?:\.\d+)?)\b/gm)].map((m) => m[1]);

describe("NPP engine version", () => {
  it("is semver", () => {
    expect(NPP_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // The rule this guards: a pull request that changes NPP behavior bumps the
  // version and writes the changelog section in the same change.
  it("matches the newest section of the NPP changelog", () => {
    expect(releasedHeadings[0]).toBe(NPP_ENGINE_VERSION);
  });

  it("lists changelog sections newest first", () => {
    const numeric = releasedHeadings.map((v) => v.split(".").map(Number));
    for (let i = 1; i < numeric.length; i++) {
      const [a, b] = [numeric[i - 1], numeric[i]];
      const cmp = (a[0] - b[0]) * 1e6 + (a[1] - b[1]) * 1e3 + ((a[2] ?? 0) - (b[2] ?? 0));
      expect(cmp, `${releasedHeadings[i - 1]} before ${releasedHeadings[i]}`).toBeGreaterThan(0);
    }
  });

  it("keeps the engine major on its autonomy tier", () => {
    expect(NPP_AUTONOMY_LEVELS).toContain(NPP_ENGINE_LEVEL);
    expect(NPP_ENGINE_LEVEL).toBe(`v${NPP_ENGINE_VERSION.split(".")[0]}`);
  });
});
