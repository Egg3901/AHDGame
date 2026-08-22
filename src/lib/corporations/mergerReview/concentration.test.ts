import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { CorporationType } from "@/lib/constants/corporations";
import { computeMergerConcentration } from "./concentration";

vi.mock("../corpMarketShare", () => ({ loadIndustryBasis: vi.fn() }));

const ACQUIRER = new ObjectId();
const TARGET = new ObjectId();

/** One industry's rollup, as `loadIndustryBasis` returns it. */
function basis(acquirerShare: number, targetShare: number, market = 1_000) {
  return {
    basisMarket: market,
    basisByCorp: new Map<string, number>([
      [ACQUIRER.toString(), acquirerShare],
      [TARGET.toString(), targetShare],
    ]),
  };
}

async function run(
  sectorTypes: CorporationType[],
  byType: Map<CorporationType, ReturnType<typeof basis>>
) {
  const db: MockDb = createMockDb();
  db.collection("corporateSectors");
  db.collectionMocks.corporateSectors.find.mockReturnValue({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(sectorTypes.map((sectorType) => ({ sectorType }))),
  });
  const { loadIndustryBasis } = await import("../corpMarketShare");
  vi.mocked(loadIndustryBasis).mockResolvedValue(
    byType as unknown as Awaited<ReturnType<typeof loadIndustryBasis>>
  );
  return computeMergerConcentration(
    db as unknown as Db,
    { _id: ACQUIRER },
    { _id: TARGET, countryId: "US" },
    true
  );
}

describe("computeMergerConcentration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports an industry both firms hold", () => {
    // The only case where a merger actually concentrates anything.
    return run(
      ["chemical_industries"],
      new Map([["chemical_industries" as CorporationType, basis(300, 200)]])
    ).then((result) => {
      expect(result.overlaps).toHaveLength(1);
      expect(result.leadSectorType).toBe("chemical_industries");
      expect(result.combinedSharePercent).toBe(50);
    });
  });

  /**
   * Ticket #1163: a target holding only chemical sectors triggered an
   * extraction warning, because the acquirer already led extraction. The deal
   * changes nothing in extraction — the acquirer's share there is identical
   * before and after.
   */
  it("ignores an industry only the ACQUIRER operates in", async () => {
    const result = await run(
      ["chemical_industries", "extraction"],
      new Map<CorporationType, ReturnType<typeof basis>>([
        ["chemical_industries" as CorporationType, basis(100, 100)],
        // Acquirer dominates extraction; target holds none of it.
        ["extraction" as CorporationType, basis(900, 0)],
      ])
    );
    expect(result.overlaps.map((o) => o.sectorType)).toEqual(["chemical_industries"]);
    expect(result.leadSectorType).toBe("chemical_industries");
  });

  it("ignores an industry only the TARGET operates in", async () => {
    // The target's share simply changes owner; nothing is combined.
    const result = await run(
      ["chemical_industries", "extraction"],
      new Map<CorporationType, ReturnType<typeof basis>>([
        ["chemical_industries" as CorporationType, basis(100, 100)],
        ["extraction" as CorporationType, basis(0, 900)],
      ])
    );
    expect(result.overlaps.map((o) => o.sectorType)).toEqual(["chemical_industries"]);
  });

  it("returns nothing to refer when the two firms share no industry", async () => {
    const result = await run(
      ["chemical_industries", "extraction"],
      new Map<CorporationType, ReturnType<typeof basis>>([
        ["chemical_industries" as CorporationType, basis(0, 500)],
        ["extraction" as CorporationType, basis(900, 0)],
      ])
    );
    expect(result.overlaps).toEqual([]);
    expect(result.leadSectorType).toBeNull();
    expect(result.combinedSharePercent).toBe(0);
  });

  it("ranks the worst overlap first", async () => {
    const result = await run(
      ["chemical_industries", "manufacturing"],
      new Map<CorporationType, ReturnType<typeof basis>>([
        ["chemical_industries" as CorporationType, basis(100, 100)],
        ["manufacturing" as CorporationType, basis(400, 400)],
      ])
    );
    expect(result.leadSectorType).toBe("manufacturing");
    expect(result.combinedSharePercent).toBe(80);
  });

  it("skips an industry with no market to divide by", async () => {
    const result = await run(
      ["chemical_industries"],
      new Map([["chemical_industries" as CorporationType, basis(100, 100, 0)]])
    );
    expect(result.overlaps).toEqual([]);
  });
});
