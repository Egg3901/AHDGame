import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { globSync } from "glob";
import { NPP_AUTONOMY_LEVEL_RANK, nppAutonomyLevelAtLeast } from "../featureFlag";
import { NPP_AUTONOMY_LEVELS } from "../levels";

describe("autonomy level rank", () => {
  it("orders every level", () => {
    expect(NPP_AUTONOMY_LEVEL_RANK).toEqual({
      off: 0,
      v0: 1,
      v1: 2,
      v2: 3,
      v3: 4,
      v4: 5,
      v5: 6,
      v6: 7,
    });
  });

  it("lists every level in rank order", () => {
    expect(NPP_AUTONOMY_LEVELS.map((level) => NPP_AUTONOMY_LEVEL_RANK[level])).toEqual(
      NPP_AUTONOMY_LEVELS.map((_, index) => index)
    );
    expect([...NPP_AUTONOMY_LEVELS].sort()).toEqual(Object.keys(NPP_AUTONOMY_LEVEL_RANK).sort());
  });

  it("treats the top tier as satisfying every lower tier", () => {
    for (const min of NPP_AUTONOMY_LEVELS) {
      expect(nppAutonomyLevelAtLeast("v6", min)).toBe(true);
    }
  });

  it("does not let v4 satisfy v5, or v5 satisfy v6", () => {
    expect(nppAutonomyLevelAtLeast("v4", "v5")).toBe(false);
    expect(nppAutonomyLevelAtLeast("v5", "v6")).toBe(false);
  });

  it("does not treat a lower level as satisfying a higher one", () => {
    expect(nppAutonomyLevelAtLeast("v3", "v4")).toBe(false);
    expect(nppAutonomyLevelAtLeast("off", "v0")).toBe(false);
    expect(nppAutonomyLevelAtLeast("v2", "v3")).toBe(false);
  });

  it("is reflexive", () => {
    expect(nppAutonomyLevelAtLeast("v3", "v3")).toBe(true);
  });

  /**
   * Regression guard for a specific bug that shipped twice.
   *
   * `billSponsorship` and `savingsInterestTurn` both gated a v3 feature with
   * `getNppAutonomyLevel(db) === "v3"`. Strict equality reads as "at this tier"
   * but means "at this tier and NOWHERE ABOVE IT" — so raising the world to v4
   * silently switched those features back off, one of them an entire economic
   * subsystem. Nothing about either call site looked wrong in review.
   *
   * This scans source for the shape rather than trusting the next author to
   * remember. Levels are ordered; comparisons on them must use the rank helpers.
   */
  it("has no strict-equality comparisons against an autonomy level in src", () => {
    const root = join(__dirname, "..", "..", "..");
    const files = globSync("**/*.ts", {
      cwd: root,
      ignore: ["**/*.test.ts", "**/*.test.tsx", "**/node_modules/**"],
      absolute: true,
    });

    const offenders: string[] = [];
    // e.g. `getNppAutonomyLevel(db)) === "v3"` or `autonomyLevel !== "v2"`.
    // Built from NPP_AUTONOMY_LEVELS: a hand-kept character class missed the
    // newest tier once, and a tier the regex does not cover is a tier this
    // guard silently stops policing.
    // Only the numbered tiers: comparing against "off" is the legitimate
    // "is autonomy on at all" check, since "off" is a boundary rather than a
    // tier and has nothing above it to accidentally exclude.
    const tiers = NPP_AUTONOMY_LEVELS.filter((level) => level !== "off").join("|");
    const pattern = new RegExp(
      `(?:AutonomyLevel|autonomyLevel)[^;\\n]*?[!=]==\\s*["'](?:${tiers})["']`
    );
    expect(pattern.test(`autonomyLevel === "${NPP_AUTONOMY_LEVELS.at(-1)}"`)).toBe(true);
    const isComment = (line: string) => /^\s*(?:\/\/|\/?\*)/.test(line);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const [index, line] of source.split("\n").entries()) {
        if (!isComment(line) && pattern.test(line)) {
          offenders.push(`${file.slice(root.length + 1)}:${index + 1}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
