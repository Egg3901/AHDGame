import { describe, expect, it } from "vitest";
import { bgNationalOrdinaryQuotas } from "./nationalOrdinaryAllocation";

const allocate = (
  partyVotes: Record<string, number>,
  totalValidVotes: number,
  independentSeats = 0,
  totalSeats = 240
) => bgNationalOrdinaryQuotas({ partyVotes, totalValidVotes, independentSeats, totalSeats });

describe("Bulgarian national-first ordinary Assembly allocation", () => {
  it("reproduces the final1991 national mandates from the IPU published table", () => {
    // https://data.ipu.org/election-summary/PDF/BULGARIA_1991_E.PDF page3.
    const result = allocate(
      {
        UDF: 1_903_567,
        BSP: 1_836_050,
        MRF: 418_168,
        BAPU: 214_052,
        BAPU_NP: 190_454,
        UDF_Centre: 177_295,
        UDF_Liberals: 155_902,
      },
      5_540_837
    );
    expect(result.partySeats).toEqual({
      BAPU: 0,
      BAPU_NP: 0,
      BSP: 106,
      MRF: 24,
      UDF: 110,
      UDF_Centre: 0,
      UDF_Liberals: 0,
    });
    expect(result.unallocatedSeats).toBe(0);
  });
  it("keeps exactly4percent eligible against all valid votes including independents", () => {
    expect(allocate({ A: 400, B: 399, C: 8_201 }, 10_000).eligibleParties).toEqual(["A", "C"]);
  });
  it("removes independent mandates before allocating party mandates", () => {
    const result = allocate({ A: 4_000, B: 4_000 }, 10_000, 2, 10);
    expect(result.partySeats).toEqual({ A: 4, B: 4 });
    expect(result.independentSeats).toBe(2);
  });
  it("keeps unallocated mandates visible when every party misses the threshold", () => {
    expect(allocate({ A: 399, B: 399 }, 10_000)).toMatchObject({
      partySeats: { A: 0, B: 0 },
      unallocatedSeats: 240,
    });
  });
  it("is stable under input order and breaks exact quotient ties by votes then identifier", () => {
    expect(allocate({ Z: 100, A: 100 }, 200, 0, 3).partySeats).toEqual({ A: 2, Z: 1 });
    expect(allocate({ A: 100, Z: 100 }, 200, 0, 3)).toEqual(
      allocate({ Z: 100, A: 100 }, 200, 0, 3)
    );
  });
  it("does not lose integer precision at large lawful vote counts", () => {
    expect(
      allocate({ A: Number.MAX_SAFE_INTEGER - 1 }, Number.MAX_SAFE_INTEGER, 0, 3).partySeats.A
    ).toBe(3);
  });
  it.each([
    [{ A: -1 }, 100, 0],
    [{ A: 0.5 }, 100, 0],
    [{ A: 101 }, 100, 0],
    [{ independent: 1 }, 100, 0],
    [{ A: 100 }, 0, 0],
    [{ A: 100 }, 100, 241],
  ] as const)("rejects invalid accounting inputs %j", (votes, total, independentSeats) => {
    expect(() => allocate(votes, total, independentSeats)).toThrow();
  });
});
