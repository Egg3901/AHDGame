import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import { sumQualifyingEntitySovereignHoldings } from "../entityHoldings";

const IMF_ID = new ObjectId("000000000000000000000001");
const PLAYER_CHAR_ID = new ObjectId("000000000000000000000002");
const NORMAL_CORP_ID = new ObjectId("000000000000000000000003");

describe("sumQualifyingEntitySovereignHoldings", () => {
  it("returns 0 when no sovereign bonds exist for the country", async () => {
    const db = makeFakeDb({ bonds: [], imfCorp: null });
    const result = await sumQualifyingEntitySovereignHoldings(db as never, "US");
    expect(result).toBe(0);
  });

  it("sums face value across all qualifying holders", async () => {
    const db = makeFakeDb({
      bonds: [
        {
          issuerType: "sovereign",
          countryId: "US",
          matured: false,
          defaulted: false,
          holders: [
            { characterId: PLAYER_CHAR_ID, units: 1000 }, // 1000 * 1000 = $1M
            { corporationId: NORMAL_CORP_ID, units: 5000 }, // $5M
          ],
        },
      ],
      imfCorp: null,
    });
    const result = await sumQualifyingEntitySovereignHoldings(db as never, "US");
    expect(result).toBe(6_000_000);
  });

  it("excludes IMF Corp holdings", async () => {
    const db = makeFakeDb({
      bonds: [
        {
          issuerType: "sovereign",
          countryId: "US",
          matured: false,
          defaulted: false,
          holders: [
            { corporationId: IMF_ID, units: 10_000 }, // excluded
            { corporationId: NORMAL_CORP_ID, units: 2000 },
          ],
        },
      ],
      imfCorp: { _id: IMF_ID },
    });
    const result = await sumQualifyingEntitySovereignHoldings(db as never, "US");
    expect(result).toBe(2_000_000);
  });

  it("ignores defaulted and matured bonds", async () => {
    const db = makeFakeDb({
      bonds: [
        {
          issuerType: "sovereign",
          countryId: "US",
          matured: false,
          defaulted: false,
          holders: [{ corporationId: NORMAL_CORP_ID, units: 1000 }],
        },
        {
          issuerType: "sovereign",
          countryId: "US",
          matured: false,
          defaulted: true,
          holders: [{ corporationId: NORMAL_CORP_ID, units: 999_999 }],
        },
        {
          issuerType: "sovereign",
          countryId: "US",
          matured: true,
          defaulted: false,
          holders: [{ corporationId: NORMAL_CORP_ID, units: 999_999 }],
        },
      ],
      imfCorp: null,
    });
    const result = await sumQualifyingEntitySovereignHoldings(db as never, "US");
    expect(result).toBe(1_000_000);
  });

  it("ignores corporate bonds (only sovereign issuance counts)", async () => {
    const db = makeFakeDb({
      bonds: [
        {
          issuerType: "corporation",
          countryId: "US",
          matured: false,
          defaulted: false,
          holders: [{ corporationId: NORMAL_CORP_ID, units: 999_999 }],
        },
      ],
      imfCorp: null,
    });
    const result = await sumQualifyingEntitySovereignHoldings(db as never, "US");
    expect(result).toBe(0);
  });
});

// ── helpers ──────────────────────────────────────────────────────────────────
type FakeData = {
  bonds: unknown[];
  imfCorp: { _id: ObjectId } | null;
};

function makeFakeDb(data: FakeData) {
  return {
    collection: (name: string) => {
      if (name === "bonds") {
        return {
          find: vi.fn((query: { issuerType?: string; countryId?: string }) => ({
            toArray: async () => {
              return data.bonds.filter((bond) => {
                const b = bond as Record<string, unknown>;
                if (query.issuerType && b.issuerType !== query.issuerType) return false;
                if (query.countryId && b.countryId !== query.countryId) return false;
                if (b.matured === true) return false;
                if (b.defaulted === true) return false;
                return true;
              });
            },
          })),
        };
      }
      if (name === "corporations") {
        return {
          findOne: vi.fn(async () => data.imfCorp),
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
  };
}
