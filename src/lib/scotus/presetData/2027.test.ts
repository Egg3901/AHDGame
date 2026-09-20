import { describe, expect, it } from "vitest";
import { getScotusPresetSeed } from ".";
import { SCOTUS_2027_DEFAULT_SEED } from "./2027";

const EXPECTED_JUSTICES = [
  "John Roberts",
  "Clarence Thomas",
  "Amy Coney Barrett",
  "Ketanji Brown Jackson",
  "Samuel Alito",
  "Sonia Sotomayor",
  "Elena Kagan",
  "Neil Gorsuch",
  "Brett Kavanaugh",
];

describe("SCOTUS_2027_DEFAULT_SEED", () => {
  it("dispatches explicitly for 2027-default", () => {
    expect(getScotusPresetSeed("2027-default")).toBe(SCOTUS_2027_DEFAULT_SEED);
  });

  it("carries the reviewed current bench into the 2027 fallback with no vacancies", () => {
    expect(SCOTUS_2027_DEFAULT_SEED.seats.map((seat) => seat.seatNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(SCOTUS_2027_DEFAULT_SEED.seats.map((seat) => seat.historicalOccupants[0]?.name)).toEqual(
      EXPECTED_JUSTICES
    );
    expect(
      SCOTUS_2027_DEFAULT_SEED.seats.filter((seat) => seat.historicalOccupants.length === 0)
    ).toHaveLength(0);
    expect(
      new Set(
        SCOTUS_2027_DEFAULT_SEED.seats.flatMap((seat) =>
          seat.historicalOccupants.map((occupant) => occupant.key)
        )
      ).size
    ).toBe(9);
  });

  it("uses an explicit reviewed procedural-only docket fallback", () => {
    expect(SCOTUS_2027_DEFAULT_SEED.docket).toEqual([]);
    expect(SCOTUS_2027_DEFAULT_SEED.provenance?.roster).toMatchObject({
      mode: "reviewed-current-roster-fallback",
      asOf: "2026-09-20",
      projectedFor: "2027-01-01",
    });
    expect(SCOTUS_2027_DEFAULT_SEED.provenance?.docket).toMatchObject({
      mode: "procedural-only-fallback",
      reviewedAt: "2026-09-20",
    });
  });
});
