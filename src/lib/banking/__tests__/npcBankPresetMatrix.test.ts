import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { NPP_CAPITAL_STATES } from "@/lib/admin/spawnNppCorporation";
import { NPC_BANKS_PER_COUNTRY, type NpcBankHqExclusion } from "../npcBanks";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const spawnNppCorporation = vi.fn();

vi.mock("@/lib/admin/spawnNppCorporation", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/admin/spawnNppCorporation")>();
  return {
    ...orig,
    spawnNppCorporation: (...args: unknown[]) => spawnNppCorporation(...args),
  };
});

const issueCharter = vi.fn();

vi.mock("@/lib/banking/charter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/banking/charter")>();
  return {
    ...orig,
    issueCharter: (...args: unknown[]) => issueCharter(...args),
  };
});

/**
 * Preset-matrix coverage for #2070: every configured NPC-bank headquarters
 * must either exist in the preset's seeded states or produce a deliberate,
 * machine-readable exclusion — never an attempted spawn that fails with
 * `State "…" not found`.
 *
 * State surfaces mirror the audit evidence on the issue: the 1953 treatment
 * seeds BLR/UKR/BAL states (6/6/3 docs), while the 1991 and 2019 treatments
 * seed zero `states` documents for all three republics.
 */
const HQ_BY_COUNTRY = new Map(
  Object.entries(NPP_CAPITAL_STATES).filter((entry): entry is [string, string] => entry[1] !== "")
);

const MISSING_IN_MARKET_ERAS = new Set(["BLR_MIN", "UKR_KYI", "BAL_LVA"]);

interface PresetCase {
  preset: string;
  year: number;
  /** HQ states present in this preset's seeded `states`. */
  presentHq: Set<string>;
}

const PRESETS: PresetCase[] = [
  { preset: "1953-default", year: 1953, presentHq: new Set(HQ_BY_COUNTRY.values()) },
  {
    preset: "1991-default",
    year: 1991,
    presentHq: new Set([...HQ_BY_COUNTRY.values()].filter((hq) => !MISSING_IN_MARKET_ERAS.has(hq))),
  },
  {
    preset: "2019-default",
    year: 2019,
    presentHq: new Set([...HQ_BY_COUNTRY.values()].filter((hq) => !MISSING_IN_MARKET_ERAS.has(hq))),
  },
];

