import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types";
import type { BankCharter } from "@/lib/db/types/bank";
import { MODERN_DEPOSIT_CORRIDOR, MODERN_LENDING_CORRIDOR } from "@/lib/banking/regulationQ";
import { NPP_CAPITAL_STATES } from "@/lib/admin/spawnNppCorporation";
import { NPC_BANKS_PER_COUNTRY } from "../npcBanks";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const spawnNppCorporation = vi.fn();

vi.mock("@/lib/admin/spawnNppCorporation", () => ({
  // Limited HQ map so seed only considers US / UK / RU in these tests.
  NPP_CAPITAL_STATES: {
    US: "DC",
    UK: "LON",
    RU: "MOW",
  },
  spawnNppCorporation: (...args: unknown[]) => spawnNppCorporation(...args),
}));

const modernDepositQuartile =
  MODERN_DEPOSIT_CORRIDOR.minOffset +
  0.25 * (MODERN_DEPOSIT_CORRIDOR.maxOffset - MODERN_DEPOSIT_CORRIDOR.minOffset);
const modernLendingMid =
  (MODERN_LENDING_CORRIDOR.minOffset + MODERN_LENDING_CORRIDOR.maxOffset) / 2;

type SeedCorp = Corporation & { npcBankSeedKey?: string };

function makeCorp(overrides: Partial<SeedCorp> = {}): SeedCorp {
  return {
    _id: new ObjectId(),
    name: "First National Bank",
    type: "financial",
    liquidCapital: 30_000_000,
    liquidCurrencyCode: "USD",
    countryId: "US",
    ceoId: new ObjectId(),
    ceoType: "npp",
    userId: new ObjectId("000000000000000000000000"),
    headquartersState: "DC",
    ...overrides,
  } as unknown as SeedCorp;
}

