import { describe, expect, it } from "vitest";
import { ALIGNMENT_ERAS, polesForYear } from "@/lib/constants/alignmentEras";
import { ALIGNMENT_ROSTER, existsAt } from "@/lib/constants/alignmentRoster";
import { AUTHORED_ALIGNMENT, PRESET_YEAR } from "@/lib/constants/alignmentSeeds";
import { axisFor } from "./project";
import { JOIN_SHARE, LEAVE_SHARE } from "./membershipEligibility";
import { resolveOpeningShares } from "./seedAlignment";

const COLD = ALIGNMENT_ERAS.find((e) => e.key === "cold-war")!;

describe("resolveOpeningShares — authored", () => {
  // The design's published 1953 axis values must survive the whole pipeline.
  it.each([
    ["DD", -86],
    ["YU", -28],
    ["FI", -22],
    ["SE", 12],
    ["IT", 45],
    ["TR", 52],
    ["US", 95],
  ])("reproduces %s at %i", (key, expected) => {
    const r = resolveOpeningShares({ key: key as never, preset: "1953-default" });
    expect(r.provenance).toBe("authored");
    expect(axisFor(r.shares, COLD)).toBe(expected as number);
  });
});

describe("resolveOpeningShares — derived", () => {
  it("seats a colony in its metropole's column, damped", () => {
    const fr = resolveOpeningShares({ key: "FR", preset: "1953-default" });
    const algeria = resolveOpeningShares({ key: "FA", preset: "1953-default" });
    expect(algeria.provenance).toBe("metropole");
    // 85% of France's West share: leans the same way, but less.
    expect(algeria.shares.shares.WEST!).toBeLessThan(fr.shares.shares.WEST!);
    expect(algeria.shares.shares.WEST!).toBeGreaterThan(algeria.shares.shares.EAST!);
  });

  it("leaves a newly independent state mostly unaligned", () => {
    const kenya = resolveOpeningShares({ key: "KE", preset: "1979-default" });
    expect(kenya.provenance).toBe("decolonised");
    expect(kenya.shares.nonAligned).toBeGreaterThan(30);
  });

  it("falls back to the default for an entity with no authored row and no metropole", () => {
    const r = resolveOpeningShares({ key: "VA", preset: "1991-default" });
    expect(["authored", "default"]).toContain(r.provenance);
  });
});

describe("resolveOpeningShares — invariants", () => {
  it("normalises every entity in every start", () => {
    for (const preset of Object.keys(PRESET_YEAR)) {
      const year = PRESET_YEAR[preset];
      const poles = polesForYear(year);
      for (const entry of ALIGNMENT_ROSTER) {
        if (!existsAt(entry.key, year)) continue;
        const { shares } = resolveOpeningShares({ key: entry.key, preset });
        const values = Object.values(shares.shares) as number[];
        const sum = values.reduce((a, b) => a + b, 0) + shares.nonAligned;
        expect(sum, `${entry.key} @ ${preset}`).toBeCloseTo(100, 9);
        expect(Object.keys(shares.shares).sort(), `${entry.key} @ ${preset}`).toEqual(
          [...poles].sort()
        );
        for (const v of values) {
          // The storage grid is a hundredth. Colonies land off the tenth grid
          // routinely: the metropole rule keeps 85% of its ruler's row, so a
          // ruler at 74 gives 62.9 and one at 78 gives 66.3 — and at 30% for a
          // decolonised state, 0.3 x 74 is 22.2 but 0.3 x 71 is 21.3.
          const onGrid = Math.abs(v * 100 - Math.round(v * 100)) < 1e-9;
          expect(onGrid && v >= 0 && v <= 100, `${entry.key} @ ${preset}`).toBe(true);
        }
      }
    }
  });

  it("uses the pole set of the start, and keeps non-alignment as the remainder", () => {
    const y53 = resolveOpeningShares({ key: "YU", preset: "1953-default" });
    expect(Object.keys(y53.shares.shares).sort()).toEqual(["EAST", "WEST"]);

    // Tito's Yugoslavia is the movement's anchor: by 1979 the share NEITHER
    // bloc has persuaded is larger than what either holds. That remainder IS
    // its non-alignment — there is no NAM pole to hold it.
    const y79 = resolveOpeningShares({ key: "YU", preset: "1979-default" });
    expect(y79.shares.nonAligned).toBeGreaterThan(y79.shares.shares.WEST!);
    expect(y79.shares.nonAligned).toBeGreaterThan(y79.shares.shares.EAST!);
  });

  it("reports a provenance for every present entity", () => {
    const seen = new Set<string>();
    for (const preset of Object.keys(PRESET_YEAR)) {
      for (const entry of ALIGNMENT_ROSTER) {
        if (!existsAt(entry.key, PRESET_YEAR[preset])) continue;
        seen.add(resolveOpeningShares({ key: entry.key, preset }).provenance);
      }
    }
    expect([...seen].sort()).toEqual(["authored", "decolonised", "default", "metropole"]);
  });
});

