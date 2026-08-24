import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { SettlementPlayDoc } from "@/lib/db/types/settlementPlay";
import {
  HUNDREDTHS,
  PERSONAL_MULTIPLIER_PCT,
  personalNetCapFor,
} from "@/lib/constants/settlementCrisis";

/**
 * The default personal play's magnitude, and what it buys after the quarter
 * multiplier.
 *
 * Derived from the TWO-participant pool, not from the base, so two of these sum
 * to about half the ceiling they are measured against. Deriving it from the base
 * used to put two plays at exactly the cap — 19 + 19 against a pool of 38 — so
 * the "under the cap" test passed only because the comparison is inclusive, and
 * was really measuring a rounding coincidence rather than its own name.
 */
const PERSONAL_BASE_POINTS = personalNetCapFor(2);
const PERSONAL_QUARTER = Math.round((PERSONAL_BASE_POINTS * PERSONAL_MULTIPLIER_PCT) / 100);
import { appliedPointsFor, resolvePlayBatch } from "./resolvePlays";

function play(over: Partial<SettlementPlayDoc>): SettlementPlayDoc {
  return {
    _id: new ObjectId(),
    crisisId: new ObjectId(),
    actor: "seat",
    seatId: "US",
    characterId: new ObjectId(),
    countryId: "US",
    playId: "credit",
    targetInstitutionId: "laender",
    direction: -1,
    class: "spend",
    costs: { funds: 0, capital: 0, actions: 1 },
    basePoints: 5 * HUNDREDTHS,
    appliedPoints: null,
    heatAdded: 0,
    turn: 412,
    resolvedTurn: null,
    createdAt: new Date("1953-01-01T00:00:00Z"),
    ...over,
  };
}

function personalPlay(over: Partial<SettlementPlayDoc> = {}): SettlementPlayDoc {
  return play({
    actor: "personal",
    seatId: null,
    countryId: null,
    playId: "oped",
    targetInstitutionId: "street",
    // Derived from the cap so that TWO of these stay under it whatever the
    // tempo. A frozen literal drifted over the cap when the tempo moved, and
    // the "under the cap" tests then silently measured the apportionment.
    basePoints: PERSONAL_BASE_POINTS,
    direction: 1,
    class: "personal",
    ...over,
  });
}

describe("appliedPointsFor", () => {
  it("applies the seat multiplier and the direction", () => {
    expect(appliedPointsFor(play({ seatId: "US", direction: -1 }))).toBe(-500);
    expect(appliedPointsFor(play({ seatId: "US", direction: 1 }))).toBe(500);
  });

  it("doubles a primary seat's play", () => {
    const dd = play({ seatId: "DD", direction: 1, basePoints: 8 * HUNDREDTHS });
    expect(appliedPointsFor(dd)).toBe(1600);
  });

  it("quarters a personal play", () => {
    expect(appliedPointsFor(personalPlay())).toBe(PERSONAL_QUARTER);
  });

  it("returns zero for an unknown seat rather than applying a default", () => {
    const orphan = play({ seatId: "ZZ" as never });
    expect(appliedPointsFor(orphan)).toBe(0);
  });
});

