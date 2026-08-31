import { describe, expect, it, vi } from "vitest";
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

function collections(networks: unknown[], agencies: unknown[]) {
  const networkBulk = vi.fn().mockResolvedValue({});
  const agencyBulk = vi.fn().mockResolvedValue({});
  const db = {
    collection: (name: string) => {
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