describe("non-members open below the join gate", () => {
  // Alignment lets an unplayed nation apply to a bloc it has swung toward. A
  // non-member seeded at or above JOIN_SHARE therefore applies on turn one,
  // with no play by anyone — the 1953 world opened with South Korea at 84 and
  // Cuba at 78 toward the West, so NATO grew by itself.
  const westOf = (key: string) =>
    resolveOpeningShares({ key: key as never, preset: "1953-default" }).shares.shares.WEST ?? 0;
  const eastOf = (key: string) =>
    resolveOpeningShares({ key: key as never, preset: "1953-default" }).shares.shares.EAST ?? 0;

  it("caps a pro-Western non-member under the gate", () => {
    for (const key of ["KR", "NI", "PA", "CU", "VE", "DE", "TH"]) {
      expect(westOf(key), key).toBeLessThanOrEqual(50);
      expect(westOf(key), key).toBeLessThan(JOIN_SHARE);
    }
  });

  it("leaves a bloc's own members at whatever was authored for them", () => {
    // The cap is about who APPLIES, and a member has already joined. Trimming
    // them would push a bloc's own countries toward LEAVE_SHARE — Canada would
    // drop from 84 to 50, ten points off being on its way out of NATO.
    for (const key of ["CA", "NL", "BE", "LU", "NO", "DK", "PT", "IS", "UK", "US", "FR"]) {
      expect(westOf(key), key).toBe(AUTHORED_ALIGNMENT["1953-default"]?.[key]?.[0]);
      expect(westOf(key), key).toBeGreaterThan(LEAVE_SHARE);
    }
    for (const key of ["RU", "DD", "PL", "HU", "RO", "BG", "CS", "AL"]) {
      expect(eastOf(key), key).toBe(AUTHORED_ALIGNMENT["1953-default"]?.[key]?.[1]);
      expect(eastOf(key), key).toBeGreaterThan(JOIN_SHARE);
    }
  });

  it("does not lift a member that was authored below the gate", () => {
    // Italy opens at 55 and Greece at 52 — under JOIN_SHARE, and deliberately
    // so. They are already in NATO, so the gate never applies to them; the cap
    // must not touch them in either direction.
    expect(westOf("IT")).toBe(55);
    expect(westOf("GR")).toBe(52);
  });

  it("caps each pole against its own bloc, not against both", () => {
    // A Warsaw Pact member is no less Eastern for being outside NATO.
    const ru = resolveOpeningShares({ key: "RU" as never, preset: "1953-default" }).shares;
    expect(ru.shares.EAST ?? 0).toBeGreaterThan(JOIN_SHARE);
    expect(ru.shares.WEST ?? 0).toBeLessThanOrEqual(50);
  });

  it("puts the trimmed points into non-alignment, not into the rival", () => {
    // An uncommitted country is uncommitted; handing South Korea's surplus to
    // the East would invent a lean nobody authored.
    const before = AUTHORED_ALIGNMENT["1953-default"]?.["KR"];
    const after = resolveOpeningShares({ key: "KR" as never, preset: "1953-default" }).shares;
    expect(before?.[0]).toBeGreaterThan(50); // authored well above the cap
    expect(after.shares.WEST).toBe(50);
    expect(after.shares.EAST ?? 0).toBeLessThanOrEqual(before?.[1] ?? 0);
    expect(after.nonAligned).toBeGreaterThan(0);
    expect((after.shares.WEST ?? 0) + (after.shares.EAST ?? 0) + after.nonAligned).toBe(100);
  });

  it("caps a colony that inherits an over-the-gate metropole", () => {
    // The metropole rule keeps 85% of its ruler's row, so a NATO member's
    // colonies could clear the gate on inheritance alone.
    for (const key of ["KE", "MLY", "CI"]) {
      expect(westOf(key), key).toBeLessThanOrEqual(50);
    }
  });
});