describe("npcBanks", () => {
  let db: MockDb;
  let corpsBySeedKey: Map<string, SeedCorp>;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    corpsBySeedKey = new Map();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    db.collection("gameConfig");
    db.collection("gameState");
    db.collection("corporateSectors");
    db.collection("corporations");
    db.collection("bankingLaws");
    db.collection("centralBanks");
    db.collection("states");
    // HQ states for the mocked capital map below (US/DC, UK/LON, RU/MOW).
    db.collectionMocks.states!.findOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        const id = filter._id as string | undefined;
        if (id === "DC") return { _id: "DC", countryId: "US" };
        if (id === "LON") return { _id: "LON", countryId: "UK" };
        if (id === "MOW") return { _id: "MOW", countryId: "RU" };
        return null;
      }
    );

    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      privateBankingEnabled: true,
      commandEconomyEnabled: false,
    });
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
      currentTurn: 1,
      currentYear: 2019,
    });
    db.collectionMocks.bankingLaws!.findOne.mockResolvedValue(null);
    db.collectionMocks.corporateSectors!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      sectorType: "financial",
    });
    db.collectionMocks.centralBanks!.findOne.mockResolvedValue({
      _id: "fed",
      primeRate: 5,
    });

    db.collectionMocks.corporations!.findOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        if (typeof filter.npcBankSeedKey === "string") {
          return corpsBySeedKey.get(filter.npcBankSeedKey) ?? null;
        }
        if (filter.name && filter.countryId) {
          for (const corp of corpsBySeedKey.values()) {
            if (corp.name === filter.name && corp.countryId === filter.countryId) return corp;
          }
          return null;
        }
        if (filter._id) {
          for (const corp of corpsBySeedKey.values()) {
            if (corp._id.equals(filter._id as ObjectId)) return corp;
          }
        }
        return null;
      }
    );

    db.collectionMocks.corporations!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  async function importNpcBanks() {
    return import("../npcBanks");
  }

  function wireSpawnToIssueCharter() {
    spawnNppCorporation.mockImplementation(
      async (_db: Db, input: { name: string; countryId: string; startingCapital: number }) => {
        // Treasury and HQ follow the seeded country so the real charter path
        // finds an eligible corp (a USD-treasury RU corp would fail RUB
        // eligibility and must surface, not silently skip).
        const countryId = input.countryId as CountryId;
        const currency = COUNTRY_CURRENCY_MAP[countryId] ?? "USD";
        const corp = makeCorp({
          _id: new ObjectId(),
          name: input.name,
          countryId: countryId as "US" | "UK",
          liquidCapital: input.startingCapital,
          liquidCurrencyCode: currency,
          headquartersState: NPP_CAPITAL_STATES[countryId],
        });

        const priorFindOne = db.collectionMocks.corporations!.findOne.getMockImplementation();
        db.collectionMocks.corporations!.findOne.mockImplementation(
          async (filter: Record<string, unknown>) => {
            if (filter._id && corp._id.equals(filter._id as ObjectId)) {
              return corp;
            }
            if (priorFindOne) return priorFindOne(filter);
            return null;
          }
        );

        db.collectionMocks.corporations!.findOneAndUpdate.mockImplementation(
          async (
            _filter: unknown,
            update: { $inc?: { liquidCapital: number }; $set?: { bankCharter: BankCharter } }
          ) => {
            const debit = -(update.$inc?.liquidCapital ?? 0);
            corp.liquidCapital -= debit;
            corp.bankCharter = update.$set?.bankCharter;
            return { ...corp };
          }
        );

        db.collectionMocks.corporations!.updateOne.mockImplementation(
          async (_filter: unknown, update: { $set?: { npcBankSeedKey?: string } }) => {
            if (update.$set?.npcBankSeedKey) {
              corp.npcBankSeedKey = update.$set.npcBankSeedKey;
              corpsBySeedKey.set(update.$set.npcBankSeedKey, corp);
            }
            return { matchedCount: 1, modifiedCount: 1 };
          }
        );

        return {
          corporationId: corp._id.toString(),
          sequentialId: 1,
          name: input.name,
          type: "financial" as const,
          countryId: input.countryId,
          headquartersState: corp.headquartersState,
          startingCapital: input.startingCapital,
          startingRevenue: 1000,
          sectorId: new ObjectId().toString(),
          nppId: new ObjectId().toString(),
          nppName: "NPP Banker",
          tickerSymbol: "FNB",
        };
      }
    );
  }

  describe("seedNpcBanks", () => {
    it("is idempotent: second call creates nothing", async () => {
      const { getCharterCapitalRequirement } = await import("../charter");
      const requirement = await getCharterCapitalRequirement(db as unknown as Db, "USD");
      wireSpawnToIssueCharter();

      const { seedNpcBanks } = await importNpcBanks();
      const first = await seedNpcBanks(db as unknown as Db);
      expect(first.created).toBeGreaterThan(0);
      const spawnCountAfterFirst = spawnNppCorporation.mock.calls.length;

      for (const call of spawnNppCorporation.mock.calls) {
        const input = call[1] as { startingCapital: number; countryId: string };
        if (input.countryId === "US") {
          expect(input.startingCapital).toBe(requirement * 3);
        }
      }

      const second = await seedNpcBanks(db as unknown as Db);
      expect(second.created).toBe(0);
      expect(second.skippedExisting).toBeGreaterThan(0);
      expect(spawnNppCorporation.mock.calls.length).toBe(spawnCountAfterFirst);
    });

    it("skips command economies (getLegalCharterTypes empty)", async () => {
      db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
        _id: "default",
        privateBankingEnabled: true,
        commandEconomyEnabled: true,
      });
      db.collectionMocks.gameState!.findOne.mockResolvedValue({
        _id: "current",
        preset: "1953-default",
        currentTurn: 1,
        currentYear: 1953,
      });
      wireSpawnToIssueCharter();

      const { seedNpcBanks } = await importNpcBanks();
      await seedNpcBanks(db as unknown as Db);

      const spawnedCountries = spawnNppCorporation.mock.calls.map(
        (c) => (c[1] as { countryId: string }).countryId
      );
      expect(spawnedCountries).not.toContain("RU");
      expect(spawnedCountries.length).toBeGreaterThan(0);
    });

    it("skips planned economies even when the command-economy flag is off", async () => {
      db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
        _id: "default",
        privateBankingEnabled: true,
        commandEconomyEnabled: false,
      });
      db.collectionMocks.gameState!.findOne.mockResolvedValue({
        _id: "current",
        preset: "1953-default",
        currentTurn: 1,
        currentYear: 1953,
      });
      wireSpawnToIssueCharter();

      const { seedNpcBanks } = await importNpcBanks();
      const result = await seedNpcBanks(db as unknown as Db);

      const spawnedCountries = spawnNppCorporation.mock.calls.map(
        (c) => (c[1] as { countryId: string }).countryId
      );
      // The creation gate deliberately ignores the flag, so RU stays
      // ineligible and is counted, not attempted.
      expect(spawnedCountries).toEqual(expect.arrayContaining(["US", "UK"]));
      expect(spawnedCountries).not.toContain("RU");
      expect(result.skippedIneligible).toBeGreaterThanOrEqual(2);
      expect(result.charterFailures).toBe(0);
    });

    it("excludes a country whose HQ state belongs to another country", async () => {
      // The HQ lookup reads `states` by string `_id` and compares the stored
      // countryId: a DC doc owned by the UK must exclude the US by design,
      // never attempt a US spawn.
      db.collectionMocks.states!.findOne.mockImplementation(
        async (filter: Record<string, unknown>) => {
          const id = filter._id as string | undefined;
          if (id === "DC") return { _id: "DC", countryId: "UK" };
          if (id === "LON") return { _id: "LON", countryId: "UK" };
          if (id === "MOW") return { _id: "MOW", countryId: "RU" };
          return null;
        }
      );
      wireSpawnToIssueCharter();

      const { seedNpcBanks } = await importNpcBanks();
      const result = await seedNpcBanks(db as unknown as Db);

      const usExclusion = result.excludedMissingState.find((e) => e.countryId === "US");
      expect(usExclusion).toMatchObject({
        hqState: "DC",
        reason: "state-country-mismatch",
        preset: "2019-default",
      });
      expect(result.skippedNoState).toBe(NPC_BANKS_PER_COUNTRY);
      const spawnedCountries = spawnNppCorporation.mock.calls.map(
        (c) => (c[1] as { countryId: string }).countryId
      );
      expect(spawnedCountries).not.toContain("US");
      expect(spawnedCountries).toEqual(expect.arrayContaining(["UK"]));
    });

    it("charters via the real issueCharter path (capital debited)", async () => {
      const { getCharterCapitalRequirement } = await import("../charter");
      const requirement = await getCharterCapitalRequirement(db as unknown as Db, "USD");

      // Pre-mark UK/RU slots so only US is created (one currency, one debit to assert).
      corpsBySeedKey.set(
        "npc-bank:UK:0",
        makeCorp({ countryId: "UK", name: "Provincial Commercial Bank" })
      );
      corpsBySeedKey.set(
        "npc-bank:UK:1",
        makeCorp({ countryId: "UK", name: "Merchants Trust Company" })
      );
      corpsBySeedKey.set(
        "npc-bank:RU:0",
        makeCorp({ countryId: "RU", name: "Moscow Commercial Bank" })
      );
      corpsBySeedKey.set(
        "npc-bank:RU:1",
        makeCorp({ countryId: "RU", name: "Volga Savings Bank" })
      );

      let lastDebit: number | undefined;
      let lastLiquidAfter: number | undefined;

      spawnNppCorporation.mockImplementation(
        async (_db: Db, input: { name: string; countryId: string; startingCapital: number }) => {
          expect(input.countryId).toBe("US");
          expect(input.startingCapital).toBe(requirement * 3);
          const corp = makeCorp({
            _id: new ObjectId(),
            name: input.name,
            liquidCapital: input.startingCapital,
            liquidCurrencyCode: "USD",
          });

          db.collectionMocks.corporations!.findOne.mockImplementation(
            async (filter: Record<string, unknown>) => {
              if (typeof filter.npcBankSeedKey === "string") {
                return corpsBySeedKey.get(filter.npcBankSeedKey) ?? null;
              }
              if (filter.name && filter.countryId) {
                for (const c of corpsBySeedKey.values()) {
                  if (c.name === filter.name && c.countryId === filter.countryId) return c;
                }
                return null;
              }
              if (filter._id && corp._id.equals(filter._id as ObjectId)) return corp;
              return null;
            }
          );

          db.collectionMocks.corporations!.findOneAndUpdate.mockImplementation(
            async (
              _filter: unknown,
              update: { $inc?: { liquidCapital: number }; $set?: { bankCharter: BankCharter } }
            ) => {
              lastDebit = update.$inc?.liquidCapital;
              corp.liquidCapital += lastDebit ?? 0;
              lastLiquidAfter = corp.liquidCapital;
              corp.bankCharter = update.$set?.bankCharter;
              return { ...corp };
            }
          );

          db.collectionMocks.corporations!.updateOne.mockImplementation(
            async (_f: unknown, update: { $set?: { npcBankSeedKey?: string } }) => {
              if (update.$set?.npcBankSeedKey) {
                corp.npcBankSeedKey = update.$set.npcBankSeedKey;
                corpsBySeedKey.set(update.$set.npcBankSeedKey, corp);
              }
              return { matchedCount: 1, modifiedCount: 1 };
            }
          );

          return {
            corporationId: corp._id.toString(),
            sequentialId: 1,
            name: input.name,
            type: "financial" as const,
            countryId: "US",
            headquartersState: "DC",
            startingCapital: input.startingCapital,
            startingRevenue: 1000,
            sectorId: new ObjectId().toString(),
            nppId: new ObjectId().toString(),
            nppName: "NPP Banker",
            tickerSymbol: "FNB",
          };
        }
      );

      const { seedNpcBanks } = await importNpcBanks();
      const result = await seedNpcBanks(db as unknown as Db);

      expect(result.created).toBe(2);
      expect(lastDebit).toBe(-requirement);
      expect(lastLiquidAfter).toBe(requirement * 2);
      expect(db.collectionMocks.corporations!.findOneAndUpdate).toHaveBeenCalled();
    });
  });

  describe("runNpcBankPolicy / processNpcBankPolicyTurn", () => {
    it("pushes drifted offsets to the deposit quartile and lending midpoint", async () => {
      const corp = makeCorp({
        bankCharter: {
          type: "retail",
          status: "active",
          currency: "USD",
          charteredTurn: 1,
          postedCapital: 10_000_000,
          depositOffset: MODERN_DEPOSIT_CORRIDOR.minOffset,
          lendingOffset: MODERN_LENDING_CORRIDOR.maxOffset,
          blacklist: {},
        },
      });

      const cursor = {
        toArray: vi.fn().mockResolvedValue([corp]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
      db.collectionMocks.corporations!.find.mockReturnValue(cursor);
      db.collectionMocks.corporations!.findOne.mockImplementation(
        async (filter: Record<string, unknown>) => {
          if (filter._id && corp._id.equals(filter._id as ObjectId)) return corp;
          return null;
        }
      );

      let setOffsets: { depositOffset?: number; lendingOffset?: number } = {};
      db.collectionMocks.corporations!.updateOne.mockImplementation(
        async (_filter: unknown, update: { $set?: Record<string, number> }) => {
          setOffsets = {
            depositOffset: update.$set?.["bankCharter.depositOffset"],
            lendingOffset: update.$set?.["bankCharter.lendingOffset"],
          };
          return { matchedCount: 1, modifiedCount: 1 };
        }
      );

      const { runNpcBankPolicy } = await importNpcBanks();
      const summary = await runNpcBankPolicy(db as unknown as Db, 10);

      expect(summary.banksChecked).toBe(1);
      expect(summary.banksUpdated).toBe(1);
      expect(setOffsets.depositOffset).toBe(modernDepositQuartile);
      expect(setOffsets.lendingOffset).toBe(modernLendingMid);
    });

    it("is a no-op when private banking is off", async () => {
      db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
        _id: "default",
        privateBankingEnabled: false,
      });

      const cursor = {
        toArray: vi.fn().mockResolvedValue([
          makeCorp({
            bankCharter: {
              type: "retail",
              status: "active",
              currency: "USD",
              charteredTurn: 1,
              postedCapital: 1,
              depositOffset: -10,
              lendingOffset: 10,
              blacklist: {},
            },
          }),
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
      db.collectionMocks.corporations!.find.mockReturnValue(cursor);

      const { processNpcBankPolicyTurn } = await importNpcBanks();
      const summary = await processNpcBankPolicyTurn(db as unknown as Db, 10);

      expect(summary).toEqual({ banksChecked: 0, banksUpdated: 0 });
      expect(db.collectionMocks.corporations!.updateOne).not.toHaveBeenCalled();
    });
  });

  describe("corridorDepositTarget", () => {
    it("sits at the lower quartile, strictly below the midpoint", async () => {
      const { corridorDepositTarget } = await importNpcBanks();
      expect(corridorDepositTarget(-4, 0.5)).toBe(-2.875);
      expect(corridorDepositTarget(-4, 0.5)).toBeLessThan((-4 + 0.5) / 2);
      expect(corridorDepositTarget(0.5, 6)).toBeLessThan((0.5 + 6) / 2);
    });
  });
});
