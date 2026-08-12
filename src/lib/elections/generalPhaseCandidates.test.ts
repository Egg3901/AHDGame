import { describe, it, expect } from "vitest";
import { selectGeneralPhaseDisplayCandidates } from "./generalPhaseCandidates";

type Row = { id: string; party: string; primaryScore: number; isYou?: boolean };

const row = (id: string, party: string, primaryScore: number, isYou = false): Row => ({
  id,
  party,
  primaryScore,
  isYou,
});

describe("selectGeneralPhaseDisplayCandidates", () => {
  // The bug this guards: US House advances 3 per party under the districted
  // redistricting system, but every display surface capped at 1 because the
  // `redistrictingEnabled` argument was omitted at the call site. Players saw
  // themselves as their party's sole nominee, then lost districts to the
  // co-nominees who had been advancing invisibly all along.
  it("keeps all three US House nominees per party when the cap is 3", () => {
    const enriched = [
      row("d1", "1", 90),
      row("d2", "1", 80),
      row("d3", "1", 70),
      row("r1", "2", 88),
      row("r2", "2", 60),
      row("r3", "2", 50),
    ];

    const result = selectGeneralPhaseDisplayCandidates(enriched, 3);

    // Ordering is global primary-score descending, not grouped by party:
    // d1(90) r1(88) d2(80) d3(70) r2(60) r3(50).
    expect(result.map((c) => c.id)).toEqual(["d1", "r1", "d2", "d3", "r2", "r3"]);
  });

  it("keeps exactly one nominee per party when the cap is 1", () => {
    const enriched = [row("d1", "1", 90), row("d2", "1", 80), row("r1", "2", 88)];

    const result = selectGeneralPhaseDisplayCandidates(enriched, 1);

    expect(result.map((c) => c.id)).toEqual(["d1", "r1"]);
  });

  it("drops candidates beyond the cap, keeping the highest primary scores", () => {
    const enriched = [
      row("low", "1", 10),
      row("high", "1", 99),
      row("mid", "1", 50),
      row("lowest", "1", 1),
    ];

    const result = selectGeneralPhaseDisplayCandidates(enriched, 3);

    expect(result.map((c) => c.id)).toEqual(["high", "mid", "low"]);
  });

  it("keeps a party that fielded fewer candidates than the cap intact", () => {
    const enriched = [row("d1", "1", 90), row("r1", "2", 88), row("r2", "2", 60)];

    const result = selectGeneralPhaseDisplayCandidates(enriched, 3);

    expect(result.map((c) => c.id)).toEqual(["d1", "r1", "r2"]);
  });

  // A player who lost their primary must still see their own row on the race
  // page — otherwise their candidacy silently vanishes from their own view.
  it("always includes the viewer's own candidate even when they placed below the cap", () => {
    const enriched = [
      row("d1", "1", 90),
      row("d2", "1", 80),
      row("me", "1", 5, true),
      row("r1", "2", 88),
    ];

    const result = selectGeneralPhaseDisplayCandidates(enriched, 2);

    expect(result.map((c) => c.id)).toEqual(["d1", "r1", "d2", "me"]);
  });

  it("does not duplicate the viewer's candidate when they already made the cut", () => {
    const enriched = [row("me", "1", 90, true), row("d2", "1", 80), row("r1", "2", 88)];

    const result = selectGeneralPhaseDisplayCandidates(enriched, 3);

    expect(result.map((c) => c.id)).toEqual(["me", "r1", "d2"]);
    expect(result.filter((c) => c.id === "me")).toHaveLength(1);
  });

  it("returns an empty list for an empty field", () => {
    expect(selectGeneralPhaseDisplayCandidates([] as Row[], 3)).toEqual([]);
  });

  it("does not mutate the input array's order", () => {
    const enriched = [row("d2", "1", 80), row("d1", "1", 90)];
    const snapshot = enriched.map((c) => c.id);

    selectGeneralPhaseDisplayCandidates(enriched, 1);

    expect(enriched.map((c) => c.id)).toEqual(snapshot);
  });
});
