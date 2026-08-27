import { describe, it, expect } from "vitest";
import type { ConflictSide } from "@/lib/db/types/conflict";
import {
  sideOf,
  initialControl,
  shareOf,
  occupationShift,
  frontProgress,
  progressForSide,
  derivedSupply,
  derivedSupplies,
  occupationOf,
} from "./occupation";

const sideA = (over: Partial<ConflictSide> = {}): ConflictSide => ({
  label: "NATO",
  countries: ["US"],
  kind: "coalition",
  backer: "west",
  ...over,
});
const sideB = (over: Partial<ConflictSide> = {}): ConflictSide => ({
  label: "Warsaw Pact",
  countries: ["RU"],
  kind: "coalition",
  backer: "east",
  ...over,
});

// The bloc roll, as `loadMilitaryBlocs` would return it from live membership.
const BLOCS = { US: "west", UK: "west", RU: "east", DD: "east", PL: "east" } as const;

describe("sideOf", () => {
  it("resolves an explicit member of side A", () => {
    expect(sideOf({ sideA: sideA(), sideB: sideB() }, "US", BLOCS)).toBe("A");
  });

  it("resolves an explicit member of side B", () => {
    expect(sideOf({ sideA: sideA(), sideB: sideB() }, "RU", BLOCS)).toBe("B");
  });

  it("falls back to a unique bloc match for an outsider", () => {
    // UK is West and not on either roster; only side A is West-backed.
    expect(sideOf({ sideA: sideA(), sideB: sideB() }, "UK", BLOCS)).toBe("A");
  });

  // Regression: the fallback read a static 9-entry table whose unknown-country default
  // was the US row, so a Warsaw Pact member absent from it — Poland, Czechoslovakia,
  // Hungary, Bulgaria, Romania — resolved "west" and was enrolled into NATO.
  it("places an off-roster eastern nation on the east-backed side", () => {
    expect(sideOf({ sideA: sideA(), sideB: sideB() }, "PL", BLOCS)).toBe("B");
  });

  // Non-aligned matches no backer, so a neutral is placed on neither side and the
  // caller's existing "fights but moves no ground" path handles it.
  it("returns null for a non-aligned outsider", () => {
    expect(sideOf({ sideA: sideA(), sideB: sideB() }, "SE", BLOCS)).toBeNull();
  });

  it("returns null when the bloc match is ambiguous", () => {
    const both = { sideA: sideA({ backer: "west" }), sideB: sideB({ backer: "west" }) };
    expect(sideOf(both, "UK", BLOCS)).toBeNull();
  });

  it("returns null when no side is backed at all", () => {
    const neither = {
      sideA: sideA({ countries: [], backer: undefined }),
      sideB: sideB({ countries: [], backer: undefined }),
    };
    expect(sideOf(neither, "UK", BLOCS)).toBeNull();
  });

  it("prefers explicit membership over the bloc fallback", () => {
    // US listed on the EAST-backed side B: membership wins over its own bloc.
    const flipped = { sideA: sideA({ countries: [] }), sideB: sideB({ countries: ["US"] }) };
    expect(sideOf(flipped, "US", BLOCS)).toBe("B");
  });
});

describe("initialControl", () => {
  it("starts at 0 when the host defends its own soil on side A", () => {
    expect(initialControl("US", sideA({ countries: ["US"] }), sideB())).toBe(0);
  });

  it("starts at 100 when the host is on side B", () => {
    expect(initialControl("RU", sideA(), sideB({ countries: ["RU"] }))).toBe(100);
  });

  it("starts split when the host belongs to neither side", () => {
    expect(initialControl("TR", sideA(), sideB())).toBe(50);
  });
});

describe("shareOf", () => {
  it("reads control directly as side B's share", () => {
    expect(shareOf(75, "B")).toBeCloseTo(0.75);
  });

  it("reads the complement as side A's share", () => {
    expect(shareOf(75, "A")).toBeCloseTo(0.25);
  });
});

