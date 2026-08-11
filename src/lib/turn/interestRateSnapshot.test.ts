import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { snapshotInterestRateHistory } from "./interestRateSnapshot";

/**
 * Pins the era-aware GDP-growth snapshot fallback: countries WITHOUT a
 * national stateMetrics doc (layer-1, e.g. RU) must snapshot the era-authored
 * trend growth while the CURRENT in-game year sits in a historical era span,
 * instead of the legacy hardcoded 2.5 — which recorded min=max=2.5 forever
 * for RU/FR/IT/ES/SE/TR. Worlds at modern years (1999+) keep 2.5, and the
 * fallback graduates as the world's clock advances.
 */

function buildDbMock(params: { currentYear: number | undefined; banks: unknown[] }) {
  const bulkWrite = vi.fn().mockResolvedValue({});
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "centralBanks") {
        return {
          find: () => ({ toArray: async () => params.banks }),
          bulkWrite,
        };
      }
      if (name === "gameState") {
        return {
          findOne: async () =>
            params.currentYear === undefined ? null : { currentYear: params.currentYear },
        };
      }
      // federalBudget / stateMetrics: nothing found → all fallbacks exercised
      return {
        find: () => ({ toArray: async () => [] }),
      };
    }),
  } as unknown as Db;
  return { db, bulkWrite };
}

const ruBank = {
  _id: "RU",
  countryId: "RU",
  primeRate: 3.0,
};

function pushedGdpRate(bulkWrite: ReturnType<typeof vi.fn>): number {
  const ops = bulkWrite.mock.calls[0][0] as Array<{
    updateOne: {
      update: { $push: { gdpGrowthHistory: { $each: Array<{ rate: number }> } } };
    };
  }>;
  return ops[0].updateOne.update.$push.gdpGrowthHistory.$each[0].rate;
}

describe("snapshotInterestRateHistory era-aware growth fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("snapshots the authored 1953 trend (RU 6.0) while the in-game year is in the 1953 span", async () => {
    const { db, bulkWrite } = buildDbMock({ currentYear: 1953, banks: [ruBank] });
    await snapshotInterestRateHistory(db, 10);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(pushedGdpRate(bulkWrite)).toBe(6.0);
  });

  it("graduates the trend as the world's clock advances (1953 world at later years)", async () => {
    // Same 1953-seeded world, later in-game years: 1955 still the 1953 span…
    let mock = buildDbMock({ currentYear: 1955, banks: [ruBank] });
    await snapshotInterestRateHistory(mock.db, 10);
    expect(pushedGdpRate(mock.bulkWrite)).toBe(6.0);
    // …1979-1990 the Brezhnev-stagnation 1979 anchor…
    mock = buildDbMock({ currentYear: 1985, banks: [ruBank] });
    await snapshotInterestRateHistory(mock.db, 10);
    expect(pushedGdpRate(mock.bulkWrite)).toBe(2.5);
    // …1991-1998 the post-Soviet-collapse 1991 anchor…
    mock = buildDbMock({ currentYear: 1995, banks: [ruBank] });
    await snapshotInterestRateHistory(mock.db, 10);
    expect(pushedGdpRate(mock.bulkWrite)).toBe(-5.0);
    // …and the legacy 2.5 fallback from 1999 on.
    mock = buildDbMock({ currentYear: 2020, banks: [ruBank] });
    await snapshotInterestRateHistory(mock.db, 10);
    expect(pushedGdpRate(mock.bulkWrite)).toBe(2.5);
  });

  it("keeps the legacy 2.5 fallback at modern in-game years (live 1991 world at 2015)", async () => {
    const { db, bulkWrite } = buildDbMock({ currentYear: 2015, banks: [ruBank] });
    await snapshotInterestRateHistory(db, 10);
    expect(pushedGdpRate(bulkWrite)).toBe(2.5);
  });

  it("keeps the legacy 2.5 fallback when gameState is missing", async () => {
    const { db, bulkWrite } = buildDbMock({ currentYear: undefined, banks: [ruBank] });
    await snapshotInterestRateHistory(db, 10);
    expect(pushedGdpRate(bulkWrite)).toBe(2.5);
  });
});
