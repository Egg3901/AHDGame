import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyDirectedCreditToSoe, makeSeedSoeState } from "@/lib/economy/soe";
import { processCommandEconomyTurn } from "@/lib/turn/commandEconomyTurn";
import { resolveGosbankPosture } from "@/lib/economy/commandEconomyPosture";
import { ObjectId, type Db } from "mongodb";

const resolveWriteContext = vi.fn();
vi.mock("@/lib/economy/queries/commandEconomyWriteContext", () => ({ resolveWriteContext }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: () => ({ ok: true }),
  rateLimitResponse: vi.fn(),
}));

const { POST } = await import("@/app/api/country/[code]/command-economy/gosbank/route");

describe("macro player/NPP action parity fixture", () => {
  let updateOne: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    updateOne = vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 });
    resolveWriteContext.mockResolvedValue({
      ok: true,
      ctx: {
        db: { collection: () => ({ updateOne }) },
        countryId: "RU",
        characterId: "player-bank-chair",
        roles: { isHeadOfGovernment: false, isPlanner: false, isBankChair: true },
        currentTurn: 110,
      },
    });
  });

  it("persists the player directive, then normalizes it against the NPP phase input", async () => {
    const response = await POST(
      new Request("http://localhost/api/country/RU/command-economy/gosbank", {
        method: "POST",
        body: JSON.stringify({
          creditAggressiveness: 0.8,
          budgetSoftness: 0.7,
          sectorCredit: { manufacturing: 1, agriculture: 0.25 },
        }),
      }),
      { params: Promise.resolve({ code: "RU" }) }
    );
    expect(response.status).toBe(200);
    expect(updateOne).toHaveBeenCalledOnce();
    const update = updateOne.mock.calls[0][1];
    expect(update.$set["economicFactors.gosbankDirective.creditAggressiveness"]).toBe(0.8);
    expect(update.$set["economicFactors.gosbankDirective.budgetSoftness"]).toBe(0.7);
    expect(update.$set["economicFactors.gosbankDirective.sectorCredit"]).toEqual({
      manufacturing: 1,
      agriculture: 0.25,
    });

    const persisted = update.$set;
    const player = resolveGosbankPosture(
      {
        creditAggressiveness: persisted["economicFactors.gosbankDirective.creditAggressiveness"],
        budgetSoftness: persisted["economicFactors.gosbankDirective.budgetSoftness"],
      },
      { creditAggressiveness: 0.2, budgetSoftness: 0.1 }
    );
    const npp = resolveGosbankPosture(undefined, {
      creditAggressiveness: persisted["economicFactors.gosbankDirective.creditAggressiveness"],
      budgetSoftness: persisted["economicFactors.gosbankDirective.budgetSoftness"],
    });
    expect(npp).toEqual(player);

    const makeTurnDb = (directive: Record<string, number> | undefined, stance: typeof npp) => {
      const corpId = new ObjectId();
      const corp = {
        _id: corpId,
        countryId: "RU",
        liquidCurrencyCode: "RUB",
        soe: { sector: "energy", capacity: 1_100, output: 900, planTarget: 1_000 },
      };
      const sector = {
        _id: new ObjectId(),
        corporationId: corpId,
        sectorType: "energy",
        revenue: 1_000,
        realizedRevenue: 900,
        capitalStock: 100,
        capacityBookAnchor: 1_000,
      };
      const budget = {
        _id: "federal",
        countryId: "RU",
        economicFactors: {
          gdpGrowth: 4,
          wageGrowth: 10,
          inflationRate: 3,
          tradeGrowth: 2,
          lastUpdated: new Date("1979-01-01T00:00:00Z"),
          ...(directive ? { gosbankDirective: directive } : {}),
        },
      };
      const sets: Record<string, unknown>[] = [];
      const sectorWrites: unknown[][] = [];
      const corpWrites: unknown[][] = [];
      const db = {
        collection: (name: string) => {
          if (name === "gameConfig")
            return {
              findOne: async () => ({ commandEconomyEnabled: true, marketSystemMode: "plants" }),
            };
          if (name === "federalBudget")
            return {
              find: () => ({ toArray: async () => [budget] }),
              updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
                sets.push(update.$set);
                return { matchedCount: 1 };
              },
            };
          if (name === "governmentFormations")
            return {
              find: () => ({ toArray: async () => [{ _id: "RU", commandStance: stance }] }),
            };
          if (name === "countryGameStates") return { find: () => ({ toArray: async () => [] }) };
          if (name === "corporations")
            return {
              find: () => ({ toArray: async () => [corp] }),
              bulkWrite: async (ops: unknown[]) => corpWrites.push(ops),
            };
          if (name === "corporateSectors")
            return {
              find: () => ({ toArray: async () => [sector] }),
              bulkWrite: async (ops: unknown[]) => sectorWrites.push(ops),
            };
          if (name === "exchangeRates") return { find: () => ({ toArray: async () => [] }) };
          if (name === "gameState") return { findOne: async () => null };
          throw new Error(`unexpected collection: ${name}`);
        },
      } as unknown as Db;
      return { db, sets, sectorWrites, corpWrites, sector };
    };
    const directive = {
      creditAggressiveness: persisted["economicFactors.gosbankDirective.creditAggressiveness"],
      budgetSoftness: persisted["economicFactors.gosbankDirective.budgetSoftness"],
    };
    const playerTurn = makeTurnDb(directive, { creditAggressiveness: 0.2, budgetSoftness: 0.1 });
    const nppTurn = makeTurnDb(undefined, npp);
    await processCommandEconomyTurn(playerTurn.db, 1, 1979);
    await processCommandEconomyTurn(nppTurn.db, 1, 1979);
    expect(playerTurn.sets[0]["economicFactors.budgetSoftness"]).toBe(
      nppTurn.sets[0]["economicFactors.budgetSoftness"]
    );
    expect(playerTurn.sets[0]["economicFactors.monetaryOverhang"]).toBe(
      nppTurn.sets[0]["economicFactors.monetaryOverhang"]
    );
    expect(playerTurn.sectorWrites[0]?.[0]).toMatchObject({
      updateOne: {
        update:
          nppTurn.sectorWrites[0]?.[0] &&
          (nppTurn.sectorWrites[0][0] as { updateOne: { update: unknown } }).updateOne.update,
      },
    });
    expect(playerTurn.corpWrites[0]?.[0]).toMatchObject({
      updateOne: {
        update:
          nppTurn.corpWrites[0]?.[0] &&
          (nppTurn.corpWrites[0][0] as { updateOne: { update: unknown } }).updateOne.update,
      },
    });
    const sectorOps = playerTurn.sectorWrites.flat();
    expect(sectorOps).toHaveLength(1);
    expect(sectorOps[0]).toMatchObject({
      updateOne: { update: { $inc: { capitalStock: expect.any(Number) } } },
    });
    expect(playerTurn.sector.capitalStock).toBe(100);
  });

  it("plants settlement changes capacity value without creating physical output", () => {
    const before = { ...makeSeedSoeState("manufacturing", 12_000), output: 8_000 };
    const after = applyDirectedCreditToSoe(before, 50, { capacityValueAdded: 25 });
    expect(after.capacity).toBe(before.capacity + 25);
    expect(after.output).toBe(before.output);
  });
});