describe("occupationShift", () => {
  const base = { control: 50, loserRetreated: false };

  it("moves the full step toward B on a decisive win for B", () => {
    expect(occupationShift({ ...base, winner: "B", margin: 45 })).toBeCloseTo(55);
  });

  it("moves toward A on a decisive win for A", () => {
    expect(occupationShift({ ...base, winner: "A", margin: 45 })).toBeCloseTo(45);
  });

  it("caps the step for a margin beyond decisive", () => {
    expect(occupationShift({ ...base, winner: "B", margin: 400 })).toBeCloseTo(55);
  });

  it("scales the step down for a narrow win", () => {
    // 5/45 of the 5-point step.
    expect(occupationShift({ ...base, winner: "B", margin: 5 })).toBeCloseTo(50 + (5 / 45) * 5);
  });

  it("yields less ground when the loser broke off", () => {
    expect(occupationShift({ ...base, winner: "B", margin: 45, loserRetreated: true })).toBeCloseTo(
      50 + 5 * 0.7
    );
  });

  it("halves the step once the winner is deep in enemy territory", () => {
    // B already holds 80% (>= the 0.75 deep-push depth).
    expect(
      occupationShift({ control: 80, winner: "B", margin: 45, loserRetreated: false })
    ).toBeCloseTo(82.5);
  });

  it("does not apply the deep-push drag to the side pushing back", () => {
    // B holds 80%, but A is the winner here and A's share is only 0.2.
    expect(
      occupationShift({ control: 80, winner: "A", margin: 45, loserRetreated: false })
    ).toBeCloseTo(75);
  });

  it("clamps at the side B pole", () => {
    expect(occupationShift({ control: 99, winner: "B", margin: 45, loserRetreated: false })).toBe(
      100
    );
  });

  it("clamps at the side A pole", () => {
    expect(occupationShift({ control: 1, winner: "A", margin: 45, loserRetreated: false })).toBe(0);
  });

  it("treats a negative margin by magnitude", () => {
    // The caller passes the raw margin; a defensive win arrives negative.
    expect(occupationShift({ ...base, winner: "A", margin: -45 })).toBeCloseTo(45);
  });
});

describe("derivedSupply", () => {
  it("leaves a side at its baseline when the front has not moved", () => {
    expect(derivedSupply(65, 0)).toBe(65);
  });

  it("penalises a fully compressed side by the compression penalty", () => {
    expect(derivedSupply(65, -1)).toBe(25);
  });

  it("penalises a fully overextended side by the smaller overextension penalty", () => {
    expect(derivedSupply(65, 1)).toBe(50);
  });

  it("floors at the minimum supply", () => {
    expect(derivedSupply(20, -1)).toBe(10);
  });

  it("caps at 100", () => {
    expect(derivedSupply(100, 0)).toBe(100);
  });
});

describe("derivedSupplies", () => {
  it("keeps both sides at baseline at the starting line of an interstate war", () => {
    const c = {
      control: 0,
      controlStart: 0,
      supplyA: 65,
      supplyB: 55,
      supplyBaseA: 65,
      supplyBaseB: 55,
    };
    expect(derivedSupplies(c)).toEqual({ supplyA: 65, supplyB: 55 });
  });

  it("keeps both sides at baseline at the starting line of a split conflict", () => {
    const c = {
      control: 50,
      controlStart: 50,
      supplyA: 65,
      supplyB: 55,
      supplyBaseA: 65,
      supplyBaseB: 55,
    };
    expect(derivedSupplies(c)).toEqual({ supplyA: 65, supplyB: 55 });
  });

  it("compresses the loser and overextends the winner as the front moves", () => {
    // B has taken half the track: gainB = 0.5, gainA = −0.5.
    // A: 65 − 40×0.5 = 45.   B: round(55 − 15×0.5) = round(47.5) = 48.
    const c = {
      control: 50,
      controlStart: 0,
      supplyA: 65,
      supplyB: 55,
      supplyBaseA: 65,
      supplyBaseB: 55,
    };
    expect(derivedSupplies(c)).toEqual({ supplyA: 45, supplyB: 48 });
  });

  it("recovers supply when the front swings back", () => {
    const pushed = {
      control: 40,
      controlStart: 0,
      supplyA: 65,
      supplyB: 55,
      supplyBaseA: 65,
      supplyBaseB: 55,
    };
    const recovered = {
      control: 10,
      controlStart: 0,
      supplyA: 65,
      supplyB: 55,
      supplyBaseA: 65,
      supplyBaseB: 55,
    };
    expect(derivedSupplies(recovered).supplyA).toBeGreaterThan(derivedSupplies(pushed).supplyA);
  });

  it("falls back to the live supplies and a 50 start for a legacy conflict", () => {
    const legacy = { control: 50, supplyA: 65, supplyB: 55 };
    expect(derivedSupplies(legacy)).toEqual({ supplyA: 65, supplyB: 55 });
  });
});

