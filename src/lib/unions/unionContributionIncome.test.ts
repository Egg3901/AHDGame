import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { unionContributionIncomePerTurn } from "./unionContributionIncome";
import { freeCashFlowPerTurn, politicalContributionPerTurn } from "./unionPoliticalContributions";
import { duesIncomePerTurn, maxDuesForWage, averageAnnualWage } from "./unionDues";

function mockDb(opts: {
  organizers: { unionId: ObjectId; characterId: ObjectId; strength: number }[];
  unions: Record<string, unknown>[];
  sectors: Record<string, unknown>[];
}): Db {
  return {
    collection: (name: string) => {
      if (name === "unionOrganizers") {
        return {
          find: (filter: { characterId?: ObjectId; unionId?: { $in: ObjectId[] } }) => ({
            toArray: async () => {
              if (filter.characterId) {
                return opts.organizers.filter((row) => row.characterId.equals(filter.characterId!));
              }
              return opts.organizers;
            },
          }),
        };
      }
      if (name === "unions") {
        return {
          find: () => ({ toArray: async () => opts.unions }),
        };
      }
      if (name === "corporateSectors") {
        return {
          find: () => ({ toArray: async () => opts.sectors }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
}

describe("unionContributionIncomePerTurn", () => {
  it("returns zero when the character has no organizing strength", async () => {
    const db = mockDb({ organizers: [], unions: [], sectors: [] });
    expect(await unionContributionIncomePerTurn(db, new ObjectId())).toBe(0);
  });

  it("credits 40% of the pool when the character holds 40% of influence", async () => {
    const me = new ObjectId();
    const other = new ObjectId();
    const unionId = new ObjectId();
    const sector = {
      representingUnionId: unionId,
      workers: 100,
      unionization: 50,
      wagePerWorker: 10,
    };
    const withinCeiling = maxDuesForWage(averageAnnualWage([sector])) / 2;
    const db = mockDb({
      organizers: [
        { unionId, characterId: me, strength: 40 },
        { unionId, characterId: other, strength: 60 },
      ],
      unions: [
        {
          _id: unionId,
          treasury: 1000,
          duesPerWorkerAnnual: withinCeiling,
          activeServices: [],
          politicalContributionPct: 0.4,
        },
      ],
      sectors: [sector],
    });

    const duesIncome = duesIncomePerTurn(50, withinCeiling);
    const pool = politicalContributionPerTurn(freeCashFlowPerTurn(duesIncome, 0), 0.4);
    expect(await unionContributionIncomePerTurn(db, me)).toBeCloseTo(pool * 0.4, 6);
  });
});
