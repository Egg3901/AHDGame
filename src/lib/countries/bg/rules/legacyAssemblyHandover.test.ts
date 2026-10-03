import { describe, expect, it } from "vitest";
import { latestBgOrdinaryCohort, hasValidBgOrdinaryCustody } from "./legacyAssemblyHandover";
import { BG_ORDINARY_ASSEMBLY_SEATS } from "./assemblyTransition";
const ids = Object.keys(BG_ORDINARY_ASSEMBLY_SEATS);
const rows = (cycle: number) =>
  Object.entries(BG_ORDINARY_ASSEMBLY_SEATS).map(([state, totalSeats]) => ({
    state,
    totalSeats,
    cycle,
  }));
describe("Bulgarian legacy ordinary handover proof", () => {
  it("recognizes a later complete cohort and waits for the correct calendar", () => {
    expect(latestBgOrdinaryCohort(41, ids, rows(2))?.cycle).toBe(2);
    expect(latestBgOrdinaryCohort(40, ids, rows(2))).toBeNull();
    expect(latestBgOrdinaryCohort(41, ids, [...rows(1), ...rows(2)])?.cycle).toBe(2);
  });
  it("does not borrow an earlier complete result to complete a later partial one", () => {
    expect(latestBgOrdinaryCohort(41, ids, [...rows(1), rows(2)[0]])).toBeNull();
    expect(latestBgOrdinaryCohort(41, ids, [...rows(1), rows(1)[0]])).toBeNull();
    expect(
      latestBgOrdinaryCohort(
        41,
        ids,
        rows(1).map((row) => ({ ...row, totalSeats: 80 }))
      )
    ).toBeNull();
  });
  it("permits valid vacant mandates but refuses overflow and duplicate player custody", () => {
    const regionId = ids[0];
    expect(hasValidBgOrdinaryCustody([], BG_ORDINARY_ASSEMBLY_SEATS)).toBe(true);
    expect(
      hasValidBgOrdinaryCustody(
        [{ regionId, playerId: "player", seatsHeld: 1 }],
        BG_ORDINARY_ASSEMBLY_SEATS
      )
    ).toBe(true);
    expect(
      hasValidBgOrdinaryCustody([{ regionId, seatsHeld: 500 }], BG_ORDINARY_ASSEMBLY_SEATS)
    ).toBe(false);
    expect(
      hasValidBgOrdinaryCustody(
        [{ regionId, playerId: "player", seatsHeld: 2 }],
        BG_ORDINARY_ASSEMBLY_SEATS
      )
    ).toBe(false);
    expect(
      hasValidBgOrdinaryCustody(
        [
          { regionId, playerId: "player" },
          { regionId: ids[1], playerId: "player" },
        ],
        BG_ORDINARY_ASSEMBLY_SEATS
      )
    ).toBe(false);
    expect(
      hasValidBgOrdinaryCustody([{ regionId: "missing", seatsHeld: 1 }], BG_ORDINARY_ASSEMBLY_SEATS)
    ).toBe(false);
  });
});
