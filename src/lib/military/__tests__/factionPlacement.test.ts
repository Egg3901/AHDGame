import { describe, it, expect } from "vitest";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { sideOf } from "../occupation";
import { belligerentSideOf } from "../conflictVisibility";
import { mergeOffensives } from "../coalition";

/**
 * A proxy war's two sides are FACTIONS, not member countries — the rosters start
 * empty and each side is named by its `factionEntity`.
 */
const vietnam = {
  _id: "cw1",
  sideA: { label: "RVN", countries: [], kind: "generated", backer: "west", factionEntity: "SVN" },
  sideB: { label: "DRV", countries: [], kind: "generated", backer: "east", factionEntity: "NVN" },
} as unknown as ConflictDoc;

describe("faction placement", () => {
  it("resolves a faction entity through BOTH resolvers", () => {
    expect(belligerentSideOf(vietnam, "NVN")).toBe("B");
    expect(sideOf(vietnam, "NVN", {})).toBe("B");
    expect(belligerentSideOf(vietnam, "SVN")).toBe("A");
    expect(sideOf(vietnam, "SVN", {})).toBe("A");
  });

  it("still returns null for an unrelated non-aligned entity", () => {
    // sideOf is the PERMISSIVE resolver and two fog consumers depend on it. The
    // clause must be exact-match on factionEntity, never a widened bloc guess.
    expect(sideOf(vietnam, "LAO", {})).toBeNull();
    expect(belligerentSideOf(vietnam, "LAO")).toBeNull();
  });

  it("builds an offensive with a real side, not null", () => {
    // The decisive assertion. A null side skips joinSide AND applyOccupation together,
    // so control never moves and every downstream feature is inert — silently, with a
    // green suite.
    const offs = mergeOffensives(
      vietnam,
      [
        {
          _id: "d1",
          declarerCountry: "US",
          targetCountry: "NVN",
          theaterId: "cw1",
          declaredTurn: 9,
        },
      ] as never,
      10,
      // The US is West-backed, so side A resolves through the backer fallback; the
      // TARGET is what needs the faction clause.
      { US: "west" }
    );

    expect(offs).toHaveLength(1);
    expect(offs[0]!.side).not.toBeNull();
    expect(offs[0]!.side).toBe("A");
    expect(offs[0]!.enemySide).toBe("B");
  });
});
