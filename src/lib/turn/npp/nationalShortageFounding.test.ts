import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/nppAutonomy/v3/finance/nppFoundCorporation", () => ({
  nppFoundCorporation: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/nppAutonomy/v3/finance/nppEconomicAccount", () => ({
  nppHomeFxRate: vi.fn(async () => 2),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/economy/queries/privateEnterpriseGate", () => ({
  loadPrivateEnterpriseBlockedCountries: vi.fn(async () => new Set(["DD"])),
}));

import { nppFoundCorporation } from "@/lib/nppAutonomy/v3/finance/nppFoundCorporation";
import { foundingStarterUnits } from "@/lib/corporations/foundingPlant";
import { ESSENTIAL_SHORTAGE_SCORE } from "@/lib/turn/npp/marketSignals";
import {
  foundNppNationalShortageCorporations,
  shouldFoundForNationalShortage,
} from "./nationalShortageFounding";

const base = {
  countryId: "RU" as const,
  priceRatio: 3.3,
  fittingPools: 22,
  laneSectors: 0,
  blocked: false,
};

describe("shouldFoundForNationalShortage", () => {
  it("founds in a short country with an empty lane and room for a plant", () => {
    expect(shouldFoundForNationalShortage(base)).toBe(true);
  });
  it("refuses a command economy", () => {
    expect(shouldFoundForNationalShortage({ ...base, blocked: true })).toBe(false);
  });
  it("refuses a country where the lane already runs", () => {
    expect(shouldFoundForNationalShortage({ ...base, laneSectors: 7 })).toBe(false);
  });
  it("refuses a lane below the essential shortage score", () => {
    expect(
      shouldFoundForNationalShortage({ ...base, priceRatio: ESSENTIAL_SHORTAGE_SCORE - 0.01 })
    ).toBe(false);
    expect(shouldFoundForNationalShortage({ ...base, priceRatio: null })).toBe(false);
  });
  it("refuses when no open pool fits a starter plant", () => {
    expect(shouldFoundForNationalShortage({ ...base, fittingPools: 0 })).toBe(false);
  });
});

describe("foundNppNationalShortageCorporations", () => {
  const starter = foundingStarterUnits("media", null, "entertainment");
  const makeDb = (opts: { laneRows?: Array<{ _id: string; n: number }>; ratio?: number }) => {
    const nppFind = vi.fn(() => {
      const cursor = {
        sort: () => cursor,
        limit: () => cursor,
        toArray: async () => [
          { _id: new ObjectId(), countryId: "RU", homeState: "RU-MOW", party: "1" },
        ],
      };
      return cursor;
    });
    return {
      nppFind,
      db: {
        collection: (name: string) => {
          if (name === "commodityPrices")
            return {
              find: () => ({
                toArray: async () => [
                  {
                    commodity: "entertainment_services",
                    basePrice: 600,
                    globalPrice: 600 * (opts.ratio ?? 3.3),
                  },
                ],
              }),
            };
          if (name === "unownedSectors")
            return {
              find: () => ({
                toArray: async () => [
                  { countryId: "RU", headroomUnits: starter * 3 },
                  { countryId: "RU", headroomUnits: starter * 2 },
                  { countryId: "DD", headroomUnits: starter * 3 },
                  { countryId: "CN", headroomUnits: starter * 3 },
                ],
              }),
            };
          if (name === "corporateSectors")
            return { aggregate: () => ({ toArray: async () => opts.laneRows ?? [] }) };
          if (name === "npps") return { find: nppFind };
          throw new Error(`unexpected collection ${name}`);
        },
      } as unknown as Db,
    };
  };

  it("founds once per short empty-lane country, never in a blocked one", async () => {
    vi.mocked(nppFoundCorporation).mockClear();
    const { db } = makeDb({ laneRows: [{ _id: "CN", n: 7 }] });
    const out = await foundNppNationalShortageCorporations(db, 200, 7_500);
    expect(out).toEqual([{ countryId: "RU", lane: "media_entertainment" }]);
    expect(vi.mocked(nppFoundCorporation)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(nppFoundCorporation).mock.calls[0];
    expect(call[2]).toBe("media_entertainment");
    // fee converted to the founder's home currency at its rate
    expect(call[3]).toBe(15_000);
  });

  it("founds nothing when the shortage is mild", async () => {
    vi.mocked(nppFoundCorporation).mockClear();
    const { db } = makeDb({ ratio: 1.2 });
    expect(await foundNppNationalShortageCorporations(db, 200, 7_500)).toEqual([]);
    expect(vi.mocked(nppFoundCorporation)).not.toHaveBeenCalled();
  });
});