describe("occupationOf", () => {
  it("names side B as the occupier when the host defends on side A", () => {
    const c = {
      hostCountry: "US" as const,
      control: 30,
      sideA: sideA({ countries: ["US"] }),
      sideB: sideB(),
    };
    expect(occupationOf(c)).toEqual({ host: "US", occupier: "B", pctA: 70, pctB: 30 });
  });

  it("names side A as the occupier when the host is on side B", () => {
    const c = {
      hostCountry: "RU" as const,
      control: 70,
      sideA: sideA(),
      sideB: sideB({ countries: ["RU"] }),
    };
    expect(occupationOf(c)).toEqual({ host: "RU", occupier: "A", pctA: 30, pctB: 70 });
  });

  it("names no occupier when the host belongs to neither side", () => {
    const c = { hostCountry: "TR" as const, control: 40, sideA: sideA(), sideB: sideB() };
    expect(occupationOf(c)).toEqual({ host: "TR", occupier: null, pctA: 60, pctB: 40 });
  });
});

describe("frontProgress", () => {
  it("is zero at the starting line", () => {
    expect(frontProgress(100, 100)).toBe(0);
    expect(frontProgress(50, 50)).toBe(0);
  });

  // An interstate war OPENS with the defender holding all its own soil. Reading depth
  // off the absolute share would call every invasion "deep" before the first shot.
  it("is barely off zero one step into an invasion", () => {
    expect(frontProgress(95, 100)).toBeCloseTo(0.05);
  });

  it("reaches one at the far pole", () => {
    expect(frontProgress(0, 100)).toBe(1);
    expect(frontProgress(100, 0)).toBe(1);
  });

  it("measures against the nearer pole for a split start", () => {
    expect(frontProgress(20, 50)).toBeCloseTo(0.6);
    expect(frontProgress(90, 50)).toBeCloseTo(0.8);
  });

  it("treats a front that swung back past its start as fresh progress the other way", () => {
    expect(frontProgress(60, 50)).toBeCloseTo(0.2);
  });
});

describe("a non-playable host", () => {
  it("returns 50 when the host is on neither side", () => {
    // SVN is a world entity, not a CountryId -- a proxy war's host is not a belligerent.
    expect(initialControl("SVN", sideA(), sideB())).toBe(50);
  });

  it("reports no occupier for a host on neither side", () => {
    const view = occupationOf({
      hostCountry: "SVN",
      control: 40,
      sideA: sideA(),
      sideB: sideB(),
    });
    expect(view.host).toBe("SVN");
    expect(view.occupier).toBeNull();
    expect(view.pctA).toBe(60);
    expect(view.pctB).toBe(40);
  });
});

describe("progressForSide", () => {
  it("reads a push toward the enemy pole as progress for the pusher", () => {
    // Side A wins as control falls toward 0.
    expect(progressForSide("A", 25, 100)).toBeCloseTo(0.75);
    // Side B wins as it rises toward 100.
    expect(progressForSide("B", 75, 0)).toBeCloseTo(0.75);
  });

  it("reads zero for the side the line moved AGAINST", () => {
    // `frontProgress` is direction-agnostic, which is right for "how deep is this
    // war" and wrong for "am I winning". A losing side must never read as having
    // made progress toward anything.
    expect(progressForSide("B", 25, 100)).toBe(0);
    expect(progressForSide("A", 75, 0)).toBe(0);
  });

  it("reads zero for both sides on a front that has not moved", () => {
    expect(progressForSide("A", 50, 50)).toBe(0);
    expect(progressForSide("B", 50, 50)).toBe(0);
  });

  it("reaches 1 only at the pole", () => {
    expect(progressForSide("A", 0, 100)).toBeCloseTo(1);
    expect(progressForSide("B", 100, 0)).toBeCloseTo(1);
  });

  it("measures from the STARTING line, not from the middle of the track", () => {
    // An interstate war opens with the defender holding all of its own soil, so an
    // absolute-share reading would call every invasion deep before the first shot.
    // Half the remaining ground taken is half the progress, wherever it started.
    expect(progressForSide("A", 50, 100)).toBeCloseTo(0.5);
    expect(progressForSide("A", 25, 50)).toBeCloseTo(0.5);
  });
});