describe("resolvePlayBatch", () => {
  it("sums seat plays per institution", () => {
    const batch = resolvePlayBatch([
      play({ seatId: "US", targetInstitutionId: "laender", direction: -1 }),
      play({ seatId: "DD", targetInstitutionId: "laender", direction: 1, basePoints: 400 }),
    ]);
    // -500 from the US, +800 from the GDR at 2.0x
    expect(batch.perInstitution.get("laender")).toBe(300);
  });

  it("routes a null target to the settlement delta", () => {
    const batch = resolvePlayBatch([
      play({
        seatId: "DD",
        playId: "referendum",
        targetInstitutionId: null,
        direction: 1,
        basePoints: 5 * HUNDREDTHS,
      }),
    ]);
    expect(batch.settlementDelta).toBe(1000);
    expect(batch.perInstitution.size).toBe(0);
  });

  it("stamps every play with its applied points", () => {
    const a = play({ seatId: "UK", direction: -1, basePoints: 300 });
    const batch = resolvePlayBatch([a]);
    expect(batch.stamped).toEqual([{ id: a._id, appliedPoints: -300 }]);
  });

  it("leaves the personal tier alone when it is under the cap", () => {
    const batch = resolvePlayBatch([personalPlay(), personalPlay()]);
    expect(batch.personalApplied.get("street")).toBe(PERSONAL_QUARTER * 2);
    expect(batch.perInstitution.get("street")).toBe(PERSONAL_QUARTER * 2);
    // Comfortably under, not level with it. If these ever meet, this test
    // stops distinguishing "left alone" from "apportioned to exactly the cap".
    expect(PERSONAL_QUARTER * 2).toBeLessThan(personalNetCapFor(2));
  });

  it("scales the personal tier down to the cap when it exceeds it", () => {
    const many = Array.from({ length: 200 }, () =>
      personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: 1 })
    );
    const batch = resolvePlayBatch(many);
    expect(batch.personalRaw.get("street")).toBe(10_000);
    expect(batch.personalApplied.get("street")).toBe(personalNetCapFor(200));
    expect(batch.perInstitution.get("street")).toBe(personalNetCapFor(200));
  });

  it("caps on the NET, so opposing personal plays cancel before the cap bites", () => {
    const balanced = [
      ...Array.from({ length: 100 }, () =>
        personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: 1 })
      ),
      ...Array.from({ length: 100 }, () =>
        personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: -1 })
      ),
    ];
    const batch = resolvePlayBatch(balanced);
    expect(batch.personalApplied.get("street")).toBe(0);
  });

  it("scales a negative personal total to the cap too", () => {
    const many = Array.from({ length: 200 }, () =>
      personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: -1 })
    );
    const batch = resolvePlayBatch(many);
    expect(batch.personalApplied.get("street")).toBe(-personalNetCapFor(200));
  });

  it("does not let the personal cap touch seat plays", () => {
    const many = Array.from({ length: 200 }, () =>
      personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: 1 })
    );
    const withSeat = [
      ...many,
      play({ seatId: "RU", targetInstitutionId: "street", direction: 1, basePoints: 500 }),
    ];
    const batch = resolvePlayBatch(withSeat);
    expect(batch.perInstitution.get("street")).toBe(personalNetCapFor(200) + 500);
  });

  it("caps each institution independently", () => {
    const batch = resolvePlayBatch([
      ...Array.from({ length: 200 }, () =>
        personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: 1 })
      ),
      ...Array.from({ length: 200 }, () =>
        personalPlay({
          playId: "letter",
          targetInstitutionId: "bundestag",
          basePoints: 1 * HUNDREDTHS,
          direction: -1,
        })
      ),
    ]);
    expect(batch.personalApplied.get("street")).toBe(personalNetCapFor(200));
    expect(batch.personalApplied.get("bundestag")).toBe(-personalNetCapFor(200));
  });

  it("stamps capped personal plays with what they actually bought", () => {
    // The audit trail is the whole reason these rows are stamped rather than
    // deleted. If the institution total is capped but each row keeps its full
    // requested value, every row lies by the cap ratio.
    const many = Array.from({ length: 200 }, () =>
      personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: 1 })
    );
    const batch = resolvePlayBatch(many);
    const stampedTotal = batch.stamped.reduce((s, r) => s + r.appliedPoints, 0);

    expect(stampedTotal).toBe(batch.personalApplied.get("street"));
    expect(stampedTotal).toBe(batch.perInstitution.get("street"));
    // Derived, not frozen: the stamps must sum to exactly the cap and no row
    // may be stamped above the 50 it asked for, whatever the cap is tuned to.
    expect(stampedTotal).toBe(personalNetCapFor(200));
    for (const row of batch.stamped) {
      expect(row.appliedPoints).toBeLessThanOrEqual(50);
      expect(row.appliedPoints).toBeGreaterThanOrEqual(0);
    }
  });

  it("still moves the institution when the tier is too crowded to divide", () => {
    // Independent per-row rounding used to lose the entire cap here: each of a
    // thousand rows is owed a fraction of a hundredth, each rounds to zero, and
    // the public moves the board by nothing. The cap is a ceiling on the
    // public's influence, not a way to delete it.
    const crowd = Array.from({ length: 1_000 }, () =>
      personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: 1 })
    );
    const batch = resolvePlayBatch(crowd);
    expect(batch.perInstitution.get("street")).toBe(personalNetCapFor(1_000));
    expect(batch.stamped.reduce((sum, r) => sum + r.appliedPoints, 0)).toBe(
      personalNetCapFor(1_000)
    );
  });

  it("apportions a crowded NEGATIVE tier to the cap as well", () => {
    const crowd = Array.from({ length: 1_000 }, () =>
      personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: -1 })
    );
    const batch = resolvePlayBatch(crowd);
    expect(batch.perInstitution.get("street")).toBe(-personalNetCapFor(1_000));
    for (const row of batch.stamped) expect(row.appliedPoints).toBeLessThanOrEqual(0);
  });

  it("keeps uncapped personal stamps at full value", () => {
    const batch = resolvePlayBatch([personalPlay(), personalPlay()]);
    expect(batch.stamped.map((s) => s.appliedPoints)).toEqual([PERSONAL_QUARTER, PERSONAL_QUARTER]);
  });

  it("stamps seat plays at full value regardless of the personal cap", () => {
    const seat = play({
      seatId: "RU",
      targetInstitutionId: "street",
      direction: 1,
      basePoints: 500,
    });
    const batch = resolvePlayBatch([
      ...Array.from({ length: 200 }, () =>
        personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: 1 })
      ),
      seat,
    ]);
    const seatStamp = batch.stamped.find((s) => s.id.equals(seat._id));
    expect(seatStamp?.appliedPoints).toBe(500);
  });

  it("totals the heat added by coercive plays", () => {
    const batch = resolvePlayBatch([
      play({ heatAdded: 1 }),
      play({ heatAdded: 1 }),
      play({ heatAdded: 0 }),
    ]);
    expect(batch.heatAdded).toBe(2);
  });

  it("handles an empty batch", () => {
    const batch = resolvePlayBatch([]);
    expect(batch.perInstitution.size).toBe(0);
    expect(batch.settlementDelta).toBe(0);
    expect(batch.heatAdded).toBe(0);
    expect(batch.stamped).toEqual([]);
  });

  it("gives a bigger crowd a bigger pool", () => {
    const crowd = (n: number) =>
      Array.from({ length: n }, () =>
        personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: 1 })
      );

    expect(resolvePlayBatch(crowd(8)).personalApplied.get("street")).toBe(personalNetCapFor(8));
    expect(resolvePlayBatch(crowd(59)).personalApplied.get("street")).toBe(personalNetCapFor(59));
  });

  it("counts DISTINCT CHARACTERS, not plays, when sizing the pool", () => {
    // One character playing two levers on the street must not inflate the
    // ceiling they are then measured against. Counting rows would let the
    // floor raise its own roof.
    const one = new ObjectId();
    const batch = resolvePlayBatch([
      personalPlay({ characterId: one, playId: "oped", basePoints: 40 * HUNDREDTHS }),
      personalPlay({ characterId: one, playId: "rally", basePoints: 40 * HUNDREDTHS }),
    ]);
    expect(batch.personalApplied.get("street")).toBe(personalNetCapFor(1));
  });

  it("sizes each institution's pool from its own crowd", () => {
    const street = Array.from({ length: 40 }, () =>
      personalPlay({ playId: "rally", basePoints: 2 * HUNDREDTHS, direction: 1 })
    );
    const bundestag = Array.from({ length: 4 }, () =>
      personalPlay({
        playId: "letter",
        targetInstitutionId: "bundestag",
        basePoints: 40 * HUNDREDTHS,
        direction: 1,
      })
    );
    const batch = resolvePlayBatch([...street, ...bundestag]);
    // Forty people on the street must not raise the Bundestag's ceiling.
    expect(batch.personalApplied.get("street")).toBe(personalNetCapFor(40));
    expect(batch.personalApplied.get("bundestag")).toBe(personalNetCapFor(4));
  });
});
