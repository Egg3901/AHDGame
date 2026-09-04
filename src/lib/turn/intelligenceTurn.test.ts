import { describe, expect, it, vi } from "vitest";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { intelligenceAccrualPerTurn } from "@/lib/intelligence/appropriationLine";
import { networkUpkeep } from "@/lib/intelligence/cost";
import type { Db } from "mongodb";
import { BASE_TURN_PHASE_NAMES } from "@/simulation/phases/turnPhaseNames";
import {
  ECONOMY_ONLY_PHASES,
  ELECTIONS_SKIP_PHASES,
  MACRO_ONLY_PHASES,
} from "@/simulation/phases/simTurnProfiles";

describe("intelligenceTurn registration", () => {
  it("is a registered turn phase", () => {
    expect(BASE_TURN_PHASE_NAMES).toContain("intelligenceTurn");
  });

  it("is skipped in election-only sims", () => {
    // ELECTIONS_SKIP_PHASES is a DENYLIST: a phase NOT named here runs and bills
    // time in every election-balance run. Intelligence is not election machinery.
    expect(ELECTIONS_SKIP_PHASES.has("intelligenceTurn")).toBe(true);
  });

  it("stays out of the economy-only and macro-only allowlists", () => {
    // Those two are ALLOWLISTS, the opposite polarity. Phase 1 has no economic
    // effect, so it is deliberately absent rather than accidentally so.
    expect(ECONOMY_ONLY_PHASES.has("intelligenceTurn")).toBe(false);
    expect(MACRO_ONLY_PHASES.has("intelligenceTurn")).toBe(false);
  });

  it("runs immediately before navair so sabotage lands on current dispositions", () => {
    const names = [...BASE_TURN_PHASE_NAMES];
    expect(names.indexOf("intelligenceTurn")).toBeLessThan(names.indexOf("navairOperations"));
  });
});

vi.mock("@/lib/coldwar/tension", () => ({
  getColdWarTension: vi.fn(async () => ({ value: 40 })),
}));
vi.mock("@/lib/countryAccess", () => ({
  getAllCountryAccess: vi.fn(async () => ({
    US: { enabledForPlayers: true },
    PL: { enabledForPlayers: false },
  })),
}));

type Budget = Record<string, unknown> & {
  countryId: string;
  intelligenceAppropriation?: { balance: number; accruedThroughTurn: number };
};

/**
 * The stub serves federalBudget as well as the two intelligence collections, because
 * the pass now settles the appropriation before it steps a network: whether a network
 * was paid for is what decides whether it advances.
 *
 * The budget writes are emulated rather than merely recorded, honouring the guards the
 * real collection relies on — `$lt` on `accruedThroughTurn` for the once-per-turn
 * settlement, `$exists: false` for the seed. A stub that matched everything would let a
 * double-credit bug pass these tests.
 */
