import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/admin/spawnNppCorporation", () => ({
  generateNppCorpName: vi.fn(() => "Mock Corp"),
  spawnNppCorporation: vi.fn(),
}));

import { spawnNppCorporation } from "@/lib/admin/spawnNppCorporation";
import { foundNppCorporationsSurplus } from "./nppActionProcessing";

/**
 * Deterministic read-count test for the NPP corporation-founding sweep.
 *
 * Production pattern: every 4th turn the sweep pulls the N wealthiest NPPs
 * (pool up to 300) and rolls a per-NPP founding chance. The counting mock Db
 * below reproduces that call pattern (300 wealthy candidates, empty
 * corporations collection, US permitted) and counts every command per
 * collection, so repeated reads show up as exact numbers instead of timing
 * noise. The seeded RNG makes the passing set deterministic.
 */
describe("foundNppCorporationsSurplus read budget", () => {
  it("batches the already-CEO exclusion and loads the blocked set once", async () => {
    const candidates = Array.from({ length: 300 }, () => ({
      _id: new ObjectId(),
      countryId: "US",
      party: "1",
      homeState: "CA",
      personality: { loyalty: 50, ambition: 70, stubbornness: 20 },
      nppInvestmentCashAnchor: 200_000,
    }));

    const corpFind = vi.fn().mockReturnValue({ toArray: async () => [] });
    const corpFindOne = vi.fn().mockResolvedValue(null);
    const corpUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    const nppDebit = vi.fn().mockImplementation(async (filter: { _id: ObjectId }) => ({
      _id: filter._id,
      nppInvestmentCashAnchor: 100_000,
    }));
    const gameStateFindOne = vi.fn().mockResolvedValue({ currentYear: 1970 });
    const fedBudgetFind = vi.fn().mockReturnValue({ toArray: async () => [] });

    const candidateCursor = () => {
      let ordered = [...candidates];
      const cursor = {
        [Symbol.asyncIterator]: async function* () {
          for (const item of ordered) yield item;
        },
        sort(spec: Record<string, 1 | -1>) {
          const [field, dir] = Object.entries(spec)[0] ?? [];
          if (field === "nppInvestmentCashAnchor") {
            ordered = [...ordered].sort((a, b) => {
              const av = a[field];
              const bv = b[field];
              return av < bv ? -1 * (dir ?? 1) : av > bv ? 1 * (dir ?? 1) : 0;
            });
          }
          return cursor;
        },
        limit(n: number) {
          ordered = ordered.slice(0, n);
          return cursor;
        },
        toArray: async () => ordered,
      };
      return cursor;
    };

    const db = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "npps") {
          return { find: () => candidateCursor(), findOneAndUpdate: nppDebit };
        }
        if (name === "corporations") {
          return { find: corpFind, findOne: corpFindOne, updateOne: corpUpdateOne };
        }
        if (name === "gameState") return { findOne: gameStateFindOne };
        if (name === "federalBudget") return { find: fedBudgetFind };
        if (name === "exchangeRates") return { find: () => ({ toArray: async () => [] }) };
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          findOne: vi.fn().mockResolvedValue(null),
        };
      }),
    } as unknown as Db;

    vi.mocked(spawnNppCorporation).mockImplementation(
      async () =>
        ({
          corporationId: new ObjectId().toString(),
          nppId: new ObjectId().toString(),
          name: "Mock Corp",
        }) as never
    );

    await foundNppCorporationsSurplus(db, 52, null);

    const attempts = nppDebit.mock.calls.length;
    // Non-vacuous: the seeded stream must actually attempt foundings.
    expect(attempts).toBeGreaterThan(0);

    // One batched already-CEO exclusion over the whole pool, not one findOne
    // per RNG-passing candidate.
    expect(corpFind).toHaveBeenCalledTimes(1);
    const preloadFilter = corpFind.mock.calls[0][0] as Record<string, unknown>;
    expect((preloadFilter.ceoId as { $in: unknown[] }).$in).toHaveLength(300);

    // The command core keeps its own guarded check, so inner findOnes must
    // match attempts exactly: no outer duplicate on top.
    expect(corpFindOne).toHaveBeenCalledTimes(attempts);

    // The command-economy blocked set loads once per sweep, not once per
    // founding attempt inside the core.
    expect(gameStateFindOne).toHaveBeenCalledTimes(1);
    expect(fedBudgetFind).toHaveBeenCalledTimes(1);

    // Every debited attempt spawns exactly once: same outcomes, fewer reads.
    expect(vi.mocked(spawnNppCorporation)).toHaveBeenCalledTimes(attempts);
  });
});