describe("npcBanks preset matrix (1953/1991/2019)", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();

    spawnNppCorporation.mockImplementation(
      async (_db: Db, input: { name: string; countryId: string; headquartersState: string }) => ({
        corporationId: new ObjectId().toHexString(),
        sequentialId: 1,
        name: input.name,
        type: "financial" as const,
        countryId: input.countryId,
        headquartersState: input.headquartersState,
        startingCapital: 1_000_000,
        startingRevenue: 1000,
        sectorId: new ObjectId().toHexString(),
        nppId: new ObjectId().toHexString(),
        nppName: "NPP Banker",
        tickerSymbol: "FNB",
      })
    );
    issueCharter.mockResolvedValue({ ok: true });
  });

  function wireWorld(preset: string, year: number, presentHq: Set<string>) {
    db.collection("gameState");
    db.collection("gameConfig");
    db.collection("states");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset,
      currentTurn: 1,
      currentYear: year,
    });
    // Mirrors bootstrapGameWorld: the command-economy gate write follows
    // isEasternBlocEra, so only 1953 runs command economies here.
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      commandEconomyEnabled: preset === "1953-default",
    });
    db.collectionMocks.states!.findOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        const id = filter._id as string | undefined;
        if (!id || !presentHq.has(id)) return null;
        for (const [countryId, hq] of HQ_BY_COUNTRY) {
          if (hq === id) return { _id: id, countryId };
        }
        return null;
      }
    );
  }

  for (const { preset, year, presentHq } of PRESETS) {
    it(`${preset}: zero dangling HQ references, no State-not-found failures`, async () => {
      wireWorld(preset, year, presentHq);
      const logs: string[] = [];

      const { seedNpcBanks } = await import("../npcBanks");
      const result = await seedNpcBanks(db as unknown as Db, (msg) => logs.push(msg));

      // No attempted spawn may target a state outside the preset's surface,
      // and the old failure signature must be gone.
      expect(logs.join("\n")).not.toMatch(/State ".*" not found/);
      const attemptedHq = spawnNppCorporation.mock.calls.map(
        (call) => (call[1] as { headquartersState: string }).headquartersState
      );
      for (const hq of attemptedHq) {
        expect(presentHq.has(hq)).toBe(true);
      }

      // Dangling configured HQs (present in the map, absent in the preset)
      // must be exactly the recorded exclusions: nothing dangling, nothing
      // attempted-and-failed.
      const dangling = [...new Set(HQ_BY_COUNTRY.values())].filter((hq) => !presentHq.has(hq));
      expect(
        new Set(result.excludedMissingState.map((e: NpcBankHqExclusion) => e.hqState))
      ).toEqual(new Set(dangling));
      expect(result.charterFailures).toBe(0);
    });
  }

  it("2019-default: BLR/UKR/BAL excluded with a machine-readable reason", async () => {
    const market = PRESETS.find((p) => p.preset === "2019-default")!;
    wireWorld(market.preset, market.year, market.presentHq);
    const logs: string[] = [];

    const { seedNpcBanks } = await import("../npcBanks");
    const result = await seedNpcBanks(db as unknown as Db, (msg) => logs.push(msg));

    const excludedCountries = result.excludedMissingState
      .map((e: NpcBankHqExclusion) => e.countryId)
      .sort();
    expect(excludedCountries).toEqual(["BAL", "BLR", "UKR"]);
    for (const exclusion of result.excludedMissingState) {
      expect(exclusion.reason).toBe("no-state-in-preset");
      expect(exclusion.preset).toBe("2019-default");
    }
    expect(result.skippedNoState).toBe(3 * NPC_BANKS_PER_COUNTRY);
    const attemptedCountries = spawnNppCorporation.mock.calls.map(
      (call) => (call[1] as { countryId: string }).countryId
    );
    expect(attemptedCountries).not.toContain("BLR");
    expect(attemptedCountries).not.toContain("UKR");
    expect(attemptedCountries).not.toContain("BAL");
  });

  it("1991-default: same exclusion surface as 2019 (no states, no failures)", async () => {
    const market = PRESETS.find((p) => p.preset === "1991-default")!;
    wireWorld(market.preset, market.year, market.presentHq);

    const { seedNpcBanks } = await import("../npcBanks");
    const result = await seedNpcBanks(db as unknown as Db);

    const excludedCountries = result.excludedMissingState
      .map((e: NpcBankHqExclusion) => e.countryId)
      .sort();
    expect(excludedCountries).toEqual(["BAL", "BLR", "UKR"]);
    expect(result.charterFailures).toBe(0);
  });

  it("1953-default: republic states exist, banks skipped as command economies (no exclusion, no spawn)", async () => {
    const coldWar = PRESETS.find((p) => p.preset === "1953-default")!;
    wireWorld(coldWar.preset, coldWar.year, coldWar.presentHq);

    const { seedNpcBanks } = await import("../npcBanks");
    const result = await seedNpcBanks(db as unknown as Db);

    // Historical behavior preserved: HQ states exist so nothing is excluded,
    // and the command-economy charter gate still skips the republics.
    expect(result.excludedMissingState).toEqual([]);
    expect(result.charterFailures).toBe(0);
    const attemptedCountries = spawnNppCorporation.mock.calls.map(
      (call) => (call[1] as { countryId: string }).countryId
    );
    expect(attemptedCountries).not.toContain("BLR");
    expect(attemptedCountries).not.toContain("UKR");
    expect(attemptedCountries).not.toContain("BAL");
  });

  it("expected-bank creation failure rejects so bootstrap health records it", async () => {
    const market = PRESETS.find((p) => p.preset === "2019-default")!;
    wireWorld(market.preset, market.year, market.presentHq);
    spawnNppCorporation.mockRejectedValueOnce(new Error("charter desk down"));

    const { seedNpcBanks } = await import("../npcBanks");
    await expect(seedNpcBanks(db as unknown as Db)).rejects.toThrow(/expected bank slot/);
  });
});