function collections(networks: unknown[], agencies: unknown[], budgets: Budget[] = []) {
  const networkBulk = vi.fn().mockResolvedValue({});
  const agencyBulk = vi.fn().mockResolvedValue({});
  const db = {
    collection: (name: string) => {
      if (name === "federalBudget") {
        return {
          find: (filter: { $or?: { countryId?: { $in?: string[] } }[] }) => ({
            // Mirrors the real $or: a country qualifies by having a line OR owning a network.
            toArray: async () => {
              const ids = filter.$or?.find((c) => c.countryId)?.countryId?.$in ?? [];
              return budgets.filter(
                (b) =>
                  ids.includes(b.countryId) ||
                  Number(
                    (b.spending as { byCategory?: Record<string, number> })?.byCategory
                      ?.intelligence ?? 0
                  ) > 0
              );
            },
          }),
          findOne: async (filter: { countryId: string }) =>
            budgets.find((b) => b.countryId === filter.countryId) ?? null,
          updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
            const doc = budgets.find((b) => b.countryId === filter.countryId);
            if (!doc) return { matchedCount: 0, modifiedCount: 0 };
            const pot = doc.intelligenceAppropriation;
            const needTurn = (
              filter["intelligenceAppropriation.accruedThroughTurn"] as { $lt?: number } | undefined
            )?.$lt;
            if (needTurn != null && !(pot && pot.accruedThroughTurn < needTurn)) {
              return { matchedCount: 0, modifiedCount: 0 };
            }
            const needAbsent = (
              filter.intelligenceAppropriation as { $exists?: boolean } | undefined
            )?.$exists;
            if (needAbsent === false && pot) return { matchedCount: 0, modifiedCount: 0 };

            const set = update.$set as Record<string, unknown> | undefined;
            const inc = update.$inc as Record<string, number> | undefined;
            if (set?.intelligenceAppropriation) {
              doc.intelligenceAppropriation = {
                ...(set.intelligenceAppropriation as Budget["intelligenceAppropriation"]),
              } as Budget["intelligenceAppropriation"];
            }
            const live = doc.intelligenceAppropriation;
            if (live) {
              if (inc?.["intelligenceAppropriation.balance"] != null) {
                live.balance += inc["intelligenceAppropriation.balance"];
              }
              if (set?.["intelligenceAppropriation.accruedThroughTurn"] != null) {
                live.accruedThroughTurn = set[
                  "intelligenceAppropriation.accruedThroughTurn"
                ] as number;
              }
            }
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      const docs = name === "intelligenceNetworks" ? networks : agencies;
      return {
        find: () => ({ toArray: async () => docs }),
        bulkWrite: name === "intelligenceNetworks" ? networkBulk : agencyBulk,
      };
    },
  } as unknown as Db;
  return { db, networkBulk, agencyBulk };
}

describe("processIntelligenceTurn", () => {
  it("stands NPP postures up even in a world with no intelligence rows at all", async () => {
    // The whole point: agencies are created lazily by the console, and nobody
    // ever opens an NPP country's console. Walking existing rows would leave
    // every unplayed country undefended forever.
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    const { db, networkBulk, agencyBulk } = collections([], []);
    const result = await processIntelligenceTurn(db, 10);

    expect(result.networksStepped).toBe(0);
    expect(result.posturesRefreshed).toBe(1);
    expect(networkBulk).not.toHaveBeenCalled();
    const ops = agencyBulk.mock.calls[0][0] as {
      updateOne: { filter: Record<string, unknown>; upsert?: boolean };
    }[];
    expect(ops[0].updateOne.filter).toEqual({ countryId: "PL" });
    expect(ops[0].updateOne.upsert).toBe(true);
  });

  it("steps every network once", async () => {
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    const net = {
      _id: "n1",
      ownerCountryId: "US",
      targetCountryId: "PL",
      level: 1,
      progress: 0,
      funding: "steady",
      suspicion: 40,
      status: "active",
      cooledUntilTurn: null,
      lastOpTurn: 0,
      updatedAt: new Date(0),
    };
    const { db, networkBulk } = collections([net], []);
    const result = await processIntelligenceTurn(db, 10);

    expect(result.networksStepped).toBe(1);
    expect(networkBulk).toHaveBeenCalledTimes(1);
  });

  it("refreshes posture for NPP countries and leaves player countries alone", async () => {
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    const agencies = [
      { _id: "a1", countryId: "US", counterIntel: 0 },
      { _id: "a2", countryId: "PL", counterIntel: 0 },
    ];
    const { db, agencyBulk } = collections([], agencies);
    const result = await processIntelligenceTurn(db, 10);

    // Only PL: `enabledForPlayers: false` is what makes a country NPP, matching
    // offensiveOptIns. A player country's posture is the player's to set.
    expect(result.posturesRefreshed).toBe(1);
    const ops = agencyBulk.mock.calls[0][0] as {
      updateOne: { filter: { countryId: string } };
    }[];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.filter.countryId).toBe("PL");
  });

  it("writes nothing when every posture is already correct", async () => {
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    // 20 default + 0.2 * 40 tension = 28.
    const agencies = [{ _id: "a2", countryId: "PL", counterIntel: 28 }];
    const { db, agencyBulk } = collections([], agencies);
    const result = await processIntelligenceTurn(db, 10);

    expect(result.posturesRefreshed).toBe(0);
    expect(agencyBulk).not.toHaveBeenCalled();
  });

  it("never resurrects a dissolved country's agency", async () => {
    // A dissolved country is out of getAllCountryAccess entirely, so iterating
    // the country list cannot upsert a row back for it after the merge purge.
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    const agencies = [{ _id: "a3", countryId: "DD", counterIntel: 0 }];
    const { db, agencyBulk } = collections([], agencies);
    await processIntelligenceTurn(db, 10);

    const ops = agencyBulk.mock.calls[0][0] as { updateOne: { filter: { countryId: string } } }[];
    expect(ops.map((o) => o.updateOne.filter.countryId)).not.toContain("DD");
  });
});

describe("the appropriation on the turn", () => {
  const GDP = 5.649e11;
  const STANDING = 0.0015;

  function net(over: Record<string, unknown> = {}) {
    return {
      _id: "n1",
      ownerCountryId: "US",
      targetCountryId: "PL",
      level: 1,
      progress: 0,
      funding: "steady",
      suspicion: 40,
      status: "active",
      cooledUntilTurn: null,
      lastOpTurn: 0,
      updatedAt: new Date(0),
      ...over,
    };
  }

  const progressOf = (bulk: ReturnType<typeof vi.fn>, id: string) => {
    const ops = bulk.mock.calls[0][0] as {
      updateOne: { filter: { _id: string }; update: { $set: { progress: number } } };
    }[];
    return ops.find((o) => o.updateOne.filter._id === id)!.updateOne.update.$set.progress;
  };

  it("accrues nothing for a country whose legislature has voted no line", async () => {
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    const budgets: Budget[] = [{ countryId: "US", gdp: GDP, spending: { byCategory: {} } }];
    const { db } = collections([net()], [], budgets);
    const result = await processIntelligenceTurn(db, 10);

    expect(result.countriesAccrued).toBe(1);
    expect(budgets[0].intelligenceAppropriation).toEqual({ balance: 0, accruedThroughTurn: 10 });
  });

  it("accrues for a funded country that owns no network yet", async () => {
    // Gating accrual on owning a network would deadlock a newly funded service:
    // no network means no money, and no money means it can never run the operation
    // that would build one.
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    const budgets: Budget[] = [
      {
        countryId: "US",
        gdp: GDP,
        spending: { byCategory: { intelligence: TURNS_PER_YEAR * 1000 } },
      },
    ];
    const { db } = collections([], [], budgets);
    const result = await processIntelligenceTurn(db, 10);

    expect(result.countriesAccrued).toBe(1);
    // Nothing to pay for, so the whole turn's accrual lands.
    expect(budgets[0].intelligenceAppropriation).toEqual({ balance: 1000, accruedThroughTurn: 10 });
  });

  it("charges network upkeep out of the same settlement as the accrual", async () => {
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    const line = GDP * STANDING;
    const budgets: Budget[] = [
      { countryId: "US", gdp: GDP, spending: { byCategory: { intelligence: line } } },
    ];
    const { db } = collections([net()], [], budgets);
    await processIntelligenceTurn(db, 10);

    const expected = Math.round(intelligenceAccrualPerTurn(line) - networkUpkeep("steady", GDP));
    expect(budgets[0].intelligenceAppropriation!.balance).toBe(expected);
  });

  it("refuses to credit the same turn twice", async () => {
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    const line = TURNS_PER_YEAR * 1000;
    const budgets: Budget[] = [
      {
        countryId: "US",
        gdp: GDP,
        spending: { byCategory: { intelligence: line } },
        intelligenceAppropriation: { balance: 0, accruedThroughTurn: 9 },
      },
    ];
    const { db } = collections([net({ funding: "none" })], [], budgets);
    await processIntelligenceTurn(db, 10);
    await processIntelligenceTurn(db, 10);
    expect(budgets[0].intelligenceAppropriation).toEqual({ balance: 1000, accruedThroughTurn: 10 });
  });

  it("stalls the networks the pot cannot cover and books no debt", async () => {
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    // No line at all, so nothing can be paid for and nothing may advance.
    const budgets: Budget[] = [{ countryId: "US", gdp: GDP, spending: { byCategory: {} } }];
    const { db, networkBulk } = collections(
      [net({ _id: "hi", level: 3, progress: 10 }), net({ _id: "lo", level: 1, progress: 20 })],
      [],
      budgets
    );
    const result = await processIntelligenceTurn(db, 10);

    expect(result.networksStalled).toBe(2);
    expect(progressOf(networkBulk, "hi")).toBe(10);
    expect(progressOf(networkBulk, "lo")).toBe(20);
    // Stalling is not borrowing: the balance never goes negative.
    expect(budgets[0].intelligenceAppropriation!.balance).toBe(0);
  });

  it("pays the highest ranked network first when it cannot pay for both", async () => {
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    // Exactly one steady network's worth of upkeep, and two networks asking.
    const line = networkUpkeep("steady", GDP) * TURNS_PER_YEAR;
    const budgets: Budget[] = [
      { countryId: "US", gdp: GDP, spending: { byCategory: { intelligence: line } } },
    ];
    const { db, networkBulk } = collections(
      [net({ _id: "hi", level: 3, progress: 10 }), net({ _id: "lo", level: 1, progress: 20 })],
      [],
      budgets
    );
    const result = await processIntelligenceTurn(db, 10);

    expect(result.networksStalled).toBe(1);
    // The established station keeps running; the junior one goes quiet.
    expect(progressOf(networkBulk, "hi")).toBeGreaterThan(10);
    expect(progressOf(networkBulk, "lo")).toBe(20);
  });

  it("charges nothing for a network funded at none, and still advances it", async () => {
    const { processIntelligenceTurn } = await import("./intelligenceTurn");
    const budgets: Budget[] = [{ countryId: "US", gdp: GDP, spending: { byCategory: {} } }];
    const { db } = collections([net({ funding: "none" })], [], budgets);
    const result = await processIntelligenceTurn(db, 10);

    // "none" asks for nothing, so the turn paid what it asked: not a stall.
    expect(result.networksStalled).toBe(0);
  });
});
